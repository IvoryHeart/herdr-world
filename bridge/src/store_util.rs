use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn default_store_dir(env_var: &str, subdir: &str, fallback: &str) -> PathBuf {
    if let Some(path) = non_empty_env_path(env_var) {
        return path;
    }
    if let Some(data_home) = non_empty_env_path("XDG_DATA_HOME") {
        return data_home.join("herdr-web").join(subdir);
    }
    if let Some(home) = non_empty_env_path("HOME") {
        return home
            .join(".local")
            .join("share")
            .join("herdr-web")
            .join(subdir);
    }
    PathBuf::from(fallback)
}

pub(crate) fn non_empty_env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub(crate) fn session_key() -> String {
    if let Some(name) = crate::session::active_name() {
        return format!("session:{name}");
    }
    if let Ok(path) = std::env::var(herdr_compat::api::SOCKET_PATH_ENV_VAR) {
        if !path.is_empty() && !crate::session::explicit_session_requested() {
            let canonical = fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(path));
            return format!(
                "socket:{:016x}",
                stable_hash(canonical.to_string_lossy().as_ref())
            );
        }
    }
    "session:default".to_string()
}

pub(crate) fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

pub(crate) fn now_ms_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

pub(crate) fn copy_corrupt_once(path: &Path) {
    if corrupt_copy_exists(path) {
        return;
    }
    let Ok(bytes) = fs::read(path) else {
        return;
    };
    let corrupt_path = path.with_extension(format!("{}.corrupt", now_ms_string()));
    if fs::write(&corrupt_path, bytes).is_ok() {
        let _ = set_private_file_permissions(&corrupt_path);
    }
}

pub(crate) fn corrupt_copy_exists(path: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
        return false;
    };
    let Ok(entries) = fs::read_dir(parent) else {
        return false;
    };
    let prefix = format!("{stem}.");
    entries.flatten().any(|entry| {
        entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".corrupt"))
    })
}

pub(crate) fn ensure_private_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    set_private_dir_permissions(path)
}

#[cfg(unix)]
pub(crate) fn effective_user_id() -> libc::uid_t {
    // SAFETY: geteuid has no arguments or caller-side safety requirements.
    unsafe { libc::geteuid() }
}

#[cfg(unix)]
fn ensure_private_owned_dir(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};

    match fs::symlink_metadata(path) {
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let mut builder = fs::DirBuilder::new();
            builder.mode(0o700);
            if let Err(error) = builder.create(path) {
                if error.kind() != io::ErrorKind::AlreadyExists {
                    return Err(error);
                }
            }
        }
        Err(error) => return Err(error),
    }

    let validate = || -> io::Result<fs::Metadata> {
        let metadata = fs::symlink_metadata(path)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "private lock directory must be a real directory",
            ));
        }
        if metadata.uid() != effective_user_id() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "private lock directory must be owned by the effective user",
            ));
        }
        Ok(metadata)
    };

    let metadata = validate()?;
    if metadata.permissions().mode() & 0o077 != 0 {
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        let metadata = validate()?;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "private lock directory permissions could not be restricted",
            ));
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn ensure_private_owned_dir(path: &Path) -> io::Result<()> {
    ensure_private_dir(path)
}

#[cfg(unix)]
pub(crate) fn set_private_dir_permissions(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
pub(crate) fn set_private_dir_permissions(_path: &Path) -> io::Result<()> {
    Ok(())
}

pub(crate) fn set_private_file_permissions(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

pub(crate) struct LockFile {
    file: File,
}

impl LockFile {
    pub(crate) fn exclusive(path: &Path) -> io::Result<Self> {
        Self::open_and_lock(path, true, lock_file)
    }

    pub(crate) fn try_exclusive(path: &Path) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            ensure_private_owned_dir(parent)?;
        }
        Self::open_and_lock(path, false, try_lock_file)
    }

    fn open_and_lock(
        path: &Path,
        ensure_parent: bool,
        acquire: impl FnOnce(&File) -> io::Result<()>,
    ) -> io::Result<Self> {
        if ensure_parent {
            if let Some(parent) = path.parent() {
                ensure_private_dir(parent)?;
            }
        }
        // Lock files are flock-only coordination points; existing contents are
        // never read, so keep them as-is instead of truncating.
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)?;
        set_private_file_permissions(path)?;
        acquire(&file)?;
        Ok(Self { file })
    }
}

impl Drop for LockFile {
    fn drop(&mut self) {
        let _ = unlock_file(&self.file);
    }
}

#[cfg(all(test, unix))]
mod lock_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn nonblocking_exclusive_lock_rejects_a_second_bridge_owner() {
        let root = std::env::temp_dir().join(format!(
            "herdr-world-runtime-lock-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("runtime.lock");
        let first = LockFile::try_exclusive(&path).unwrap();
        assert_eq!(
            std::fs::metadata(&root).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let second = match LockFile::try_exclusive(&path) {
            Ok(_) => panic!("second nonblocking lock unexpectedly succeeded"),
            Err(error) => error,
        };

        assert_eq!(second.kind(), io::ErrorKind::WouldBlock);

        drop(first);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn nonblocking_lock_rejects_a_symlinked_private_directory_without_chmod() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let container = std::env::temp_dir().join(format!(
            "herdr-world-hostile-lock-{}-{unique}",
            std::process::id()
        ));
        let target = container.join("target");
        let redirected = container.join("herdr-world-bridge-owner");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::os::unix::fs::symlink(&target, &redirected).unwrap();

        let result = LockFile::try_exclusive(&redirected.join("runtime.lock"));
        let rejected = match result {
            Ok(lock) => {
                drop(lock);
                false
            }
            Err(_) => true,
        };
        let target_mode = std::fs::metadata(&target).unwrap().permissions().mode() & 0o777;

        let _ = std::fs::remove_file(target.join("runtime.lock"));
        std::fs::remove_file(redirected).unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::remove_dir(target).unwrap();
        std::fs::remove_dir(container).unwrap();

        assert!(rejected);
        assert_eq!(target_mode, 0o755);
    }
}

#[cfg(unix)]
pub(crate) fn lock_file(file: &File) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(unix)]
pub(crate) fn try_lock_file(file: &File) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(unix)]
pub(crate) fn unlock_file(file: &File) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
pub(crate) fn lock_file(_file: &File) -> io::Result<()> {
    Ok(())
}

#[cfg(not(unix))]
pub(crate) fn try_lock_file(_file: &File) -> io::Result<()> {
    Ok(())
}

#[cfg(not(unix))]
pub(crate) fn unlock_file(_file: &File) -> io::Result<()> {
    Ok(())
}
