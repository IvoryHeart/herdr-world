//! Bounded transport seams for saved Herdr machines.
//!
//! The machine row and remote command spellings in this module mirror Herdr
//! v0.9.0.  The socket lease, OpenSSH forwarding supervisor, effective-config
//! check, and machine-scoped failure model are World-owned integration seams.
//! This module is intentionally not wired into the bridge runtime registry yet;
//! its committed tests are the transport spike's executable evidence.
#![allow(dead_code)]

use std::collections::HashSet;
#[cfg(test)]
use std::ffi::OsStr;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

const MAX_MACHINE_CATALOGUE_BYTES: usize = 64 * 1024;
const MAX_MACHINE_ROWS: usize = 64;
const MAX_MACHINE_ID_BYTES: usize = 64;
const MAX_MACHINE_LABEL_BYTES: usize = 128;
const MAX_MACHINE_TARGET_BYTES: usize = 1024;
const MAX_MACHINE_SESSION_BYTES: usize = 64;
const MAX_SESSION_CATALOGUE_BYTES: usize = 64 * 1024;
const MAX_SESSION_ROWS: usize = 64;
const MAX_REMOTE_PATH_BYTES: usize = 4096;
const MAX_REMOTE_UNIX_SOCKET_PATH_BYTES: usize = 107;
const MAX_EXECUTABLE_BYTES: usize = 1024;
const MAX_SSH_CONFIG_PATH_BYTES: usize = 4096;
const MAX_SSH_STDERR_BYTES: usize = 16 * 1024;
const MAX_COMMAND_DIAGNOSTIC_BYTES: usize = 8 * 1024;
const MACHINE_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

#[cfg(target_os = "linux")]
const MAX_UNIX_SOCKET_PATH_BYTES: usize = 107;
#[cfg(any(target_os = "macos", target_os = "ios"))]
const MAX_UNIX_SOCKET_PATH_BYTES: usize = 103;
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "ios")))]
const MAX_UNIX_SOCKET_PATH_BYTES: usize = 260;

static LEASE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanError(String);

impl std::fmt::Display for PlanError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

impl std::error::Error for PlanError {}

fn plan_error(message: impl Into<String>) -> PlanError {
    PlanError(message.into())
}

fn validate_text(value: &str, max_bytes: usize, field: &str) -> Result<(), PlanError> {
    if value.is_empty() {
        return Err(plan_error(format!("{field} must not be empty")));
    }
    if value.len() > max_bytes {
        return Err(plan_error(format!("{field} exceeds {max_bytes} bytes")));
    }
    if value.chars().any(char::is_control) {
        return Err(plan_error(format!("{field} contains a control character")));
    }
    Ok(())
}

fn validate_target(target: &str) -> Result<(), PlanError> {
    validate_text(target, MAX_MACHINE_TARGET_BYTES, "SSH target")?;
    if target.starts_with('-') {
        return Err(plan_error("SSH target may not begin with '-'"));
    }
    let authority = target.strip_prefix("ssh://").unwrap_or(target);
    if let Some((userinfo, _)) = authority.rsplit_once('@') {
        if userinfo.contains(':') {
            return Err(plan_error("SSH target may not contain a password"));
        }
    }
    Ok(())
}

fn validate_session(session: &str) -> Result<(), PlanError> {
    validate_text(session, MAX_MACHINE_SESSION_BYTES, "Herdr session")?;
    if !session
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(plan_error(
            "Herdr session may contain only ASCII letters, digits, '.', '_' and '-'",
        ));
    }
    Ok(())
}

fn path_text<'a>(path: &'a Path, max_bytes: usize, field: &str) -> Result<&'a str, PlanError> {
    let value = path
        .to_str()
        .ok_or_else(|| plan_error(format!("{field} must be valid UTF-8")))?;
    validate_text(value, max_bytes, field)?;
    Ok(value)
}

fn validate_socket_path(path: &Path, field: &str) -> Result<(), PlanError> {
    let value = path_text(path, MAX_UNIX_SOCKET_PATH_BYTES, field)?;
    if !path.is_absolute() {
        return Err(plan_error(format!("{field} must be absolute")));
    }
    if value.as_bytes().len() > MAX_UNIX_SOCKET_PATH_BYTES {
        return Err(plan_error(format!(
            "{field} exceeds the platform Unix socket path limit"
        )));
    }
    Ok(())
}

fn validate_remote_absolute_path(
    path: &Path,
    max_bytes: usize,
    field: &str,
) -> Result<(), PlanError> {
    let value = path_text(path, max_bytes, field)?;
    if !path.is_absolute() {
        return Err(plan_error(format!("{field} must be absolute")));
    }
    if value.as_bytes().len() > max_bytes {
        return Err(plan_error(format!("{field} exceeds {max_bytes} bytes")));
    }
    Ok(())
}

fn validate_remote_socket_path(path: &Path, field: &str) -> Result<(), PlanError> {
    validate_remote_absolute_path(path, MAX_REMOTE_UNIX_SOCKET_PATH_BYTES, field)
}

fn validate_config_path(path: &Path) -> Result<(), PlanError> {
    if !path.is_absolute() {
        return Err(plan_error("SSH config path must be absolute"));
    }
    let _ = path_text(path, MAX_SSH_CONFIG_PATH_BYTES, "SSH config path")?;
    Ok(())
}

fn validate_local_executable(path: &Path) -> Result<(), PlanError> {
    if !path.is_absolute() {
        return Err(plan_error(
            "Herdr executable must be an absolute resolved path",
        ));
    }
    let _ = path_text(path, MAX_EXECUTABLE_BYTES, "Herdr executable")?;
    Ok(())
}

/// The exact saved-machine row emitted by Herdr v0.9.0's `machine list --json`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct MachineProfile {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) target: String,
    pub(crate) session: String,
    pub(crate) enabled: bool,
    pub(crate) selected: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct BrowserMachineDescriptor {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) enabled: bool,
}

impl MachineProfile {
    fn validate(&self) -> Result<(), PlanError> {
        if self.id.len() != 32
            || self.id.len() > MAX_MACHINE_ID_BYTES
            || !self.id.bytes().all(|byte| byte.is_ascii_hexdigit())
            || self.id.bytes().any(|byte| byte.is_ascii_uppercase())
        {
            return Err(plan_error(
                "machine id must be 32 lowercase hexadecimal characters",
            ));
        }
        validate_text(&self.label, MAX_MACHINE_LABEL_BYTES, "machine label")?;
        if self.label.trim().is_empty() {
            return Err(plan_error("machine label must not be empty"));
        }
        validate_target(&self.target)?;
        validate_session(&self.session)
    }

    pub(crate) fn browser_descriptor(&self) -> BrowserMachineDescriptor {
        BrowserMachineDescriptor {
            id: self.id.clone(),
            label: self.label.clone(),
            enabled: self.enabled,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum MachineDiscoveryError {
    OversizedOutput,
    InvalidCatalogue(String),
    DuplicateId(String),
    CommandFailed { status: Option<i32>, stderr: String },
}

impl std::fmt::Display for MachineDiscoveryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OversizedOutput => formatter.write_str("machine catalogue output is too large"),
            Self::InvalidCatalogue(error) => {
                write!(formatter, "invalid machine catalogue: {error}")
            }
            Self::DuplicateId(id) => write!(formatter, "duplicate machine id: {id}"),
            Self::CommandFailed { status, stderr } => {
                write!(formatter, "machine list command failed ({status:?})")?;
                if !stderr.is_empty() {
                    write!(formatter, ": {stderr}")?;
                }
                Ok(())
            }
        }
    }
}

impl std::error::Error for MachineDiscoveryError {}

fn bounded_diagnostic(bytes: &[u8], limit: usize) -> String {
    let kept = &bytes[..bytes.len().min(limit)];
    let mut text = String::from_utf8_lossy(kept).trim().to_owned();
    if bytes.len() > limit {
        text.push_str(" [truncated]");
    }
    text
}

pub(crate) fn parse_machine_catalogue(
    stdout: &[u8],
) -> Result<Vec<MachineProfile>, MachineDiscoveryError> {
    if stdout.len() > MAX_MACHINE_CATALOGUE_BYTES {
        return Err(MachineDiscoveryError::OversizedOutput);
    }
    let rows: Vec<MachineProfile> = serde_json::from_slice(stdout)
        .map_err(|error| MachineDiscoveryError::InvalidCatalogue(error.to_string()))?;
    if rows.len() > MAX_MACHINE_ROWS {
        return Err(MachineDiscoveryError::InvalidCatalogue(format!(
            "more than {MAX_MACHINE_ROWS} machine rows"
        )));
    }
    let mut ids = HashSet::with_capacity(rows.len());
    for row in &rows {
        row.validate()
            .map_err(|error| MachineDiscoveryError::InvalidCatalogue(error.to_string()))?;
        if !ids.insert(row.id.clone()) {
            return Err(MachineDiscoveryError::DuplicateId(row.id.clone()));
        }
    }
    Ok(rows)
}

pub(crate) fn decode_machine_command_output(
    success: bool,
    status: Option<i32>,
    stdout: &[u8],
    stderr: &[u8],
) -> Result<Vec<MachineProfile>, MachineDiscoveryError> {
    if !success {
        return Err(MachineDiscoveryError::CommandFailed {
            status,
            stderr: bounded_diagnostic(stderr, MAX_COMMAND_DIAGNOSTIC_BYTES),
        });
    }
    parse_machine_catalogue(stdout)
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct RemoteSessionInfo {
    pub(crate) name: String,
    pub(crate) default: bool,
    pub(crate) running: bool,
    pub(crate) socket_path: PathBuf,
    pub(crate) session_dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RemoteSessionDiscoveryError {
    OversizedOutput,
    InvalidOutput(String),
    DuplicateName(String),
    SessionNotFound(String),
}

impl std::fmt::Display for RemoteSessionDiscoveryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OversizedOutput => formatter.write_str("session catalogue output is too large"),
            Self::InvalidOutput(error) => write!(formatter, "invalid session catalogue: {error}"),
            Self::DuplicateName(name) => write!(formatter, "duplicate session name: {name}"),
            Self::SessionNotFound(name) => write!(formatter, "session not found: {name}"),
        }
    }
}

impl std::error::Error for RemoteSessionDiscoveryError {}

pub(crate) fn parse_remote_session_catalogue(
    stdout: &[u8],
) -> Result<Vec<RemoteSessionInfo>, RemoteSessionDiscoveryError> {
    if stdout.len() > MAX_SESSION_CATALOGUE_BYTES {
        return Err(RemoteSessionDiscoveryError::OversizedOutput);
    }
    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct SessionCatalogue {
        sessions: Vec<RemoteSessionInfo>,
    }

    let catalogue: SessionCatalogue = serde_json::from_slice(stdout)
        .map_err(|error| RemoteSessionDiscoveryError::InvalidOutput(error.to_string()))?;
    if catalogue.sessions.len() > MAX_SESSION_ROWS {
        return Err(RemoteSessionDiscoveryError::InvalidOutput(format!(
            "more than {MAX_SESSION_ROWS} session rows"
        )));
    }
    let mut names = HashSet::with_capacity(catalogue.sessions.len());
    for session in &catalogue.sessions {
        validate_session(&session.name)
            .map_err(|error| RemoteSessionDiscoveryError::InvalidOutput(error.to_string()))?;
        if session.default != (session.name == "default") {
            return Err(RemoteSessionDiscoveryError::InvalidOutput(
                "session default flag does not match its name".into(),
            ));
        }
        validate_remote_socket_path(&session.socket_path, "remote API socket")
            .and_then(|_| {
                validate_remote_absolute_path(
                    &session.session_dir,
                    MAX_REMOTE_PATH_BYTES,
                    "remote session directory",
                )
            })
            .map_err(|error| RemoteSessionDiscoveryError::InvalidOutput(error.to_string()))?;
        if !names.insert(session.name.clone()) {
            return Err(RemoteSessionDiscoveryError::DuplicateName(
                session.name.clone(),
            ));
        }
    }
    Ok(catalogue.sessions)
}

pub(crate) fn select_remote_session<'a>(
    sessions: &'a [RemoteSessionInfo],
    name: &str,
) -> Result<&'a RemoteSessionInfo, RemoteSessionDiscoveryError> {
    validate_session(name)
        .map_err(|error| RemoteSessionDiscoveryError::InvalidOutput(error.to_string()))?;
    sessions
        .iter()
        .find(|session| session.name == name)
        .ok_or_else(|| RemoteSessionDiscoveryError::SessionNotFound(name.to_owned()))
}

/// Run the fixed local Herdr catalogue command.  Both pipes are drained by
/// bounded readers so a broken executable cannot make the bridge retain
/// unbounded machine-controlled output.
pub(crate) fn read_machine_catalogue(
    executable: &Path,
) -> Result<Vec<MachineProfile>, MachineDiscoveryError> {
    read_machine_catalogue_with_timeout(executable, MACHINE_COMMAND_TIMEOUT)
}

fn wait_for_child_with_timeout(
    child: &mut Child,
    timeout: Duration,
) -> io::Result<(ExitStatus, bool)> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok((status, false)),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                return child.wait().map(|status| (status, true));
            }
            Ok(None) => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                thread::sleep(remaining.min(Duration::from_millis(10)));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        }
    }
}

fn read_machine_catalogue_with_timeout(
    executable: &Path,
    timeout: Duration,
) -> Result<Vec<MachineProfile>, MachineDiscoveryError> {
    let plan = MachineListPlan::new(executable.to_owned()).map_err(|error| {
        MachineDiscoveryError::CommandFailed {
            status: None,
            stderr: bounded_diagnostic(error.to_string().as_bytes(), MAX_COMMAND_DIAGNOSTIC_BYTES),
        }
    })?;
    let args = plan.argv();
    let mut child = Command::new(&args[0])
        .args(&args[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| MachineDiscoveryError::CommandFailed {
            status: None,
            stderr: bounded_diagnostic(error.to_string().as_bytes(), MAX_COMMAND_DIAGNOSTIC_BYTES),
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| MachineDiscoveryError::CommandFailed {
            status: None,
            stderr: "machine list stdout was not piped".into(),
        })?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| MachineDiscoveryError::CommandFailed {
            status: None,
            stderr: "machine list stderr was not piped".into(),
        })?;
    let stdout_reader =
        thread::spawn(move || capture_bounded_bytes(stdout, MAX_MACHINE_CATALOGUE_BYTES));
    let stderr_reader =
        thread::spawn(move || capture_bounded_bytes(stderr, MAX_COMMAND_DIAGNOSTIC_BYTES));
    let wait_result = wait_for_child_with_timeout(&mut child, timeout);
    let stdout_result = stdout_reader
        .join()
        .map_err(|_| io::Error::other("machine list stdout reader panicked"))
        .and_then(|result| result);
    let stderr_result = stderr_reader
        .join()
        .map_err(|_| io::Error::other("machine list stderr reader panicked"))
        .and_then(|result| result);
    let (status, timed_out) =
        wait_result.map_err(|error| MachineDiscoveryError::CommandFailed {
            status: None,
            stderr: bounded_diagnostic(error.to_string().as_bytes(), MAX_COMMAND_DIAGNOSTIC_BYTES),
        })?;
    let (stdout, stdout_truncated) =
        stdout_result.map_err(|error| MachineDiscoveryError::CommandFailed {
            status: status.code(),
            stderr: bounded_diagnostic(error.to_string().as_bytes(), MAX_COMMAND_DIAGNOSTIC_BYTES),
        })?;
    let (stderr, stderr_truncated) =
        stderr_result.map_err(|error| MachineDiscoveryError::CommandFailed {
            status: status.code(),
            stderr: bounded_diagnostic(error.to_string().as_bytes(), MAX_COMMAND_DIAGNOSTIC_BYTES),
        })?;
    if stdout_truncated {
        return Err(MachineDiscoveryError::OversizedOutput);
    }
    let stderr = if stderr_truncated {
        let mut message = bounded_diagnostic(&stderr, MAX_COMMAND_DIAGNOSTIC_BYTES);
        if !message.ends_with("[truncated]") {
            message.push_str(" [truncated]");
        }
        message.into_bytes()
    } else {
        stderr
    };
    if timed_out {
        let detail = bounded_diagnostic(&stderr, MAX_COMMAND_DIAGNOSTIC_BYTES);
        let message = if detail.is_empty() {
            "machine list command timed out".to_owned()
        } else {
            format!("machine list command timed out: {detail}")
        };
        return Err(MachineDiscoveryError::CommandFailed {
            status: status.code(),
            stderr: bounded_diagnostic(message.as_bytes(), MAX_COMMAND_DIAGNOSTIC_BYTES),
        });
    }
    decode_machine_command_output(status.success(), status.code(), &stdout, &stderr)
}

#[derive(Debug, Clone)]
pub(crate) struct MachineListPlan {
    executable: PathBuf,
}

impl MachineListPlan {
    pub(crate) fn new(executable: PathBuf) -> Result<Self, PlanError> {
        validate_local_executable(&executable)?;
        Ok(Self { executable })
    }

    pub(crate) fn argv(&self) -> Vec<OsString> {
        vec![
            self.executable.as_os_str().to_owned(),
            OsString::from("machine"),
            OsString::from("list"),
            OsString::from("--json"),
        ]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemoteSessionOperation {
    SessionList,
    ClientBridge,
}

#[derive(Debug, Clone)]
pub(crate) struct RemoteSessionPlan {
    target: String,
    executable: String,
    session: String,
    operation: RemoteSessionOperation,
    ssh_config: Option<PathBuf>,
}

impl RemoteSessionPlan {
    pub(crate) fn new(
        profile: &MachineProfile,
        executable: impl Into<String>,
        operation: RemoteSessionOperation,
        ssh_config: Option<PathBuf>,
    ) -> Result<Self, PlanError> {
        profile.validate()?;
        let executable = executable.into();
        validate_remote_executable(&executable)?;
        if let Some(path) = &ssh_config {
            validate_config_path(path)?;
        }
        Ok(Self {
            target: profile.target.clone(),
            executable,
            session: profile.session.clone(),
            operation,
            ssh_config,
        })
    }

    pub(crate) fn remote_command(&self) -> String {
        let executable = quote_remote_executable(&self.executable);
        let session = if self.operation == RemoteSessionOperation::ClientBridge
            && self.session != "default"
        {
            format!(" --session {}", shell_quote(&self.session))
        } else {
            String::new()
        };
        let operation = match self.operation {
            RemoteSessionOperation::SessionList => "session list --json",
            RemoteSessionOperation::ClientBridge => "remote-client-bridge",
        };
        let prefix = if self.operation == RemoteSessionOperation::ClientBridge {
            "exec "
        } else {
            ""
        };
        format!("{prefix}{executable}{session} {operation}")
    }

    pub(crate) fn ssh_argv(&self) -> Vec<OsString> {
        noninteractive_ssh_args(self.ssh_config.as_deref(), &self.target)
            .into_iter()
            .chain([OsString::from(self.remote_command())])
            .collect()
    }
}

fn validate_remote_executable(executable: &str) -> Result<(), PlanError> {
    validate_text(executable, MAX_EXECUTABLE_BYTES, "remote Herdr executable")?;
    if executable.starts_with('-') {
        return Err(plan_error(
            "remote Herdr executable must be an absolute path or a $HOME path",
        ));
    }
    if let Some(suffix) = executable.strip_prefix("$HOME/") {
        if suffix.is_empty()
            || !suffix.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'/' | b'-')
            })
        {
            return Err(plan_error(
                "remote $HOME executable path contains shell-sensitive characters",
            ));
        }
    } else if !executable.starts_with('/') {
        return Err(plan_error(
            "remote Herdr executable must be an absolute path or a $HOME path",
        ));
    }
    Ok(())
}

fn shell_quote(value: &str) -> String {
    if value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'/' | b'-'))
    {
        return value.to_owned();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn quote_remote_executable(executable: &str) -> String {
    if executable.starts_with("$HOME/") {
        format!("\"{executable}\"")
    } else {
        shell_quote(executable)
    }
}

fn noninteractive_ssh_options(config: Option<&Path>) -> Vec<OsString> {
    let mut args = Vec::new();
    if let Some(config) = config {
        args.push(OsString::from("-F"));
        args.push(config.as_os_str().to_owned());
    }
    for (option, value) in [
        ("BatchMode", "yes"),
        ("NumberOfPasswordPrompts", "0"),
        ("StrictHostKeyChecking", "yes"),
        ("ConnectTimeout", "10"),
        ("ConnectionAttempts", "1"),
        ("ServerAliveInterval", "15"),
        ("ServerAliveCountMax", "4"),
    ] {
        args.push(OsString::from("-o"));
        args.push(OsString::from(format!("{option}={value}")));
    }
    args
}

fn noninteractive_ssh_args(config: Option<&Path>, target: &str) -> Vec<OsString> {
    let mut args = noninteractive_ssh_options(config);
    args.push(OsString::from("-T"));
    args.push(OsString::from(target));
    args
}

#[derive(Debug, Clone)]
pub(crate) struct OpenSshForwardPlan {
    target: String,
    local_socket: PathBuf,
    remote_socket: PathBuf,
    ssh_config: Option<PathBuf>,
}

impl OpenSshForwardPlan {
    pub(crate) fn new(
        target: impl Into<String>,
        local_socket: PathBuf,
        remote_socket: PathBuf,
    ) -> Result<Self, PlanError> {
        Self::with_ssh_config(target, local_socket, remote_socket, None)
    }

    pub(crate) fn with_ssh_config(
        target: impl Into<String>,
        local_socket: PathBuf,
        remote_socket: PathBuf,
        ssh_config: Option<PathBuf>,
    ) -> Result<Self, PlanError> {
        let target = target.into();
        validate_target(&target)?;
        validate_socket_path(&local_socket, "local socket")?;
        validate_socket_path(&remote_socket, "remote socket")?;
        if let Some(path) = &ssh_config {
            validate_config_path(path)?;
        }
        Ok(Self {
            target,
            local_socket,
            remote_socket,
            ssh_config,
        })
    }

    pub(crate) fn local_socket(&self) -> &Path {
        &self.local_socket
    }

    pub(crate) fn remote_socket(&self) -> &Path {
        &self.remote_socket
    }

    pub(crate) fn argv(&self) -> Vec<OsString> {
        let mut args = noninteractive_ssh_options(self.ssh_config.as_deref());
        args.extend([
            OsString::from("-T"),
            OsString::from("-N"),
            OsString::from("-o"),
            OsString::from("ExitOnForwardFailure=yes"),
            OsString::from("-o"),
            OsString::from("StreamLocalBindUnlink=yes"),
            OsString::from("-L"),
            OsString::from(format!(
                "{}:{}",
                self.local_socket.display(),
                self.remote_socket.display()
            )),
            OsString::from("--"),
            OsString::from(&self.target),
        ]);
        args
    }

    #[cfg(test)]
    fn effective_config_argv(&self) -> Vec<OsString> {
        let mut args = vec![OsString::from("-G")];
        args.extend(self.argv());
        args
    }
}

fn validate_private_root(root: &Path) -> io::Result<()> {
    if !root.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "forward socket root must be absolute",
        ));
    }
    if root
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "forward socket root may not contain relative traversal",
        ));
    }
    let mut current = Some(root);
    while let Some(path) = current {
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "forward socket root has a symlinked ancestor",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        current = path.parent();
    }
    Ok(())
}

fn ensure_private_forward_root(root: &Path) -> io::Result<()> {
    let mut missing = Vec::new();
    let mut current = root.to_owned();
    loop {
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "forward socket root must be a real directory",
                    ));
                }
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                missing.push(current.clone());
                current = current
                    .parent()
                    .ok_or_else(|| {
                        io::Error::new(
                            io::ErrorKind::InvalidInput,
                            "forward socket root has no existing parent",
                        )
                    })?
                    .to_owned();
            }
            Err(error) => return Err(error),
        }
    }
    for path in missing.into_iter().rev() {
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        match builder.create(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
        crate::store_util::ensure_private_owned_dir(&path)?;
    }
    crate::store_util::ensure_private_owned_dir(root)
}

pub(crate) struct ForwardSocketLease {
    directory: PathBuf,
    socket: PathBuf,
}

impl std::fmt::Debug for ForwardSocketLease {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ForwardSocketLease")
            .field("directory", &self.directory)
            .field("socket", &self.socket)
            .finish()
    }
}

impl ForwardSocketLease {
    pub(crate) fn create(root: &Path) -> io::Result<Self> {
        validate_private_root(root)?;
        ensure_private_forward_root(root)?;
        for _ in 0..8 {
            let sequence = LEASE_COUNTER.fetch_add(1, Ordering::Relaxed);
            let directory = root.join(format!("generation-{}-{sequence}", std::process::id()));
            match fs::create_dir(&directory) {
                Ok(()) => {
                    if let Err(error) = crate::store_util::ensure_private_owned_dir(&directory) {
                        let _ = fs::remove_dir(&directory);
                        return Err(error);
                    }
                    let socket = directory.join("api.sock");
                    if let Err(error) = validate_socket_path(&socket, "local socket") {
                        let _ = fs::remove_dir(&directory);
                        return Err(io::Error::new(io::ErrorKind::InvalidInput, error));
                    }
                    return Ok(Self { directory, socket });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not allocate a unique forwarding socket lease",
        ))
    }

    pub(crate) fn socket_path(&self) -> &Path {
        &self.socket
    }

    fn ensure_unused(&self) -> io::Result<()> {
        match fs::symlink_metadata(&self.socket) {
            Ok(_) => Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "forward socket path already exists",
            )),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

impl Drop for ForwardSocketLease {
    fn drop(&mut self) {
        match fs::symlink_metadata(&self.socket) {
            Ok(metadata) if !metadata.file_type().is_dir() => {
                let _ = fs::remove_file(&self.socket);
            }
            _ => {}
        }
        let _ = fs::remove_dir(&self.directory);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ForwardExit {
    pub(crate) status: ExitStatus,
    pub(crate) stderr: String,
}

#[derive(Debug, Clone)]
pub(crate) enum ForwardPoll {
    Running,
    Exited(ForwardExit),
}

pub(crate) struct SshForwarder {
    child: Child,
    lease: ForwardSocketLease,
    stderr_reader: Option<JoinHandle<io::Result<String>>>,
    exit: Option<ForwardExit>,
}

impl std::fmt::Debug for SshForwarder {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SshForwarder")
            .field("lease", &self.lease)
            .field("exit", &self.exit)
            .finish_non_exhaustive()
    }
}

impl SshForwarder {
    pub(crate) fn spawn(plan: &OpenSshForwardPlan, lease: ForwardSocketLease) -> io::Result<Self> {
        lease.ensure_unused()?;
        let args = plan.argv();
        let mut command = Command::new("ssh");
        command
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        let child = command.spawn()?;
        Self::from_child(plan, lease, child)
    }

    pub(crate) fn spawn_with<F>(
        plan: &OpenSshForwardPlan,
        lease: ForwardSocketLease,
        spawn: F,
    ) -> io::Result<Self>
    where
        F: FnOnce(&[OsString]) -> io::Result<Child>,
    {
        lease.ensure_unused()?;
        let args = plan.argv();
        let child = spawn(&args)?;
        Self::from_child(plan, lease, child)
    }

    fn from_child(
        plan: &OpenSshForwardPlan,
        lease: ForwardSocketLease,
        mut child: Child,
    ) -> io::Result<Self> {
        if plan.local_socket() != lease.socket_path() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "forward process and socket lease do not agree",
            ));
        }
        let stderr_reader = child
            .stderr
            .take()
            .map(|stderr| thread::spawn(move || capture_bounded(stderr, MAX_SSH_STDERR_BYTES)));
        Ok(Self {
            child,
            lease,
            stderr_reader,
            exit: None,
        })
    }

    pub(crate) fn socket_path(&self) -> &Path {
        self.lease.socket_path()
    }

    fn collect_stderr(&mut self) -> io::Result<String> {
        let Some(reader) = self.stderr_reader.take() else {
            return Ok(String::new());
        };
        reader
            .join()
            .map_err(|_| io::Error::other("SSH stderr reader panicked"))?
    }

    pub(crate) fn poll(&mut self) -> io::Result<ForwardPoll> {
        if let Some(exit) = &self.exit {
            return Ok(ForwardPoll::Exited(exit.clone()));
        }
        let Some(status) = self.child.try_wait()? else {
            return Ok(ForwardPoll::Running);
        };
        let exit = ForwardExit {
            status,
            stderr: self.collect_stderr()?,
        };
        self.exit = Some(exit.clone());
        Ok(ForwardPoll::Exited(exit))
    }

    pub(crate) fn cancel(&mut self) -> io::Result<ForwardExit> {
        if let Some(exit) = &self.exit {
            return Ok(exit.clone());
        }
        let status = match self.child.try_wait()? {
            Some(status) => status,
            None => {
                let _ = self.child.kill();
                self.child.wait()?
            }
        };
        let exit = ForwardExit {
            status,
            stderr: self.collect_stderr()?,
        };
        self.exit = Some(exit.clone());
        Ok(exit)
    }

    pub(crate) fn wait_until_ready<F>(
        &mut self,
        timeout: Duration,
        poll_interval: Duration,
        mut probe: F,
    ) -> Result<(), ForwardReadinessError>
    where
        F: FnMut(&Path) -> io::Result<bool>,
    {
        let deadline = Instant::now() + timeout;
        loop {
            match self
                .poll()
                .map_err(|error| ForwardReadinessError::Io(error.to_string()))?
            {
                ForwardPoll::Running => {}
                ForwardPoll::Exited(exit) => return Err(ForwardReadinessError::Process(exit)),
            }
            match probe(self.socket_path()) {
                Ok(true) => return Ok(()),
                Ok(false) => {}
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                    ) => {}
                Err(error) => return Err(ForwardReadinessError::Probe(error.to_string())),
            }
            if Instant::now() >= deadline {
                return Err(ForwardReadinessError::Timeout {
                    socket: self.socket_path().to_owned(),
                });
            }
            thread::sleep(poll_interval.min(Duration::from_millis(50)));
        }
    }

    #[cfg(unix)]
    pub(crate) fn wait_until_unix_socket_ready(
        &mut self,
        timeout: Duration,
        poll_interval: Duration,
    ) -> Result<(), ForwardReadinessError> {
        self.wait_until_ready(timeout, poll_interval, |path| {
            use std::os::unix::net::UnixStream;

            match UnixStream::connect(path) {
                Ok(stream) => {
                    drop(stream);
                    Ok(true)
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::NotFound
                            | io::ErrorKind::ConnectionRefused
                            | io::ErrorKind::NotConnected
                            | io::ErrorKind::InvalidInput
                    ) =>
                {
                    Ok(false)
                }
                Err(error) => Err(error),
            }
        })
    }
}

impl Drop for SshForwarder {
    fn drop(&mut self) {
        let _ = self.cancel();
    }
}

fn capture_bounded_bytes(mut reader: impl Read, limit: usize) -> io::Result<(Vec<u8>, bool)> {
    let mut kept = Vec::with_capacity(limit.min(4096));
    let mut buffer = [0u8; 4096];
    let mut truncated = false;
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        if kept.len() < limit {
            let take = (limit - kept.len()).min(count);
            kept.extend_from_slice(&buffer[..take]);
            truncated |= take < count;
        } else {
            truncated = true;
        }
    }
    Ok((kept, truncated))
}

fn capture_bounded(mut reader: impl Read, limit: usize) -> io::Result<String> {
    let (kept, truncated) = capture_bounded_bytes(&mut reader, limit)?;
    let mut text = String::from_utf8_lossy(&kept).trim().to_owned();
    if truncated {
        text.push_str(" [truncated]");
    }
    Ok(text)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ForwardReadinessError {
    Process(ForwardExit),
    Timeout { socket: PathBuf },
    Probe(String),
    Io(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ForwardConfigFailure {
    InvalidOutput(String),
    MissingRequiredForward { local: PathBuf, remote: PathBuf },
}

pub(crate) fn verify_required_forward(
    effective_config: &[u8],
    local: &Path,
    remote: &Path,
) -> Result<(), ForwardConfigFailure> {
    let text = std::str::from_utf8(effective_config)
        .map_err(|error| ForwardConfigFailure::InvalidOutput(error.to_string()))?;
    let local = local.display().to_string();
    let remote = remote.display().to_string();
    if text.lines().any(|line| {
        let mut fields = line.split_whitespace();
        fields.next() == Some("localforward")
            && fields.next() == Some(local.as_str())
            && fields.next() == Some(remote.as_str())
            && fields.next().is_none()
    }) {
        Ok(())
    } else {
        Err(ForwardConfigFailure::MissingRequiredForward {
            local: PathBuf::from(local),
            remote: PathBuf::from(remote),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum MachineFailureKind {
    Attention,
    Incompatible,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MachineFailure {
    pub(crate) machine_id: String,
    pub(crate) kind: MachineFailureKind,
    pub(crate) message: String,
}

#[derive(Debug, Clone)]
pub(crate) enum MachineForwardFailure {
    Configuration(ForwardConfigFailure),
    Process(ForwardExit),
    Readiness(ForwardReadinessError),
}

pub(crate) fn classify_machine_forward_failure(
    profile: &MachineProfile,
    failure: MachineForwardFailure,
) -> MachineFailure {
    let (kind, message) = match failure {
        MachineForwardFailure::Configuration(error) => {
            let kind = match &error {
                ForwardConfigFailure::InvalidOutput(_) => MachineFailureKind::Attention,
                ForwardConfigFailure::MissingRequiredForward { .. } => {
                    MachineFailureKind::Incompatible
                }
            };
            (
                kind,
                format!("saved target forwarding configuration failed: {error:?}"),
            )
        }
        MachineForwardFailure::Process(exit) => (
            MachineFailureKind::Attention,
            format!(
                "SSH forwarding exited with {}: {}",
                exit.status, exit.stderr
            ),
        ),
        MachineForwardFailure::Readiness(error) => (
            MachineFailureKind::Attention,
            format!("SSH forwarding did not become ready: {error:?}"),
        ),
    };
    MachineFailure {
        machine_id: profile.id.clone(),
        kind,
        message: bounded_diagnostic(message.as_bytes(), MAX_COMMAND_DIAGNOSTIC_BYTES),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_root(label: &str) -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let path = std::env::temp_dir().join(format!(
            "herdr-world-native-{label}-{}-{timestamp}-{id}",
            std::process::id(),
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    fn profile() -> MachineProfile {
        MachineProfile {
            id: "0123456789abcdef0123456789abcdef".into(),
            label: "Synthetic build machine".into(),
            target: "synthetic-saved-target".into(),
            session: "agents".into(),
            enabled: true,
            selected: false,
        }
    }

    fn plan(root: &Path) -> OpenSshForwardPlan {
        OpenSshForwardPlan::new(
            "synthetic-saved-target",
            root.join("api.sock"),
            PathBuf::from("/tmp/herdr-remote-api.sock"),
        )
        .unwrap()
    }

    fn spawn_shell(script: &str) -> Child {
        Command::new("sh")
            .args(["-c", script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap()
    }

    fn ssh_effective_config(plan: &OpenSshForwardPlan) -> std::process::Output {
        Command::new("ssh")
            .args(plan.effective_config_argv())
            .output()
            .unwrap()
    }

    #[test]
    fn catalogue_accepts_valid_enabled_and_disabled_rows_but_browser_descriptor_is_safe() {
        let json = br#"[
          {"id":"0123456789abcdef0123456789abcdef","label":"Build","target":"buildbox","session":"agents","enabled":true,"selected":false},
          {"id":"abcdef0123456789abcdef0123456789","label":"Offline","target":"offlinebox","session":"default","enabled":false,"selected":true}
        ]"#;
        let rows = parse_machine_catalogue(json).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].browser_descriptor().enabled, false);
        let encoded = serde_json::to_string(&rows[0].browser_descriptor()).unwrap();
        assert!(!encoded.contains("target"));
        assert!(!encoded.contains("session"));
    }

    #[test]
    fn catalogue_rejects_duplicate_unknown_malformed_and_oversized_rows() {
        let duplicate = serde_json::to_vec(&vec![profile(), profile()]).unwrap();
        assert!(matches!(
            parse_machine_catalogue(&duplicate),
            Err(MachineDiscoveryError::DuplicateId(_))
        ));
        let unknown = br#"[{"id":"0123456789abcdef0123456789abcdef","label":"x","target":"h","session":"s","enabled":true,"selected":false,"password":"secret"}]"#;
        assert!(matches!(
            parse_machine_catalogue(unknown),
            Err(MachineDiscoveryError::InvalidCatalogue(_))
        ));
        let malformed = b"[{\"id\":".to_vec();
        assert!(matches!(
            parse_machine_catalogue(&malformed),
            Err(MachineDiscoveryError::InvalidCatalogue(_))
        ));
        let oversized = vec![b'x'; MAX_MACHINE_CATALOGUE_BYTES + 1];
        assert_eq!(
            parse_machine_catalogue(&oversized),
            Err(MachineDiscoveryError::OversizedOutput)
        );
    }

    #[test]
    fn catalogue_rejects_blank_labels_and_passwords_in_plain_ssh_targets() {
        let blank_label = br#"[{"id":"0123456789abcdef0123456789abcdef","label":"   ","target":"buildbox","session":"agents","enabled":true,"selected":false}]"#;
        assert!(matches!(
            parse_machine_catalogue(blank_label),
            Err(MachineDiscoveryError::InvalidCatalogue(_))
        ));
        let password_target = br#"[{"id":"0123456789abcdef0123456789abcdef","label":"Build","target":"user:password@buildbox","session":"agents","enabled":true,"selected":false}]"#;
        assert!(matches!(
            parse_machine_catalogue(password_target),
            Err(MachineDiscoveryError::InvalidCatalogue(_))
        ));
    }

    #[test]
    fn remote_session_catalogue_selects_the_authoritative_session_socket() {
        let json = br#"{"sessions":[{"name":"default","default":true,"running":false,"socket_path":"/run/herdr/default.sock","session_dir":"/run/herdr"},{"name":"agents","default":false,"running":true,"socket_path":"/run/herdr/agents.sock","session_dir":"/run/herdr/agents"}]}"#;
        let sessions = parse_remote_session_catalogue(json).unwrap();
        let selected = select_remote_session(&sessions, "agents").unwrap();
        assert!(selected.running);
        assert_eq!(
            selected.socket_path,
            PathBuf::from("/run/herdr/agents.sock")
        );
        assert!(select_remote_session(&sessions, "missing").is_err());
    }

    #[test]
    fn remote_session_catalogue_rejects_unknown_duplicate_and_oversized_data() {
        let unknown = br#"{"sessions":[{"name":"default","default":true,"running":false,"socket_path":"/run/default.sock","session_dir":"/run","secret":"no"}]}"#;
        assert!(matches!(
            parse_remote_session_catalogue(unknown),
            Err(RemoteSessionDiscoveryError::InvalidOutput(_))
        ));
        let duplicate = br#"{"sessions":[{"name":"default","default":true,"running":false,"socket_path":"/run/default.sock","session_dir":"/run"},{"name":"default","default":true,"running":false,"socket_path":"/run/other.sock","session_dir":"/run"}]}"#;
        assert!(matches!(
            parse_remote_session_catalogue(duplicate),
            Err(RemoteSessionDiscoveryError::DuplicateName(_))
        ));
        let oversized = vec![b'x'; MAX_SESSION_CATALOGUE_BYTES + 1];
        assert_eq!(
            parse_remote_session_catalogue(&oversized),
            Err(RemoteSessionDiscoveryError::OversizedOutput)
        );
    }

    #[test]
    fn machine_command_failure_is_bounded() {
        let stderr = vec![b'e'; MAX_COMMAND_DIAGNOSTIC_BYTES + 100];
        let error = decode_machine_command_output(false, Some(23), b"[]", &stderr).unwrap_err();
        match error {
            MachineDiscoveryError::CommandFailed { status, stderr } => {
                assert_eq!(status, Some(23));
                assert!(stderr.len() <= MAX_COMMAND_DIAGNOSTIC_BYTES + " [truncated]".len());
                assert!(stderr.ends_with("[truncated]"));
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn machine_list_plan_uses_only_the_resolved_executable_and_fixed_command() {
        let plan = MachineListPlan::new(PathBuf::from("/opt/herdr/bin/herdr")).unwrap();
        let args = plan
            .argv()
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            args,
            vec!["/opt/herdr/bin/herdr", "machine", "list", "--json"]
        );
        assert!(MachineListPlan::new(PathBuf::from("herdr")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn machine_catalogue_adapter_runs_the_resolved_executable_with_bounded_output() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_root("machine-command");
        let executable = root.join("herdr");
        let temporary = root.join("herdr.tmp");
        fs::write(
            &temporary,
            "#!/bin/sh\nprintf '%s\\n' '[{\"id\":\"0123456789abcdef0123456789abcdef\",\"label\":\"Build\",\"target\":\"buildbox\",\"session\":\"agents\",\"enabled\":true,\"selected\":false}]'\n",
        )
        .unwrap();
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o700)).unwrap();
        fs::rename(&temporary, &executable).unwrap();
        let rows = read_machine_catalogue(&executable).unwrap();
        assert_eq!(rows[0].label, "Build");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn machine_catalogue_adapter_surfaces_command_failure_without_global_failure() {
        let error = read_machine_catalogue(Path::new("/bin/sh")).unwrap_err();
        match error {
            MachineDiscoveryError::CommandFailed { status, stderr } => {
                assert_ne!(status, Some(0));
                assert!(!stderr.is_empty());
                assert!(stderr.len() <= MAX_COMMAND_DIAGNOSTIC_BYTES + " [truncated]".len());
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn machine_catalogue_timeout_kills_and_reaps_a_hung_command() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_root("machine-timeout");
        let executable = root.join("herdr");
        let temporary = root.join("herdr.tmp");
        fs::write(
            &temporary,
            "#!/bin/sh\ni=0\nwhile [ $i -lt 20000 ]; do printf o; printf e >&2; i=$((i+1)); done\nwhile :; do :; done\n",
        )
        .unwrap();
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o700)).unwrap();
        fs::rename(&temporary, &executable).unwrap();
        let started = Instant::now();
        let error = read_machine_catalogue_with_timeout(&executable, Duration::from_millis(20))
            .unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(2));
        match error {
            MachineDiscoveryError::CommandFailed { status, stderr } => {
                assert_ne!(status, Some(0));
                assert!(stderr.contains("timed out"), "stderr={stderr:?}");
            }
            other => panic!("unexpected error: {other:?}"),
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_plans_use_herdr_v09_fixed_session_and_bridge_commands() {
        let profile = profile();
        let sessions = RemoteSessionPlan::new(
            &profile,
            "/home/synthetic/.local/bin/herdr",
            RemoteSessionOperation::SessionList,
            None,
        )
        .unwrap();
        assert_eq!(
            sessions.remote_command(),
            "/home/synthetic/.local/bin/herdr session list --json"
        );
        let bridge = RemoteSessionPlan::new(
            &profile,
            "$HOME/.local/bin/herdr",
            RemoteSessionOperation::ClientBridge,
            None,
        )
        .unwrap();
        assert_eq!(
            bridge.remote_command(),
            "exec \"$HOME/.local/bin/herdr\" --session agents remote-client-bridge"
        );
        assert_eq!(
            bridge.ssh_argv().last().unwrap(),
            OsStr::new(&bridge.remote_command())
        );
    }

    #[test]
    fn forwarding_argv_preserves_herdr_noninteractive_options_and_never_clears_config() {
        let root = temp_root("argv");
        let plan = plan(&root);
        let args = plan
            .argv()
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(args.windows(2).any(|pair| pair == ["-o", "BatchMode=yes"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "NumberOfPasswordPrompts=0"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "StrictHostKeyChecking=yes"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "ConnectTimeout=10"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "ConnectionAttempts=1"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "ServerAliveInterval=15"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "ServerAliveCountMax=4"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "ExitOnForwardFailure=yes"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "StreamLocalBindUnlink=yes"]));
        let required_forward = format!(
            "{}:/tmp/herdr-remote-api.sock",
            root.join("api.sock").display()
        );
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "-L" && pair[1] == required_forward));
        assert!(args.windows(2).any(|pair| pair == ["-T", "-N"]));
        assert!(!args.iter().any(|arg| arg == "ClearAllForwardings=yes"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn effective_config_mode_passes_the_production_argv_unchanged() {
        let root = temp_root("effective-argv");
        let plan = plan(&root);
        let production = plan.argv();
        let effective = plan.effective_config_argv();
        assert_eq!(effective.first(), Some(&OsString::from("-G")));
        assert_eq!(&effective[1..], production.as_slice());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn installed_ssh_effective_config_keeps_required_and_saved_target_forward() {
        let root = temp_root("ssh-config-success");
        let config = root.join("ssh_config");
        let configured_local = root.join("configured.sock");
        let configured_remote = PathBuf::from("/tmp/configured-remote.sock");
        fs::write(
            &config,
            format!(
                "Host synthetic-saved-target\n  HostName 192.0.2.1\n  User synthetic\n  LocalForward {} {}\n",
                configured_local.display(),
                configured_remote.display()
            ),
        )
        .unwrap();
        let plan = OpenSshForwardPlan::with_ssh_config(
            "synthetic-saved-target",
            root.join("api.sock"),
            PathBuf::from("/tmp/herdr-remote-api.sock"),
            Some(config),
        )
        .unwrap();
        let output = ssh_effective_config(&plan);
        assert!(
            output.status.success(),
            "ssh -G failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        verify_required_forward(&output.stdout, plan.local_socket(), plan.remote_socket()).unwrap();
        let text = String::from_utf8_lossy(&output.stdout);
        assert!(text.lines().any(|line| {
            line == format!(
                "localforward {} {}",
                configured_local.display(),
                configured_remote.display()
            )
        }));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn installed_ssh_effective_config_parses_uri_target_with_production_argv() {
        let root = temp_root("ssh-uri");
        let plan = OpenSshForwardPlan::new(
            "ssh://synthetic@192.0.2.1",
            root.join("api.sock"),
            PathBuf::from("/tmp/herdr-remote-api.sock"),
        )
        .unwrap();
        let output = ssh_effective_config(&plan);
        assert!(
            output.status.success(),
            "ssh -G failed for URI target: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        verify_required_forward(&output.stdout, plan.local_socket(), plan.remote_socket()).unwrap();
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn saved_target_clear_all_forwardings_is_machine_scoped_incompatibility() {
        let root = temp_root("ssh-config-failure");
        let config = root.join("ssh_config");
        let configured_local = root.join("configured.sock");
        let configured_remote = PathBuf::from("/tmp/configured-remote.sock");
        fs::write(
            &config,
            format!(
                "Host synthetic-saved-target\n  HostName 192.0.2.1\n  ClearAllForwardings yes\n  LocalForward {} {}\n",
                configured_local.display(),
                configured_remote.display()
            ),
        )
        .unwrap();
        let plan = OpenSshForwardPlan::with_ssh_config(
            "synthetic-saved-target",
            root.join("api.sock"),
            PathBuf::from("/tmp/herdr-remote-api.sock"),
            Some(config),
        )
        .unwrap();
        let output = ssh_effective_config(&plan);
        assert!(
            output.status.success(),
            "ssh -G failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let effective = String::from_utf8_lossy(&output.stdout);
        assert!(!effective.lines().any(|line| {
            line == format!(
                "localforward {} {}",
                configured_local.display(),
                configured_remote.display()
            )
        }));
        let config_error =
            verify_required_forward(&output.stdout, plan.local_socket(), plan.remote_socket())
                .unwrap_err();
        let failure = classify_machine_forward_failure(
            &profile(),
            MachineForwardFailure::Configuration(config_error),
        );
        assert_eq!(failure.machine_id, profile().id);
        assert_eq!(failure.kind, MachineFailureKind::Incompatible);
        assert!(!failure.message.contains("gateway"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn malformed_effective_config_is_machine_attention_not_incompatibility() {
        let failure = classify_machine_forward_failure(
            &profile(),
            MachineForwardFailure::Configuration(ForwardConfigFailure::InvalidOutput(
                "invalid UTF-8".into(),
            )),
        );
        assert_eq!(failure.machine_id, profile().id);
        assert_eq!(failure.kind, MachineFailureKind::Attention);
    }

    #[cfg(unix)]
    #[test]
    fn socket_lease_is_private_and_cleans_only_its_owned_path() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root("lease");
        let lease = ForwardSocketLease::create(&root).unwrap();
        assert_eq!(
            fs::metadata(&root).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(lease.socket_path().parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        let listener = std::os::unix::net::UnixListener::bind(lease.socket_path()).unwrap();
        drop(listener);
        let path = lease.socket_path().to_owned();
        let directory = path.parent().unwrap().to_owned();
        drop(lease);
        assert!(!path.exists());
        assert!(!directory.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn socket_lease_creates_missing_private_root_components() {
        let base = temp_root("nested-root");
        let root = base.join("runtime").join("native");
        let lease = ForwardSocketLease::create(&root).unwrap();
        assert!(root.is_dir());
        let generation = lease.socket_path().parent().unwrap();
        assert!(generation.is_dir());
        drop(lease);
        let _ = fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[test]
    fn socket_lease_rejects_symlinked_ancestor() {
        let root = temp_root("symlink");
        let real = root.join("real");
        let link = root.join("link");
        fs::create_dir(&real).unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(ForwardSocketLease::create(&link.join("child")).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn socket_lease_cleans_generation_when_socket_path_is_too_long() {
        let root = temp_root("long-socket-root").join("r".repeat(80));
        fs::create_dir_all(&root).unwrap();
        assert!(ForwardSocketLease::create(&root).is_err());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn forwarding_rejects_a_precreated_regular_socket_path_before_spawn() {
        let root = temp_root("precreated-regular");
        let lease = ForwardSocketLease::create(&root).unwrap();
        fs::write(lease.socket_path(), b"stale regular file").unwrap();
        let plan = OpenSshForwardPlan::new(
            "synthetic-saved-target",
            lease.socket_path().to_owned(),
            PathBuf::from("/tmp/herdr-remote-api.sock"),
        )
        .unwrap();
        let error = SshForwarder::spawn_with(&plan, lease, |_| {
            panic!("a precreated socket path must be rejected before spawning ssh")
        })
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn forwarding_rejects_a_precreated_unix_socket_path_before_spawn() {
        use std::os::unix::net::UnixListener;

        let root = temp_root("precreated-socket");
        let lease = ForwardSocketLease::create(&root).unwrap();
        let listener = UnixListener::bind(lease.socket_path()).unwrap();
        let plan = OpenSshForwardPlan::new(
            "synthetic-saved-target",
            lease.socket_path().to_owned(),
            PathBuf::from("/tmp/herdr-remote-api.sock"),
        )
        .unwrap();
        let error = SshForwarder::spawn_with(&plan, lease, |_| {
            panic!("a precreated socket path must be rejected before spawning ssh")
        })
        .unwrap_err();
        drop(listener);
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn forwarding_process_reports_bounded_stderr_and_exit_and_cancellation_reaps() {
        let root = temp_root("process");
        let lease = ForwardSocketLease::create(&root).unwrap();
        let plan = OpenSshForwardPlan::new(
            "synthetic-saved-target",
            lease.socket_path().to_owned(),
            PathBuf::from("/tmp/herdr-remote-api.sock"),
        )
        .unwrap();
        let expected_args = plan.argv();
        let mut forwarder = SshForwarder::spawn_with(&plan, lease, |args| {
            // The fixture still uses a local shell, but assert the production
            // argument vector that would be passed to `ssh` before spawning it.
            // This keeps the lifecycle test from becoming a test-only command.
            assert_eq!(args, expected_args.as_slice());
            Ok(spawn_shell(
                "printf 'synthetic ssh failure\\n' >&2; exit 17",
            ))
        })
        .unwrap();
        let exit = loop {
            match forwarder.poll().unwrap() {
                ForwardPoll::Running => thread::sleep(Duration::from_millis(1)),
                ForwardPoll::Exited(exit) => break exit,
            }
        };
        assert_eq!(exit.status.code(), Some(17));
        assert_eq!(exit.stderr, "synthetic ssh failure");
        let machine_failure =
            classify_machine_forward_failure(&profile(), MachineForwardFailure::Process(exit));
        assert_eq!(machine_failure.machine_id, profile().id);
        assert_eq!(machine_failure.kind, MachineFailureKind::Attention);
        let first_directory = forwarder.socket_path().parent().unwrap().to_owned();
        drop(forwarder);
        assert!(!first_directory.exists());

        let lease = ForwardSocketLease::create(&root).unwrap();
        let plan = OpenSshForwardPlan::new(
            "synthetic-saved-target",
            lease.socket_path().to_owned(),
            PathBuf::from("/tmp/herdr-remote-api.sock"),
        )
        .unwrap();
        let mut forwarder =
            SshForwarder::spawn_with(&plan, lease, |_| Ok(spawn_shell("while :; do :; done")))
                .unwrap();
        let exit = forwarder.cancel().unwrap();
        assert!(exit.status.code().is_some() || !exit.status.success());
        let second_directory = forwarder.socket_path().parent().unwrap().to_owned();
        drop(forwarder);
        assert!(!second_directory.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn readiness_is_separate_from_process_lifetime_and_times_out_cleanly() {
        let root = temp_root("readiness");
        let lease = ForwardSocketLease::create(&root).unwrap();
        let plan = OpenSshForwardPlan::new(
            "synthetic-saved-target",
            lease.socket_path().to_owned(),
            PathBuf::from("/tmp/herdr-remote-api.sock"),
        )
        .unwrap();
        let mut forwarder =
            SshForwarder::spawn_with(&plan, lease, |_| Ok(spawn_shell("while :; do :; done")))
                .unwrap();
        let mut probes = 0;
        forwarder
            .wait_until_ready(Duration::from_millis(50), Duration::from_millis(1), |_| {
                probes += 1;
                Ok(probes > 2)
            })
            .unwrap();
        assert!(probes >= 3);
        let first_directory = forwarder.socket_path().parent().unwrap().to_owned();
        drop(forwarder);
        assert!(!first_directory.exists());

        let lease = ForwardSocketLease::create(&root).unwrap();
        let plan = OpenSshForwardPlan::new(
            "synthetic-saved-target",
            lease.socket_path().to_owned(),
            PathBuf::from("/tmp/herdr-remote-api.sock"),
        )
        .unwrap();
        let mut forwarder =
            SshForwarder::spawn_with(&plan, lease, |_| Ok(spawn_shell("while :; do :; done")))
                .unwrap();
        let error = forwarder
            .wait_until_ready(Duration::from_millis(2), Duration::from_millis(1), |_| {
                Ok(false)
            })
            .unwrap_err();
        assert!(matches!(error, ForwardReadinessError::Timeout { .. }));
        let _ = forwarder.cancel();
        let second_directory = forwarder.socket_path().parent().unwrap().to_owned();
        drop(forwarder);
        assert!(!second_directory.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn unix_socket_readiness_rejects_regular_files_and_stale_sockets() {
        use std::os::unix::net::UnixListener;

        let root = temp_root("stale-readiness");
        let lease = ForwardSocketLease::create(&root).unwrap();
        let plan = OpenSshForwardPlan::new(
            "synthetic-saved-target",
            lease.socket_path().to_owned(),
            PathBuf::from("/tmp/herdr-remote-api.sock"),
        )
        .unwrap();
        let mut forwarder =
            SshForwarder::spawn_with(&plan, lease, |_| Ok(spawn_shell("while :; do :; done")))
                .unwrap();
        fs::write(forwarder.socket_path(), b"stale regular file").unwrap();
        let error = forwarder
            .wait_until_unix_socket_ready(Duration::from_millis(20), Duration::from_millis(1))
            .unwrap_err();
        assert!(matches!(error, ForwardReadinessError::Timeout { .. }));
        let _ = forwarder.cancel();
        drop(forwarder);

        let lease = ForwardSocketLease::create(&root).unwrap();
        let plan = OpenSshForwardPlan::new(
            "synthetic-saved-target",
            lease.socket_path().to_owned(),
            PathBuf::from("/tmp/herdr-remote-api.sock"),
        )
        .unwrap();
        let mut forwarder =
            SshForwarder::spawn_with(&plan, lease, |_| Ok(spawn_shell("while :; do :; done")))
                .unwrap();
        let listener = UnixListener::bind(forwarder.socket_path()).unwrap();
        drop(listener);
        let error = forwarder
            .wait_until_unix_socket_ready(Duration::from_millis(20), Duration::from_millis(1))
            .unwrap_err();
        assert!(matches!(error, ForwardReadinessError::Timeout { .. }));
        let _ = forwarder.cancel();
        drop(forwarder);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn invalid_target_and_remote_executable_are_rejected_before_ssh() {
        assert!(OpenSshForwardPlan::new(
            "ssh://user:password@example",
            PathBuf::from("/tmp/local.sock"),
            PathBuf::from("/tmp/remote.sock")
        )
        .is_err());
        let mut invalid = profile();
        invalid.target = "-oProxyCommand=bad".into();
        assert!(RemoteSessionPlan::new(
            &invalid,
            "/usr/bin/herdr",
            RemoteSessionOperation::SessionList,
            None
        )
        .is_err());
        assert!(RemoteSessionPlan::new(
            &profile(),
            "herdr",
            RemoteSessionOperation::SessionList,
            None
        )
        .is_err());
        assert!(RemoteSessionPlan::new(
            &profile(),
            "$HOME/$(touch /tmp/untrusted)",
            RemoteSessionOperation::SessionList,
            None
        )
        .is_err());
    }

    #[test]
    fn stderr_capture_is_bounded_even_when_child_writes_more_than_limit() {
        let root = temp_root("stderr-bound");
        let lease = ForwardSocketLease::create(&root).unwrap();
        let plan = OpenSshForwardPlan::new(
            "synthetic-saved-target",
            lease.socket_path().to_owned(),
            PathBuf::from("/tmp/herdr-remote-api.sock"),
        )
        .unwrap();
        let mut forwarder = SshForwarder::spawn_with(&plan, lease, |_| {
            Ok(spawn_shell(
                "i=0; while [ $i -lt 20000 ]; do printf e >&2; i=$((i+1)); done; exit 1",
            ))
        })
        .unwrap();
        let exit = loop {
            match forwarder.poll().unwrap() {
                ForwardPoll::Running => thread::sleep(Duration::from_millis(1)),
                ForwardPoll::Exited(exit) => break exit,
            }
        };
        assert!(exit.stderr.len() <= MAX_SSH_STDERR_BYTES + " [truncated]".len());
        assert!(exit.stderr.ends_with("[truncated]"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn effective_forward_parser_rejects_invalid_bytes() {
        let error = verify_required_forward(
            &[0xff],
            Path::new("/tmp/local.sock"),
            Path::new("/tmp/remote.sock"),
        )
        .unwrap_err();
        assert!(matches!(error, ForwardConfigFailure::InvalidOutput(_)));
    }
}
