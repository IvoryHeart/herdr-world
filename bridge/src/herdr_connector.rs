#![allow(
    dead_code,
    reason = "checkpoint connector is exercised directly before runtime-registry integration"
)]

use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

const REMOTE_OUTPUT_READY_MARKER: &str = "herdr-remote-output-ready:1";
const MAX_RELAY_CONNECTIONS: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SessionSelector {
    Default,
    Named(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoteServerStatus {
    pub(crate) running: bool,
    pub(crate) session: String,
    pub(crate) api_socket: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RelaySurface {
    Api,
    Terminal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedHerdrAssignment {
    target: String,
    session: String,
    generation: u64,
    remote_executable: PathBuf,
}

impl ResolvedHerdrAssignment {
    pub(crate) fn resolve(
        target: impl Into<String>,
        selector: SessionSelector,
        generation: u64,
        remote_executable: impl Into<PathBuf>,
        implicit_status: Option<RemoteServerStatus>,
        explicit_status: RemoteServerStatus,
    ) -> io::Result<Self> {
        let target = target.into();
        validate_ssh_target(&target)?;
        let remote_executable = remote_executable.into();
        validate_remote_executable(&remote_executable)?;

        if !explicit_status.running {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionRefused,
                "resolved Herdr session is not running",
            ));
        }
        crate::session::validate_session_name(&explicit_status.session)
            .map_err(|message| io::Error::new(io::ErrorKind::InvalidInput, message))?;
        if explicit_status.api_socket.as_os_str().is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "resolved Herdr API socket is empty",
            ));
        }

        let session = match selector {
            SessionSelector::Named(expected) => {
                crate::session::validate_session_name(&expected)
                    .map_err(|message| io::Error::new(io::ErrorKind::InvalidInput, message))?;
                if explicit_status.session != expected {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "named selector resolved a different session",
                    ));
                }
                expected
            }
            SessionSelector::Default => {
                let implicit = implicit_status.ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        "default selector has no implicit session evidence",
                    )
                })?;
                crate::session::validate_session_name(&implicit.session)
                    .map_err(|message| io::Error::new(io::ErrorKind::InvalidInput, message))?;
                if !implicit.running {
                    return Err(io::Error::new(
                        io::ErrorKind::ConnectionRefused,
                        "default Herdr session is not running",
                    ));
                }
                if implicit.session != explicit_status.session
                    || implicit.api_socket != explicit_status.api_socket
                {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "default status does not identify the explicit session socket",
                    ));
                }
                implicit.session
            }
        };

        Ok(Self {
            target,
            session,
            generation,
            remote_executable,
        })
    }

    pub(crate) fn target(&self) -> &str {
        &self.target
    }

    pub(crate) fn session(&self) -> &str {
        &self.session
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn remote_command(&self, surface: RelaySurface) -> String {
        let relay = match surface {
            RelaySurface::Api => "remote-api-bridge",
            RelaySurface::Terminal => "remote-client-bridge",
        };
        format!(
            "printf '\\n%s\\n' '{}'\nexec {} --session {} {}",
            REMOTE_OUTPUT_READY_MARKER,
            shell_quote(path_text(&self.remote_executable)),
            shell_quote(&self.session),
            relay,
        )
    }
}

fn validate_ssh_target(target: &str) -> io::Result<()> {
    if target.is_empty()
        || target.len() > 255
        || target.starts_with('-')
        || !target.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'@' | b'%' | b'_' | b'+' | b'=' | b':' | b',' | b'.' | b'[' | b']' | b'-'
                )
        })
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "SSH target must be a single host or OpenSSH alias",
        ));
    }
    Ok(())
}

fn validate_remote_executable(path: &Path) -> io::Result<()> {
    let text = path.to_str().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "remote Herdr executable path must be UTF-8",
        )
    })?;
    if !path.is_absolute() || text.contains(['\n', '\r', '\0']) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "remote Herdr executable must be an absolute path",
        ));
    }
    Ok(())
}

fn path_text(path: &Path) -> &str {
    path.to_str()
        .expect("validated remote executable remains valid UTF-8")
}

fn shell_quote(value: &str) -> String {
    if !value.is_empty()
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'@' | b'%' | b'_' | b'+' | b'=' | b':' | b',' | b'.' | b'/' | b'-'
                )
        })
    {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

pub(crate) struct SshHerdrConnector {
    ssh_executable: PathBuf,
    probe_timeout: Duration,
}

impl SshHerdrConnector {
    pub(crate) fn new(ssh_executable: PathBuf) -> io::Result<Self> {
        if !ssh_executable.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "OpenSSH executable must be an absolute path",
            ));
        }
        if !ssh_executable.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "OpenSSH executable was not found",
            ));
        }
        Ok(Self {
            ssh_executable,
            probe_timeout: Duration::from_secs(15),
        })
    }

    pub(crate) fn resolve_assignment(
        &self,
        target: &str,
        selector: SessionSelector,
        generation: u64,
    ) -> io::Result<ResolvedHerdrAssignment> {
        validate_ssh_target(target)?;
        let candidates = self.remote_executable_candidates(target)?;
        let mut compatible = None;
        for candidate in candidates {
            let check_session = match &selector {
                SessionSelector::Default => "default",
                SessionSelector::Named(name) => name.as_str(),
            };
            crate::session::validate_session_name(check_session)
                .map_err(|message| io::Error::new(io::ErrorKind::InvalidInput, message))?;
            let output = self.run_remote(
                target,
                &remote_herdr_command(
                    &candidate,
                    Some(check_session),
                    &["remote-api-bridge", "--check"],
                ),
            );
            match output {
                Ok(value) if value.trim() == "herdr-api-bridge-v1" => {
                    compatible = Some(candidate);
                    break;
                }
                Err(error) => {
                    let failure = RelayFailure::from_error(&error);
                    if matches!(
                        failure.kind(),
                        RelayFailureKind::Authentication
                            | RelayFailureKind::HostVerification
                            | RelayFailureKind::Timeout
                    ) {
                        return Err(error);
                    }
                }
                Ok(_) => {}
            }
        }
        let remote_executable = compatible.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::Unsupported,
                "remote Herdr does not expose the pinned API relay capability",
            )
        })?;

        let (implicit_status, explicit_status) = match &selector {
            SessionSelector::Named(session) => (
                None,
                self.remote_server_status(target, &remote_executable, Some(session))?,
            ),
            SessionSelector::Default => {
                let implicit = self.remote_server_status(target, &remote_executable, None)?;
                let explicit =
                    self.remote_server_status(target, &remote_executable, Some(&implicit.session))?;
                (Some(implicit), explicit)
            }
        };

        ResolvedHerdrAssignment::resolve(
            target,
            selector,
            generation,
            remote_executable,
            implicit_status,
            explicit_status,
        )
    }

    pub(crate) fn connect(
        &self,
        assignment: ResolvedHerdrAssignment,
        relay_dir: &Path,
    ) -> io::Result<HerdrConnection> {
        HerdrConnection::ssh(assignment, relay_dir, self.ssh_executable.clone())
    }

    fn remote_executable_candidates(&self, target: &str) -> io::Result<Vec<PathBuf>> {
        let command = format!(
            "printf '\\n%s\\n' '{}'\nfor candidate in \"$HOME/.local/bin/herdr\" /opt/homebrew/bin/herdr /usr/local/bin/herdr \"$HOME/.linuxbrew/bin/herdr\" /usr/bin/herdr; do [ -x \"$candidate\" ] && printf '%s\\n' \"$candidate\"; done\ncommand -v herdr 2>/dev/null || true",
            REMOTE_OUTPUT_READY_MARKER
        );
        let output = self.run_remote(target, &command)?;
        let mut candidates = Vec::new();
        for line in output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
        {
            let candidate = PathBuf::from(line);
            if validate_remote_executable(&candidate).is_ok() && !candidates.contains(&candidate) {
                candidates.push(candidate);
            }
        }
        if candidates.is_empty() {
            Err(io::Error::new(
                io::ErrorKind::NotFound,
                "compatible remote Herdr executable was not found",
            ))
        } else {
            Ok(candidates)
        }
    }

    fn remote_server_status(
        &self,
        target: &str,
        executable: &Path,
        session: Option<&str>,
    ) -> io::Result<RemoteServerStatus> {
        let output = self.run_remote(
            target,
            &remote_herdr_command(executable, session, &["status", "server", "--json"]),
        )?;
        let value: serde_json::Value = serde_json::from_str(output.trim()).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("remote Herdr status was not valid JSON: {error}"),
            )
        })?;
        let running = value
            .get("running")
            .and_then(serde_json::Value::as_bool)
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "remote status omitted running")
            })?;
        let api_socket = value
            .get("socket")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "remote status omitted socket")
            })?;
        let reported_session = value
            .get("session")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("default");
        Ok(RemoteServerStatus {
            running,
            session: reported_session.to_string(),
            api_socket: PathBuf::from(api_socket),
        })
    }

    fn run_remote(&self, target: &str, remote_command: &str) -> io::Result<String> {
        run_bounded_ssh_command(
            &self.ssh_executable,
            target,
            remote_command,
            self.probe_timeout,
        )
    }
}

fn remote_herdr_command(executable: &Path, session: Option<&str>, args: &[&str]) -> String {
    let mut command = format!(
        "printf '\\n%s\\n' '{}'\nexec {}",
        REMOTE_OUTPUT_READY_MARKER,
        shell_quote(path_text(executable))
    );
    if let Some(session) = session {
        command.push_str(" --session ");
        command.push_str(&shell_quote(session));
    }
    for arg in args {
        command.push(' ');
        command.push_str(&shell_quote(arg));
    }
    command
}

fn ssh_command(ssh_executable: &Path, target: &str, remote_command: &str) -> std::process::Command {
    let mut command = std::process::Command::new(ssh_executable);
    command
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("NumberOfPasswordPrompts=0")
        .arg("-o")
        .arg("StrictHostKeyChecking=yes")
        .arg("-o")
        .arg("ConnectTimeout=10")
        .arg("-o")
        .arg("ConnectionAttempts=1")
        .arg("-o")
        .arg("ServerAliveInterval=15")
        .arg("-o")
        .arg("ServerAliveCountMax=4")
        .arg("-T")
        .arg("--")
        .arg(target)
        .arg(remote_command);
    command
}

fn run_bounded_ssh_command(
    ssh_executable: &Path,
    target: &str,
    remote_command: &str,
    timeout: Duration,
) -> io::Result<String> {
    use std::process::Stdio;
    use std::time::Instant;

    let mut command = ssh_command(ssh_executable, target, remote_command);
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            io::Error::new(error.kind(), format!("failed to start SSH probe: {error}"))
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "SSH probe stdout missing"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "SSH probe stderr missing"))?;
    let stdout_thread = std::thread::spawn(move || capture_bounded_output(stdout));
    let stderr_thread = std::thread::spawn(move || capture_bounded_output(stderr));
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "SSH probe timed out",
            ));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let stdout = stdout_thread
        .join()
        .map_err(|_| io::Error::other("SSH probe stdout worker panicked"))??;
    let stderr = stderr_thread
        .join()
        .map_err(|_| io::Error::other("SSH probe stderr worker panicked"))??;
    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr);
        let detail = detail.trim();
        let raw = io::Error::new(
            io::ErrorKind::ConnectionAborted,
            if detail.is_empty() {
                format!("SSH probe exited with {status}")
            } else {
                format!("remote SSH probe failed: {detail}")
            },
        );
        let failure = RelayFailure::from_error(&raw);
        return Err(io::Error::new(raw.kind(), failure.message()));
    }
    let output = String::from_utf8(stdout).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("remote SSH probe output was not UTF-8: {error}"),
        )
    })?;
    strip_remote_preamble(&output)
}

fn capture_bounded_output(mut reader: impl std::io::Read) -> io::Result<Vec<u8>> {
    const LIMIT: usize = 64 * 1024;
    let mut captured = Vec::new();
    let mut buffer = [0_u8; 4 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok(captured);
        }
        let remaining = LIMIT.saturating_sub(captured.len());
        captured.extend_from_slice(&buffer[..read.min(remaining)]);
    }
}

fn strip_remote_preamble(output: &str) -> io::Result<String> {
    let mut consumed = 0;
    for line in output.split_inclusive('\n') {
        consumed += line.len();
        if consumed > 4 * 1024 {
            break;
        }
        if line.trim_end_matches(['\r', '\n']) == REMOTE_OUTPUT_READY_MARKER {
            return Ok(output[consumed..].to_string());
        }
    }
    Err(io::Error::new(
        io::ErrorKind::InvalidData,
        "remote SSH probe omitted its output marker",
    ))
}

pub(crate) enum HerdrConnection {
    Local {
        api_socket: PathBuf,
        terminal_socket: PathBuf,
    },
    Ssh(SshHerdrConnection),
}

impl HerdrConnection {
    pub(crate) fn local(api_socket: PathBuf, terminal_socket: PathBuf) -> Self {
        Self::Local {
            api_socket,
            terminal_socket,
        }
    }

    pub(crate) fn ssh(
        assignment: ResolvedHerdrAssignment,
        relay_dir: &Path,
        ssh_executable: PathBuf,
    ) -> io::Result<Self> {
        SshHerdrConnection::start(assignment, relay_dir, ssh_executable).map(Self::Ssh)
    }

    pub(crate) fn api_client(&self) -> herdr_compat::api::client::ApiClient {
        herdr_compat::api::client::ApiClient::for_socket_path(match self {
            Self::Local { api_socket, .. } => api_socket.clone(),
            Self::Ssh(connection) => connection.api_relay.socket_path().to_path_buf(),
        })
    }

    pub(crate) fn connect_terminal(&self) -> io::Result<herdr_compat::ipc::LocalStream> {
        let path = match self {
            Self::Local {
                terminal_socket, ..
            } => terminal_socket,
            Self::Ssh(connection) => connection.terminal_relay.socket_path(),
        };
        herdr_compat::ipc::connect_local_stream(path)
    }

    pub(crate) fn assignment(&self) -> Option<&ResolvedHerdrAssignment> {
        match self {
            Self::Local { .. } => None,
            Self::Ssh(connection) => Some(&connection.assignment),
        }
    }
}

pub(crate) struct SshHerdrConnection {
    assignment: ResolvedHerdrAssignment,
    api_relay: SshSocketRelay,
    terminal_relay: SshSocketRelay,
}

impl SshHerdrConnection {
    fn start(
        assignment: ResolvedHerdrAssignment,
        relay_dir: &Path,
        ssh_executable: PathBuf,
    ) -> io::Result<Self> {
        std::fs::create_dir_all(relay_dir)?;
        let api_relay = SshSocketRelay::start(
            assignment.clone(),
            RelaySurface::Api,
            relay_dir.join(format!("api-{}.sock", assignment.generation())),
            ssh_executable.clone(),
        )?;
        let terminal_relay = match SshSocketRelay::start(
            assignment.clone(),
            RelaySurface::Terminal,
            relay_dir.join(format!("terminal-{}.sock", assignment.generation())),
            ssh_executable,
        ) {
            Ok(relay) => relay,
            Err(error) => {
                drop(api_relay);
                return Err(error);
            }
        };
        Ok(Self {
            assignment,
            api_relay,
            terminal_relay,
        })
    }
}

pub(crate) struct SshSocketRelay {
    socket_path: PathBuf,
    #[cfg(unix)]
    socket_identity: UnixSocketIdentity,
    #[cfg(unix)]
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    #[cfg(unix)]
    listener_thread: Option<std::thread::JoinHandle<()>>,
    #[cfg(unix)]
    failure_rx: std::sync::mpsc::Receiver<RelayFailure>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RelayFailureKind {
    Authentication,
    HostVerification,
    Timeout,
    RemoteUnavailable,
    Protocol,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RelayFailure {
    kind: RelayFailureKind,
}

impl RelayFailure {
    fn from_error(error: &io::Error) -> Self {
        let message = error.to_string().to_ascii_lowercase();
        let kind =
            if message.contains("permission denied") || message.contains("authentication failed") {
                RelayFailureKind::Authentication
            } else if message.contains("host key")
                || message.contains("remote host identification has changed")
            {
                RelayFailureKind::HostVerification
            } else if error.kind() == io::ErrorKind::TimedOut || message.contains("timed out") {
                RelayFailureKind::Timeout
            } else if message.contains("output marker")
                || message.contains("protocol")
                || message.contains("handshake")
            {
                RelayFailureKind::Protocol
            } else {
                RelayFailureKind::RemoteUnavailable
            };
        Self { kind }
    }

    pub(crate) fn kind(&self) -> RelayFailureKind {
        self.kind
    }

    pub(crate) fn message(&self) -> &'static str {
        match self.kind {
            RelayFailureKind::Authentication => "SSH authentication failed",
            RelayFailureKind::HostVerification => "SSH host verification failed",
            RelayFailureKind::Timeout => "SSH connection timed out",
            RelayFailureKind::RemoteUnavailable => "remote Herdr connection failed",
            RelayFailureKind::Protocol => "remote Herdr relay protocol failed",
        }
    }
}

impl SshSocketRelay {
    pub(crate) fn start(
        assignment: ResolvedHerdrAssignment,
        surface: RelaySurface,
        socket_path: PathBuf,
        ssh_executable: PathBuf,
    ) -> io::Result<Self> {
        if !ssh_executable.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "OpenSSH executable must be an absolute path",
            ));
        }

        #[cfg(unix)]
        {
            Self::start_unix(assignment, surface, socket_path, ssh_executable)
        }

        #[cfg(not(unix))]
        {
            let _ = (assignment, surface, socket_path, ssh_executable);
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "SSH-backed Herdr connections are not implemented on this platform",
            ))
        }
    }

    pub(crate) fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    #[cfg(unix)]
    pub(crate) fn reported_failure(&self) -> Option<RelayFailure> {
        self.failure_rx.try_recv().ok()
    }

    #[cfg(unix)]
    fn start_unix(
        assignment: ResolvedHerdrAssignment,
        surface: RelaySurface,
        socket_path: PathBuf,
        ssh_executable: PathBuf,
    ) -> io::Result<Self> {
        use std::os::unix::fs::PermissionsExt;
        use std::os::unix::net::UnixListener;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        use std::time::Duration;

        prepare_unix_socket_path(&socket_path)?;
        let listener = UnixListener::bind(&socket_path)?;
        let socket_identity = unix_socket_identity(&socket_path)?;
        if let Err(error) =
            std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600))
        {
            let _ = remove_unix_socket_if_owned(&socket_path, socket_identity);
            return Err(error);
        }
        if let Err(error) = listener.set_nonblocking(true) {
            let _ = remove_unix_socket_if_owned(&socket_path, socket_identity);
            return Err(error);
        }

        let stop = Arc::new(AtomicBool::new(false));
        let listener_stop = Arc::clone(&stop);
        let (failure_tx, failure_rx) = std::sync::mpsc::sync_channel(8);
        let listener_thread = std::thread::spawn(move || {
            let mut workers: Vec<std::thread::JoinHandle<()>> = Vec::new();
            while !listener_stop.load(Ordering::Acquire) {
                let mut index = 0;
                while index < workers.len() {
                    if workers[index].is_finished() {
                        let worker = workers.swap_remove(index);
                        let _ = worker.join();
                    } else {
                        index += 1;
                    }
                }

                match listener.accept() {
                    Ok((_stream, _)) if workers.len() >= MAX_RELAY_CONNECTIONS => {
                        let failure = RelayFailure {
                            kind: RelayFailureKind::RemoteUnavailable,
                        };
                        let _ = failure_tx.try_send(failure);
                        tracing::warn!(
                            generation = assignment.generation(),
                            limit = MAX_RELAY_CONNECTIONS,
                            "Herdr SSH relay connection limit reached"
                        );
                    }
                    Ok((stream, _)) => {
                        let worker_assignment = assignment.clone();
                        let worker_ssh = ssh_executable.clone();
                        let worker_stop = Arc::clone(&listener_stop);
                        let worker_failure_tx = failure_tx.clone();
                        workers.push(std::thread::spawn(move || {
                            if let Err(error) = relay_unix_connection(
                                stream,
                                &worker_assignment,
                                surface,
                                &worker_ssh,
                                &worker_stop,
                            ) {
                                let failure = RelayFailure::from_error(&error);
                                let _ = worker_failure_tx.try_send(failure);
                                tracing::warn!(
                                    generation = worker_assignment.generation(),
                                    failure = ?failure.kind(),
                                    "Herdr SSH relay connection failed"
                                );
                            }
                        }));
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    Err(error) => {
                        tracing::warn!(error = %error, "Herdr SSH relay listener failed");
                        break;
                    }
                }
            }

            for worker in workers {
                let _ = worker.join();
            }
        });

        Ok(Self {
            socket_path,
            socket_identity,
            stop,
            listener_thread: Some(listener_thread),
            failure_rx,
        })
    }
}

#[cfg(unix)]
impl Drop for SshSocketRelay {
    fn drop(&mut self) {
        use std::sync::atomic::Ordering;

        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.listener_thread.take() {
            let _ = thread.join();
        }
        let _ = remove_unix_socket_if_owned(&self.socket_path, self.socket_identity);
    }
}

#[cfg(unix)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct UnixSocketIdentity {
    device: u64,
    inode: u64,
}

#[cfg(unix)]
fn unix_socket_identity(path: &Path) -> io::Result<UnixSocketIdentity> {
    use std::os::unix::fs::MetadataExt;

    let metadata = std::fs::metadata(path)?;
    Ok(UnixSocketIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(unix)]
fn remove_unix_socket_if_owned(path: &Path, expected: UnixSocketIdentity) -> io::Result<()> {
    match unix_socket_identity(path) {
        Ok(current) if current != expected => return Ok(()),
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    }
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(unix)]
fn prepare_unix_socket_path(path: &Path) -> io::Result<()> {
    use std::os::unix::net::UnixStream;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if !path.exists() {
        return Ok(());
    }
    match UnixStream::connect(path) {
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                "Herdr relay socket is already in use",
            ));
        }
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::ConnectionRefused
                    | io::ErrorKind::NotFound
                    | io::ErrorKind::TimedOut
            ) => {}
        Err(error) => return Err(error),
    }
    std::fs::remove_file(path)
}

#[cfg(unix)]
fn relay_unix_connection(
    stream: std::os::unix::net::UnixStream,
    assignment: &ResolvedHerdrAssignment,
    surface: RelaySurface,
    ssh_executable: &Path,
    stop: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> io::Result<()> {
    use std::io::{Read, Write};
    use std::process::Stdio;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    let mut command = ssh_command(
        ssh_executable,
        assignment.target(),
        &assignment.remote_command(surface),
    );
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        io::Error::new(error.kind(), format!("failed to start SSH relay: {error}"))
    })?;
    let mut child_stdin = child
        .stdin
        .take()
        .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "SSH relay stdin missing"))?;
    let child_stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "SSH relay stdout missing"))?;
    let child_stderr = child
        .stderr
        .take()
        .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "SSH relay stderr missing"))?;

    let mut upload_stream = stream.try_clone()?;
    upload_stream.set_read_timeout(Some(Duration::from_millis(50)))?;
    let mut download_stream = stream;
    download_stream.set_write_timeout(Some(Duration::from_millis(50)))?;

    let upload_done = Arc::new(AtomicBool::new(false));
    let upload_closed = Arc::new(AtomicBool::new(false));
    let connection_stop = Arc::new(AtomicBool::new(false));
    let upload_done_worker = Arc::clone(&upload_done);
    let upload_closed_worker = Arc::clone(&upload_closed);
    let upload_stop = Arc::clone(stop);
    let upload_connection_stop = Arc::clone(&connection_stop);
    let upload = std::thread::spawn(move || -> io::Result<()> {
        let result = (|| {
            let mut buffer = [0_u8; 16 * 1024];
            while !upload_stop.load(Ordering::Acquire)
                && !upload_connection_stop.load(Ordering::Acquire)
            {
                match upload_stream.read(&mut buffer) {
                    Ok(0) => {
                        upload_closed_worker.store(true, Ordering::Release);
                        break;
                    }
                    Ok(read) => {
                        child_stdin.write_all(&buffer[..read])?;
                        child_stdin.flush()?;
                    }
                    Err(error)
                        if matches!(
                            error.kind(),
                            io::ErrorKind::WouldBlock
                                | io::ErrorKind::TimedOut
                                | io::ErrorKind::Interrupted
                        ) => {}
                    Err(error) => return Err(error),
                }
            }
            Ok(())
        })();
        upload_done_worker.store(true, Ordering::Release);
        result
    });

    let download_done = Arc::new(AtomicBool::new(false));
    let download_done_worker = Arc::clone(&download_done);
    let download_stop = Arc::clone(stop);
    let download_connection_stop = Arc::clone(&connection_stop);
    let download = std::thread::spawn(move || -> io::Result<()> {
        let result = (|| {
            let mut reader = io::BufReader::new(child_stdout);
            discard_remote_preamble(&mut reader)?;
            let mut buffer = [0_u8; 16 * 1024];
            while !download_stop.load(Ordering::Acquire)
                && !download_connection_stop.load(Ordering::Acquire)
            {
                let read = match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => read,
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(error) => return Err(error),
                };
                let mut written = 0;
                while written < read
                    && !download_stop.load(Ordering::Acquire)
                    && !download_connection_stop.load(Ordering::Acquire)
                {
                    match download_stream.write(&buffer[written..read]) {
                        Ok(0) => {}
                        Ok(count) => written += count,
                        Err(error)
                            if matches!(
                                error.kind(),
                                io::ErrorKind::WouldBlock
                                    | io::ErrorKind::TimedOut
                                    | io::ErrorKind::Interrupted
                            ) => {}
                        Err(error) => return Err(error),
                    }
                }
                download_stream.flush()?;
            }
            Ok(())
        })();
        download_done_worker.store(true, Ordering::Release);
        result
    });

    let stderr = std::thread::spawn(move || capture_bounded_stderr(child_stderr));
    let mut child_status = None;
    while child_status.is_none() {
        if let Some(status) = child.try_wait()? {
            child_status = Some(status);
            break;
        }
        if stop.load(Ordering::Acquire)
            || upload_done.load(Ordering::Acquire)
            || upload_closed.load(Ordering::Acquire)
            || download_done.load(Ordering::Acquire)
        {
            let _ = child.kill();
            child_status = Some(child.wait()?);
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }

    let status = child_status.expect("relay child status is assigned before loop exits");
    connection_stop.store(true, Ordering::Release);
    let upload_result = upload
        .join()
        .map_err(|_| io::Error::other("SSH relay upload worker panicked"))?;
    let download_result = download
        .join()
        .map_err(|_| io::Error::other("SSH relay download worker panicked"))?;
    let stderr = stderr
        .join()
        .map_err(|_| io::Error::other("SSH relay stderr worker panicked"))??;

    if stop.load(Ordering::Acquire) || upload_closed.load(Ordering::Acquire) {
        return Ok(());
    }
    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr);
        let detail = detail.trim();
        return Err(io::Error::new(
            io::ErrorKind::ConnectionAborted,
            if detail.is_empty() {
                format!("SSH relay exited with {status}")
            } else {
                format!("remote SSH connection failed: {detail}")
            },
        ));
    }
    upload_result.map_err(|error| {
        io::Error::new(error.kind(), format!("SSH relay upload failed: {error}"))
    })?;
    download_result.map_err(|error| {
        io::Error::new(error.kind(), format!("SSH relay download failed: {error}"))
    })?;
    Ok(())
}

#[cfg(unix)]
fn discard_remote_preamble(reader: &mut impl std::io::BufRead) -> io::Result<()> {
    let mut consumed = 0;
    let mut line = String::new();
    while consumed <= 4 * 1024 {
        line.clear();
        let read = reader.read_line(&mut line)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "remote relay exited before its output marker",
            ));
        }
        consumed += read;
        if line.trim_end_matches(['\r', '\n']) == REMOTE_OUTPUT_READY_MARKER {
            return Ok(());
        }
    }
    Err(io::Error::new(
        io::ErrorKind::InvalidData,
        "remote relay output marker exceeded its bound",
    ))
}

#[cfg(unix)]
fn capture_bounded_stderr(mut stderr: impl std::io::Read) -> io::Result<Vec<u8>> {
    const LIMIT: usize = 16 * 1024;
    let mut captured = Vec::new();
    let mut buffer = [0_u8; 4 * 1024];
    loop {
        let read = stderr.read(&mut buffer)?;
        if read == 0 {
            return Ok(captured);
        }
        let remaining = LIMIT.saturating_sub(captured.len());
        captured.extend_from_slice(&buffer[..read.min(remaining)]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::path::PathBuf;

    fn status(session: &str, socket: &str) -> RemoteServerStatus {
        RemoteServerStatus {
            running: true,
            session: session.to_string(),
            api_socket: PathBuf::from(socket),
        }
    }

    #[test]
    fn default_resolution_requires_matching_explicit_socket_evidence() {
        let assignment = ResolvedHerdrAssignment::resolve(
            "build.example",
            SessionSelector::Default,
            7,
            "/opt/herdr/bin/herdr",
            Some(status("agents", "/run/herdr/agents/herdr.sock")),
            status("agents", "/run/herdr/agents/herdr.sock"),
        )
        .unwrap();

        assert_eq!(assignment.session(), "agents");
        assert_eq!(assignment.generation(), 7);

        let error = ResolvedHerdrAssignment::resolve(
            "build.example",
            SessionSelector::Default,
            8,
            "/opt/herdr/bin/herdr",
            Some(status("agents", "/tmp/overridden.sock")),
            status("agents", "/run/herdr/agents/herdr.sock"),
        )
        .unwrap_err();
        assert!(error
            .to_string()
            .contains("does not identify the explicit session socket"));
    }

    #[test]
    fn every_relay_command_pins_the_resolved_session_even_when_default() {
        let assignment = ResolvedHerdrAssignment::resolve(
            "build.example",
            SessionSelector::Default,
            4,
            "/opt/herdr/bin/herdr",
            Some(status("default", "/run/herdr/default/herdr.sock")),
            status("default", "/run/herdr/default/herdr.sock"),
        )
        .unwrap();

        let api = assignment.remote_command(RelaySurface::Api);
        let terminal = assignment.remote_command(RelaySurface::Terminal);

        assert!(api.contains("--session default remote-api-bridge"));
        assert!(terminal.contains("--session default remote-client-bridge"));
        assert_eq!(api.matches("--session default").count(), 1);
        assert_eq!(terminal.matches("--session default").count(), 1);
    }

    #[test]
    fn named_resolution_rejects_status_for_another_session() {
        let error = ResolvedHerdrAssignment::resolve(
            "build.example",
            SessionSelector::Named("product-a".into()),
            2,
            "/opt/herdr/bin/herdr",
            None,
            status("product-b", "/run/herdr/product-b/herdr.sock"),
        )
        .unwrap_err();

        assert!(error.to_string().contains("resolved a different session"));
    }

    #[test]
    fn target_and_session_values_cannot_change_ssh_argv_shape() {
        for target in ["-oProxyCommand=bad", "host name", "host\nother"] {
            assert!(ResolvedHerdrAssignment::resolve(
                target,
                SessionSelector::Named("work".into()),
                1,
                "/usr/bin/herdr",
                None,
                status("work", "/run/herdr/work/herdr.sock"),
            )
            .is_err());
        }
        assert!(ResolvedHerdrAssignment::resolve(
            "build.example",
            SessionSelector::Named("work; touch bad".into()),
            1,
            "/usr/bin/herdr",
            None,
            status("work; touch bad", "/run/herdr/work/herdr.sock"),
        )
        .is_err());
    }

    #[test]
    fn local_connection_uses_the_same_adapter_entry_points() {
        let connection = HerdrConnection::local(
            PathBuf::from("/tmp/local-api.sock"),
            PathBuf::from("/tmp/local-terminal.sock"),
        );
        assert_eq!(
            connection.api_client().socket_path(),
            PathBuf::from("/tmp/local-api.sock")
        );
        assert!(connection.assignment().is_none());
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "requires a pre-provisioned remote Herdr SSH fixture"]
    fn live_remote_subscription_snapshot_command_and_launcher_progress_together() {
        use herdr_compat::api::client::parse_response_value;
        use herdr_compat::api::schema::{
            EmptyParams, EventsSubscribeParams, Method, Request, ResponseResult, Subscription,
            TabCreateParams, WorkspaceCloseParams, WorkspaceCreateParams,
        };
        use herdr_compat::protocol::{
            self, ClientMessage, RenderEncoding, ServerMessage, MAX_GRAPHICS_FRAME_SIZE,
            PROTOCOL_VERSION,
        };
        use herdr_compat::TryClone as _;
        use std::collections::HashMap;
        use std::io::Write;
        use std::sync::mpsc;
        use std::time::{Duration, SystemTime, UNIX_EPOCH};

        let ssh = PathBuf::from(std::env::var("HERDR_WORLD_LIVE_SSH").expect("live SSH path"));
        let target = std::env::var("HERDR_WORLD_LIVE_TARGET").expect("live SSH target");
        let session = std::env::var("HERDR_WORLD_LIVE_SESSION").expect("live Herdr session");
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let relay_dir = std::env::temp_dir().join(format!(
            "herdr-world-live-connector-{}-{nonce}",
            std::process::id()
        ));

        let connector = SshHerdrConnector::new(ssh).unwrap();
        let assignment = connector
            .resolve_assignment(&target, SessionSelector::Named(session.clone()), 1)
            .unwrap();
        assert_eq!(assignment.session(), session);
        let connection = connector.connect(assignment, &relay_dir).unwrap();
        assert_eq!(connection.assignment().unwrap().generation(), 1);
        let api = connection.api_client();
        let status = api.status_with_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(
            status.protocol,
            Some(herdr_compat::protocol::PROTOCOL_VERSION)
        );

        let subscription_request = Request {
            id: "world-live:subscription".into(),
            method: Method::EventsSubscribe(EventsSubscribeParams {
                subscriptions: vec![
                    Subscription::WorkspaceCreated {},
                    Subscription::TabCreated {},
                ],
            }),
        };
        let (ack, mut events) = api
            .subscribe_value(&subscription_request, Some(Duration::from_secs(5)))
            .unwrap();
        assert!(matches!(
            parse_response_value(ack).unwrap().result,
            ResponseResult::SubscriptionStarted {}
        ));
        events.set_read_timeout(Duration::from_secs(5)).unwrap();

        let snapshot = api
            .request(Request {
                id: "world-live:snapshot".into(),
                method: Method::SessionSnapshot(EmptyParams::default()),
            })
            .unwrap();
        let ResponseResult::SessionSnapshot { snapshot } = snapshot.result else {
            panic!("snapshot request returned an unexpected result")
        };
        let terminal_ids = snapshot
            .panes
            .iter()
            .map(|pane| pane.terminal_id.clone())
            .take(2)
            .collect::<Vec<_>>();
        assert_eq!(terminal_ids.len(), 2, "live fixture needs two terminals");

        let created = api
            .request(Request {
                id: "world-live:workspace-create".into(),
                method: Method::WorkspaceCreate(WorkspaceCreateParams {
                    source_workspace_id: None,
                    cwd: Some("/tmp".into()),
                    focus: false,
                    label: Some("World connector live proof".into()),
                    env: HashMap::new(),
                }),
            })
            .unwrap();
        let ResponseResult::WorkspaceCreated { workspace, .. } = created.result else {
            panic!("workspace command returned an unexpected result")
        };
        wait_for_live_event(&mut events, "workspace_created");

        let launched = api
            .request(Request {
                id: "world-live:launcher".into(),
                method: Method::TabCreate(TabCreateParams {
                    workspace_id: Some(workspace.workspace_id.clone()),
                    cwd: None,
                    focus: false,
                    label: None,
                    env: HashMap::new(),
                }),
            })
            .unwrap();
        assert!(matches!(launched.result, ResponseResult::TabCreated { .. }));
        wait_for_live_event(&mut events, "tab_created");

        let mut first_terminal = connection.connect_terminal().unwrap();
        let mut second_terminal = connection.connect_terminal().unwrap();
        for (stream, terminal_id) in [
            (&mut first_terminal, &terminal_ids[0]),
            (&mut second_terminal, &terminal_ids[1]),
        ] {
            protocol::write_message(
                stream,
                &ClientMessage::TerminalHello {
                    version: PROTOCOL_VERSION,
                    cols: 80,
                    rows: 24,
                    cell_width_px: 0,
                    cell_height_px: 0,
                    pixel_mouse: false,
                },
            )
            .unwrap();
            let welcome: ServerMessage =
                protocol::read_message(stream, MAX_GRAPHICS_FRAME_SIZE).unwrap();
            assert!(matches!(
                welcome,
                ServerMessage::Welcome {
                    version: PROTOCOL_VERSION,
                    encoding: RenderEncoding::TerminalAnsi,
                    error: None,
                }
            ));
            protocol::write_message(
                stream,
                &ClientMessage::AttachTerminal {
                    terminal_id: terminal_id.clone(),
                    takeover: false,
                },
            )
            .unwrap();
            stream.flush().unwrap();
        }

        let first_read = first_terminal.try_clone().unwrap();
        let second_read = second_terminal.try_clone().unwrap();
        let (terminal_tx, terminal_rx) = mpsc::channel();
        for (mut stream, expected, forbidden) in [
            (
                first_read,
                b"world-connector-one".to_vec(),
                b"world-connector-two".to_vec(),
            ),
            (
                second_read,
                b"world-connector-two".to_vec(),
                b"world-connector-one".to_vec(),
            ),
        ] {
            let terminal_tx = terminal_tx.clone();
            std::thread::spawn(move || {
                let mut output = Vec::new();
                while output.len() < 512 * 1024 {
                    match protocol::read_message::<_, ServerMessage>(
                        &mut stream,
                        MAX_GRAPHICS_FRAME_SIZE,
                    ) {
                        Ok(ServerMessage::Terminal(frame)) => output.extend(frame.bytes),
                        Ok(ServerMessage::TerminalBell { .. } | ServerMessage::Welcome { .. }) => {}
                        Ok(ServerMessage::ServerShutdown { reason }) => {
                            let _ = terminal_tx.send(Err(format!("terminal closed: {reason:?}")));
                            return;
                        }
                        Ok(_) => {}
                        Err(error) => {
                            let _ = terminal_tx.send(Err(error.to_string()));
                            return;
                        }
                    }
                    if contains_bytes(&output, &forbidden) {
                        let _ = terminal_tx.send(Err("terminal output crossed streams".into()));
                        return;
                    }
                    if contains_bytes(&output, &expected) {
                        let _ = terminal_tx.send(Ok(()));
                        return;
                    }
                }
                let _ = terminal_tx.send(Err("terminal proof output exceeded its bound".into()));
            });
        }
        protocol::write_message(
            &mut first_terminal,
            &ClientMessage::Input {
                data: b"printf 'world-connector-one\\n'\n".to_vec(),
            },
        )
        .unwrap();
        first_terminal.flush().unwrap();
        protocol::write_message(
            &mut second_terminal,
            &ClientMessage::Input {
                data: b"printf 'world-connector-two\\n'\n".to_vec(),
            },
        )
        .unwrap();
        second_terminal.flush().unwrap();
        for _ in 0..2 {
            terminal_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("terminal proof timed out")
                .unwrap();
        }
        drop(first_terminal);
        drop(second_terminal);

        api.request(Request {
            id: "world-live:cleanup".into(),
            method: Method::WorkspaceClose(WorkspaceCloseParams {
                workspace_id: workspace.workspace_id,
                close_group: false,
            }),
        })
        .unwrap();
        drop(events);
        drop(connection);
        std::fs::remove_dir_all(relay_dir).unwrap();
    }

    #[cfg(unix)]
    fn wait_for_live_event(events: &mut herdr_compat::api::client::EventStream, expected: &str) {
        for _ in 0..16 {
            let value = events
                .next_value()
                .unwrap()
                .expect("live event stream ended");
            if value.get("event").and_then(serde_json::Value::as_str) == Some(expected) {
                return;
            }
        }
        panic!("event stream did not contain {expected}");
    }

    #[cfg(unix)]
    fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }

    #[cfg(unix)]
    #[test]
    fn subscription_requests_and_terminals_progress_on_independent_pinned_relays() {
        use std::os::unix::fs::PermissionsExt;
        use std::os::unix::net::UnixStream;
        use std::time::{Duration, SystemTime, UNIX_EPOCH};

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "herdr-world-connector-test-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let ssh = root.join("ssh");
        let herdr = root.join("herdr");
        std::fs::write(
            &ssh,
            "#!/bin/sh\nfor arg do remote_command=$arg; done\nexport HERDR_SESSION=changed-after-admission\nexec /bin/sh -c \"$remote_command\"\n",
        )
        .unwrap();
        std::fs::write(
            &herdr,
            "#!/bin/sh\nsession=${HERDR_SESSION:-ambient}\nif [ \"$1\" = --session ]; then session=$2; shift 2; fi\ncase \"$1\" in\n  remote-api-bridge) prefix=api ;;\n  remote-client-bridge) prefix=terminal ;;\n  *) exit 64 ;;\nesac\nwhile IFS= read -r line; do printf '%s:%s:%s\\n' \"$prefix\" \"$session\" \"$line\"; done\n",
        )
        .unwrap();
        for path in [&ssh, &herdr] {
            let mut permissions = std::fs::metadata(path).unwrap().permissions();
            permissions.set_mode(0o700);
            std::fs::set_permissions(path, permissions).unwrap();
        }

        let assignment = ResolvedHerdrAssignment::resolve(
            "fixture",
            SessionSelector::Default,
            11,
            &herdr,
            Some(status("default", "/fixture/default/herdr.sock")),
            status("default", "/fixture/default/herdr.sock"),
        )
        .unwrap();
        let api = SshSocketRelay::start(
            assignment.clone(),
            RelaySurface::Api,
            root.join("api.sock"),
            ssh.clone(),
        )
        .unwrap();
        let terminal = SshSocketRelay::start(
            assignment,
            RelaySurface::Terminal,
            root.join("terminal.sock"),
            ssh,
        )
        .unwrap();

        let mut subscription = UnixStream::connect(api.socket_path()).unwrap();
        subscription
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        writeln!(subscription, "subscribe").unwrap();
        let mut subscription_reader = BufReader::new(subscription.try_clone().unwrap());
        let mut line = String::new();
        subscription_reader.read_line(&mut line).unwrap();
        assert_eq!(line, "api:default:subscribe\n");

        let mut request = UnixStream::connect(api.socket_path()).unwrap();
        request
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        writeln!(request, "snapshot").unwrap();
        line.clear();
        BufReader::new(request).read_line(&mut line).unwrap();
        assert_eq!(line, "api:default:snapshot\n");

        let mut first_terminal = UnixStream::connect(terminal.socket_path()).unwrap();
        let mut second_terminal = UnixStream::connect(terminal.socket_path()).unwrap();
        for stream in [&first_terminal, &second_terminal] {
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
        }
        writeln!(first_terminal, "one").unwrap();
        writeln!(second_terminal, "two").unwrap();
        line.clear();
        BufReader::new(first_terminal).read_line(&mut line).unwrap();
        assert_eq!(line, "terminal:default:one\n");
        line.clear();
        BufReader::new(second_terminal)
            .read_line(&mut line)
            .unwrap();
        assert_eq!(line, "terminal:default:two\n");

        drop(subscription);
        drop(terminal);
        drop(api);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn relay_failure_is_bounded_and_redacts_remote_diagnostics() {
        use std::os::unix::fs::PermissionsExt;
        use std::os::unix::net::UnixStream;
        use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "herdr-world-connector-failure-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let ssh = root.join("ssh");
        std::fs::write(
            &ssh,
            "#!/bin/sh\necho 'Permission denied for test-user@example.test' >&2\nexit 255\n",
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&ssh).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&ssh, permissions).unwrap();
        let assignment = ResolvedHerdrAssignment::resolve(
            "fixture",
            SessionSelector::Named("work".into()),
            3,
            "/usr/bin/herdr",
            None,
            status("work", "/fixture/work/herdr.sock"),
        )
        .unwrap();
        let relay =
            SshSocketRelay::start(assignment, RelaySurface::Api, root.join("api.sock"), ssh)
                .unwrap();
        let _stream = UnixStream::connect(relay.socket_path()).unwrap();

        let started = Instant::now();
        let failure = loop {
            if let Some(failure) = relay.reported_failure() {
                break failure;
            }
            assert!(started.elapsed() < Duration::from_secs(2));
            std::thread::sleep(Duration::from_millis(20));
        };
        assert_eq!(failure.kind(), RelayFailureKind::Authentication);
        assert_eq!(failure.message(), "SSH authentication failed");
        assert!(!failure.message().contains("test-user"));
        assert!(!failure.message().contains("example.test"));

        drop(_stream);
        drop(relay);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn dropping_relay_cancels_an_active_ssh_child() {
        use std::os::unix::fs::PermissionsExt;
        use std::os::unix::net::UnixStream;
        use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "herdr-world-connector-cancel-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let ssh = root.join("ssh");
        std::fs::write(
            &ssh,
            "#!/bin/sh\nprintf '\\n%s\\n' 'herdr-remote-output-ready:1'\nexec sleep 30\n",
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&ssh).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&ssh, permissions).unwrap();
        let assignment = ResolvedHerdrAssignment::resolve(
            "fixture",
            SessionSelector::Named("work".into()),
            5,
            "/usr/bin/herdr",
            None,
            status("work", "/fixture/work/herdr.sock"),
        )
        .unwrap();
        let relay =
            SshSocketRelay::start(assignment, RelaySurface::Api, root.join("api.sock"), ssh)
                .unwrap();
        let stream = UnixStream::connect(relay.socket_path()).unwrap();
        std::thread::sleep(Duration::from_millis(50));

        let started = Instant::now();
        drop(relay);
        assert!(started.elapsed() < Duration::from_secs(2));

        drop(stream);
        std::fs::remove_dir_all(root).unwrap();
    }
}
