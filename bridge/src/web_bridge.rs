use std::collections::{HashMap, HashSet, VecDeque};
use std::env;
use std::fmt;
use std::io::{self, ErrorKind, Write};
use std::net::{IpAddr, Ipv6Addr, SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
#[cfg(test)]
use std::sync::atomic::AtomicBool;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use argon2::password_hash::{
    rand_core::OsRng as PasswordOsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use axum::body::{Body, Bytes};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, DefaultBodyLimit, Path as AxumPath, Query, State};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN,
    ACCESS_CONTROL_MAX_AGE, ACCESS_CONTROL_REQUEST_HEADERS, AUTHORIZATION, CACHE_CONTROL, HOST,
    ORIGIN, SEC_WEBSOCKET_PROTOCOL, VARY, WWW_AUTHENTICATE,
};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{extract::Request as AxumRequest, Json, Router};
use flate2::write::GzEncoder;
use flate2::Compression;
use futures_util::{SinkExt, StreamExt};
use herdr_compat::TryClone as _;
use rand::{rngs::OsRng as TokenOsRng, RngCore};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use tokio::time::Instant;
use tower::{ServiceBuilder, ServiceExt};
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};
use tracing::{debug, info, warn};

use herdr_compat::api::client::{ApiClient, ApiClientError};
use herdr_compat::api::schema::{
    AgentInfo, AgentStartParams, AgentStatus, AgentTarget, EmptyParams, EventsSubscribeParams,
    LayoutApplyParams, LayoutExportParams, Method, PaneInfo, PaneLayoutSnapshot, PaneListParams,
    PaneMoveDestination, PaneSplitParams, PaneTarget, Request, ResponseResult, SessionSnapshot,
    SplitDirection, Subscription, SubscriptionEventData, SubscriptionEventEnvelope,
    SubscriptionEventKind, TabCreateParams, TabInfo, TabListParams, TabTarget, WorkspaceInfo,
};
use herdr_compat::protocol::{
    self, AttachScrollDirection, AttachScrollSource, ClientKeybindings, ClientLaunchMode,
    ClientMessage, RenderEncoding, ServerMessage, MAX_FRAME_SIZE, MAX_GRAPHICS_FRAME_SIZE,
    PROTOCOL_VERSION,
};

use crate::agent_activity::{AgentActivityListResponse, AgentActivityManager};
use crate::agent_pins::{AgentPinsError, AgentPinsListResponse, AgentPinsManager};
use crate::launcher_presets::{
    layout_leaf_for_preset, split_layout_with_command_preset, CustomCommandPreset,
    LauncherPresetLaunch, LauncherPresetStore, ManagedAgentKind, ResolvedLauncherPreset,
    MAX_LABEL_BYTES,
};
use crate::notes::{
    AttachNoteRequest, CreateNoteRequest, NoteResponse, NotesError, NotesListQuery,
    NotesListResponse, NotesManager, RevisionRequest, UpdateNoteRequest,
};
use crate::observability::{ObservabilityContractVersion, ObservabilityHealth, ObservabilityState};

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8787;
const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
const DEFAULT_STATIC_DIR: &str = "web/dist";
const MIN_HERDR_VERSION: (u64, u64, u64) = (0, 8, 2);
const MIN_HERDR_VERSION_LABEL: &str = "0.8.2";
const BRIDGE_API_VERSION: u32 = 1;
const WEB_COMPAT_VERSION: u32 = 1;
const MAX_CONFIGURED_LABEL_CHARS: usize = 80;
const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;
const MAX_NOTES_REQUEST_BYTES: usize = 512 * 1024;
const MAX_TERMINAL_INPUT_CHUNK_BYTES: usize = 768 * 1024;
const MAX_QUEUED_TERMINAL_INPUT_BYTES: usize = 8 * 1024 * 1024;
const TERMINAL_DETACH_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_TERMINAL_DETACH_DRAIN_WAITS: usize = 4;
const MAX_ATTACH_HANDSHAKE_RETRIES: usize = 2;
const TERMINAL_ATTACH_GATE_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_TERMINAL_OUTPUT_COALESCE_MS: u64 = 16;
const MAX_TERMINAL_OUTPUT_COALESCE_MS: u64 = 256;
const TERMINAL_OUTPUT_COALESCE_MAX_BYTES: usize = 32 * 1024;
const TERMINAL_OUTPUT_COALESCE_MAX_CHUNKS: usize = 256;
const MAX_TERMINAL_BELL_COUNT: u16 = 16;
const TERMINAL_OUTPUT_FRAME_RAW: u8 = 0;
const TERMINAL_OUTPUT_FRAME_GZIP: u8 = 1;
const TERMINAL_OUTPUT_GZIP_MIN_BYTES: usize = 256;
const TERMINAL_OUTPUT_GZIP_ACKNOWLEDGEMENT: &str =
    r#"{"type":"terminal_output_encoding","encoding":"gzip"}"#;
const TERMINAL_ATTACH_READY: &str = r#"{"type":"attach_ready"}"#;
const DAEMON_STATUS_TIMEOUT: Duration = Duration::from_secs(5);
const ACTIVITY_WATCHER_INITIAL_BACKOFF: Duration = Duration::from_secs(1);
const ACTIVITY_WATCHER_MAX_BACKOFF: Duration = Duration::from_secs(30);
const ACTIVITY_RESUBSCRIBE_DEBOUNCE: Duration = Duration::from_millis(100);
const ACTIVITY_READ_TIMEOUT: Duration = Duration::from_millis(250);
const MANAGED_AGENT_SHELL_SETTLE_DELAY: Duration = Duration::from_millis(100);
const MANAGED_AGENT_SHELL_RETRY_INITIAL_DELAY: Duration = Duration::from_millis(300);
const MANAGED_AGENT_SHELL_READY_TIMEOUT: Duration = Duration::from_secs(3);
const MANAGED_AGENT_START_TIMEOUT: Duration = Duration::from_secs(30);
const MANAGED_AGENT_POLL_INTERVAL: Duration = Duration::from_millis(100);
const MAX_PASSWORD_BYTES: usize = 1024;
const MAX_PASSWORD_REQUEST_BYTES: usize = 2048;
const MAX_REMOTE_ACCESS_REQUEST_BYTES: usize = 64 * 1024;
const MAX_REMOTE_ACCESS_ITEMS: usize = 32;
const MAX_REMOTE_ACCESS_VALUE_BYTES: usize = 512;
const AUTH_SESSION_TTL: Duration = Duration::from_secs(60 * 60);
const AUTH_FAILURE_WINDOW: Duration = Duration::from_secs(60);
const AUTH_FAILURE_LIMIT: usize = 5;
const AUTH_FAILURE_DELAY: Duration = Duration::from_millis(250);
const MAX_AUTH_FAILURE_PEERS: usize = 1024;
const MAX_PASSWORD_VERIFICATIONS: usize = 4;
const CONTROLLER_HANDOFF_GRACE_MS: &str = "1000";
const AUTH_TOKEN_BYTES: usize = 32;
const MAX_APPLY_REASON_BYTES: usize = 240;
static UPLOAD_TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);
static CONTROLLER_TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);
#[cfg(test)]
static AUTH_TEST_VERIFICATION_PAUSE: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
static AUTH_TEST_VERIFICATION_STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone)]
struct BridgeOptions {
    host: String,
    port: u16,
    static_dir: PathBuf,
    upload_dir: PathBuf,
    launcher_presets_path: Option<PathBuf>,
    allowed_hosts: Vec<String>,
    allowed_origins: Vec<String>,
    allowed_connect_origins: Vec<String>,
    allowed_connect_sources: Vec<String>,
    password_hash: Option<String>,
    configured_label: Option<String>,
}

#[derive(Clone)]
struct BridgeState {
    api: ApiClient,
    client_socket_path: PathBuf,
    request_policy: RequestPolicy,
    auth: Arc<BridgeAuth>,
    management: ManagementState,
    terminal_sessions: Arc<Mutex<TerminalSessions>>,
    selected_pane_id: Arc<Mutex<Option<String>>>,
    agent_activity: Arc<AgentActivityManager>,
    agent_pins: Arc<AgentPinsManager>,
    launcher_presets: Arc<LauncherPresetStore>,
    notes: Arc<NotesManager>,
    observability: ObservabilityState,
    ui_event_tx: tokio::sync::broadcast::Sender<String>,
    activity_tx: tokio::sync::broadcast::Sender<ActivityMessage>,
    upload_dir: PathBuf,
    herdr_version: String,
    terminal_protocol: u32,
    configured_label: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct RequestPolicy {
    bind_host: String,
    bind_port: u16,
    allowed_hosts: Vec<String>,
    allowed_origins: Vec<String>,
    allowed_connect_origins: Vec<String>,
    allowed_connect_sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct RemoteAccessModel {
    enabled: bool,
    accepted_hosts: Vec<String>,
    allowed_page_origins: Vec<String>,
    allowed_bridge_origins: Vec<String>,
    password_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemoteAccessDraft {
    enabled: bool,
    accepted_hosts: Vec<String>,
    allowed_page_origins: Vec<String>,
    allowed_bridge_origins: Vec<String>,
    #[serde(default)]
    password_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RemoteAccessApplyRequest {
    remote_access: RemoteAccessDraft,
    #[serde(default)]
    password_action: PasswordAction,
    #[serde(default)]
    password: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PasswordAction {
    #[default]
    Keep,
    Set,
    Remove,
}

#[derive(Debug, Serialize)]
struct RemoteAccessStatusResponse {
    remote_access: RemoteAccessModel,
    port: u16,
    suggestions: Vec<String>,
    mutation_allowed: bool,
    mutation_reason: Option<String>,
    apply: ApplyStatusResponse,
}

#[derive(Debug, Clone, Serialize)]
struct ApplyStatusResponse {
    state: String,
    reason: Option<String>,
    restored: Option<bool>,
}

#[derive(Debug, Clone)]
struct ManagementState {
    config_path: Option<PathBuf>,
    state_dir: Option<PathBuf>,
    controller_node: Option<PathBuf>,
    controller_script: Option<PathBuf>,
    controller_mode: Option<String>,
    controller_launcher: Option<PathBuf>,
    mutation_reason: Option<String>,
}

#[derive(Debug, Clone)]
struct BridgeAuth {
    password_hash: Option<String>,
    sessions: Arc<Mutex<AuthSessions>>,
    verification_slots: Arc<Semaphore>,
}

#[derive(Debug, Default)]
struct AuthSessions {
    tokens: HashMap<String, Instant>,
    failures: HashMap<String, VecDeque<Instant>>,
    pending: HashMap<String, usize>,
}

struct PendingPasswordVerification {
    sessions: Arc<Mutex<AuthSessions>>,
    key: String,
    finished: bool,
}

impl PendingPasswordVerification {
    fn new(sessions: Arc<Mutex<AuthSessions>>, key: String) -> Self {
        Self {
            sessions,
            key,
            finished: false,
        }
    }

    fn finish(&mut self, valid: bool) -> Result<(Duration, bool), AuthFailure> {
        let mut sessions = self.sessions.lock().map_err(|_| AuthFailure::Unavailable)?;
        decrement_pending_verification(&mut sessions, &self.key);
        let result = if valid {
            sessions.failures.remove(&self.key);
            (Duration::ZERO, true)
        } else {
            let failures = sessions.failures.entry(self.key.clone()).or_default();
            failures.push_back(Instant::now());
            (
                AUTH_FAILURE_DELAY.saturating_mul(failures.len() as u32),
                false,
            )
        };
        self.finished = true;
        Ok(result)
    }
}

impl Drop for PendingPasswordVerification {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        if let Ok(mut sessions) = self.sessions.lock() {
            decrement_pending_verification(&mut sessions, &self.key);
        }
    }
}

fn decrement_pending_verification(sessions: &mut AuthSessions, key: &str) {
    if let Some(pending) = sessions.pending.get_mut(key) {
        *pending = pending.saturating_sub(1);
        if *pending == 0 {
            sessions.pending.remove(key);
        }
    }
}

#[derive(Debug, Serialize)]
struct AuthenticationCapability {
    required: bool,
    session: &'static str,
    local_peer_bypass: bool,
}

#[derive(Debug, Deserialize)]
struct PasswordRequest {
    password: String,
}

#[derive(Debug, Serialize)]
struct PasswordSessionResponse {
    authenticated: bool,
    expires_in_seconds: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
}

impl BridgeAuth {
    fn new(password_hash: Option<String>) -> Self {
        Self {
            password_hash,
            sessions: Arc::new(Mutex::new(AuthSessions::default())),
            verification_slots: Arc::new(Semaphore::new(MAX_PASSWORD_VERIFICATIONS)),
        }
    }

    fn required(&self) -> bool {
        self.password_hash.is_some()
    }

    fn password_hash(&self) -> Option<String> {
        self.password_hash.clone()
    }

    fn local_peer_allowed(peer: Option<SocketAddr>) -> bool {
        // This is intentionally based only on the accepted TCP peer address.
        // Host, Origin, and forwarding headers are not authentication input.
        peer.is_some_and(peer_is_loopback)
    }

    fn token_is_valid(&self, token: &str) -> bool {
        if token.is_empty() || token.len() > AUTH_TOKEN_BYTES * 2 {
            return false;
        }
        let now = Instant::now();
        let Ok(mut sessions) = self.sessions.lock() else {
            return false;
        };
        sessions.tokens.retain(|_, expires_at| *expires_at > now);
        sessions
            .tokens
            .get(token)
            .is_some_and(|expires_at| *expires_at > now)
    }

    fn authorization_token(headers: &HeaderMap) -> Option<&str> {
        let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
        let token = value.strip_prefix("Bearer ")?.trim();
        (!token.is_empty()).then_some(token)
    }

    fn websocket_token(headers: &HeaderMap) -> Option<&str> {
        headers
            .get(SEC_WEBSOCKET_PROTOCOL)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| {
                value
                    .split(',')
                    .map(str::trim)
                    .find_map(|protocol| protocol.strip_prefix("herdr-world-auth."))
            })
            .filter(|token| !token.is_empty())
    }

    fn request_is_authorized(&self, headers: &HeaderMap, peer: Option<SocketAddr>) -> bool {
        if !self.required() || Self::local_peer_allowed(peer) {
            return true;
        }
        Self::authorization_token(headers)
            .or_else(|| Self::websocket_token(headers))
            .is_some_and(|token| self.token_is_valid(token))
    }

    async fn issue_session(
        &self,
        peer: Option<SocketAddr>,
        password: &str,
    ) -> Result<String, AuthFailure> {
        if password.as_bytes().len() > MAX_PASSWORD_BYTES {
            return Err(AuthFailure::InvalidInput);
        }
        let Some(expected) = self.password_hash.as_deref() else {
            return Err(AuthFailure::NotRequired);
        };
        let verification_permit = self
            .verification_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| AuthFailure::RateLimited)?;
        let key = peer
            .map(|address| address.ip().to_string())
            .unwrap_or_else(|| "unknown-peer".to_string());
        let now = Instant::now();
        {
            let mut sessions = self.sessions.lock().map_err(|_| AuthFailure::Unavailable)?;
            sessions.failures.retain(|_, failures| {
                failures.retain(|started| {
                    now.saturating_duration_since(*started) < AUTH_FAILURE_WINDOW
                });
                !failures.is_empty()
            });
            let failures = sessions.failures.get(&key).map_or(0, VecDeque::len);
            let pending = sessions.pending.get(&key).copied().unwrap_or(0);
            if failures + pending >= AUTH_FAILURE_LIMIT {
                return Err(AuthFailure::RateLimited);
            }
            if !sessions.failures.contains_key(&key)
                && sessions.failures.len() >= MAX_AUTH_FAILURE_PEERS
            {
                return Err(AuthFailure::RateLimited);
            }
            *sessions.pending.entry(key.clone()).or_default() += 1;
        }

        let expected = expected.to_owned();
        let password = password.to_owned();
        let sessions = self.sessions.clone();
        let key_for_verification = key.clone();
        let pending = PendingPasswordVerification::new(sessions, key_for_verification);
        let (delay, authenticated) = tokio::task::spawn_blocking(move || {
            // Keep both the semaphore permit and the pending-accounting guard
            // inside the blocking task. Dropping the request future must not
            // make work look idle while password verification is still running.
            let _verification_permit = verification_permit;
            let mut pending = pending;
            let valid = verify_password(&expected, &password);
            pending.finish(valid)
        })
        .await
        .map_err(|_| AuthFailure::Unavailable)??;
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
        if !authenticated {
            return Err(AuthFailure::Rejected);
        }

        let mut bytes = [0u8; AUTH_TOKEN_BYTES];
        TokenOsRng.fill_bytes(&mut bytes);
        let token = bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let mut sessions = self.sessions.lock().map_err(|_| AuthFailure::Unavailable)?;
        sessions
            .tokens
            .insert(token.clone(), Instant::now() + AUTH_SESSION_TTL);
        Ok(token)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuthFailure {
    InvalidInput,
    NotRequired,
    RateLimited,
    Rejected,
    Unavailable,
}

fn hash_password(password: &str) -> Result<String, String> {
    if password.as_bytes().len() > MAX_PASSWORD_BYTES {
        return Err(format!(
            "password must be at most {MAX_PASSWORD_BYTES} bytes"
        ));
    }
    if password.is_empty() {
        return Err("password must not be empty".into());
    }
    let salt = SaltString::generate(&mut PasswordOsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| "could not hash password".to_string())
}

async fn hash_password_async(password: &str) -> Result<String, String> {
    if password.as_bytes().len() > MAX_PASSWORD_BYTES {
        return Err(format!(
            "password must be at most {MAX_PASSWORD_BYTES} bytes"
        ));
    }
    if password.is_empty() {
        return Err("password must not be empty".into());
    }
    let password = password.to_owned();
    tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|_| "password hashing task failed".to_string())?
}

fn verify_password(encoded: &str, password: &str) -> bool {
    #[cfg(test)]
    if password == "wrong-password" && AUTH_TEST_VERIFICATION_PAUSE.load(Ordering::Acquire) {
        AUTH_TEST_VERIFICATION_STARTED.store(true, Ordering::Release);
        while AUTH_TEST_VERIFICATION_PAUSE.load(Ordering::Acquire) {
            thread::yield_now();
        }
    }
    let Ok(parsed) = PasswordHash::new(encoded) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

fn management_state_from_environment() -> ManagementState {
    let config_path = env::var("HERDR_PLUGIN_CONFIG_DIR")
        .ok()
        .map(|dir| PathBuf::from(dir).join("config.json"));
    let state_dir = env::var("HERDR_PLUGIN_STATE_DIR").ok().map(PathBuf::from);
    let controller_node = env::var("HERDR_WORLD_NODE_PATH").ok().map(PathBuf::from);
    let controller_script = env::var("HERDR_WORLD_CONTROLLER").ok().map(PathBuf::from);
    let controller_mode = env::var("HERDR_WORLD_CONTROLLER_MODE").ok();
    let controller_launcher = match controller_mode.as_deref() {
        Some("systemd-user") => env::var("HERDR_WORLD_SYSTEMD_RUN").ok().map(PathBuf::from),
        Some("launchd") => env::var("HERDR_WORLD_LAUNCHCTL").ok().map(PathBuf::from),
        _ => None,
    };
    let mutation_reason = if config_path.is_none() || state_dir.is_none() {
        Some("Remote access is read-only for this standalone or development launch; use the plugin-managed launch to apply settings safely.".to_string())
    } else if controller_node.is_none() || controller_script.is_none() {
        Some("This bridge has no controller-owned restart boundary, so settings mutation is disabled for safety.".to_string())
    } else if !matches!(
        controller_mode.as_deref(),
        Some("systemd-user" | "launchd" | "fallback")
    ) {
        Some("This bridge does not have a supervisor-owned controller boundary, so settings mutation is disabled for safety.".to_string())
    } else if !controller_node
        .as_ref()
        .is_some_and(|path| path.is_absolute())
        || !controller_script
            .as_ref()
            .is_some_and(|path| path.is_absolute())
    {
        Some("The controller restart boundary is not absolute and cannot be trusted; settings mutation is disabled.".to_string())
    } else if !controller_node.as_ref().is_some_and(|path| path.is_file())
        || !controller_script
            .as_ref()
            .is_some_and(|path| path.is_file())
    {
        Some("The controller restart boundary is unavailable; settings mutation is disabled until the managed launch is repaired.".to_string())
    } else if matches!(controller_mode.as_deref(), Some("systemd-user" | "launchd"))
        && !controller_launcher
            .as_ref()
            .is_some_and(|path| path.is_absolute() && path.is_file())
    {
        Some("The supervisor controller launcher is unavailable; settings mutation is disabled until the managed launch is repaired.".to_string())
    } else if controller_mode.as_deref() == Some("fallback") && cfg!(not(unix)) {
        Some("This fallback launch cannot establish an independent controller process on this platform; settings mutation is disabled.".to_string())
    } else {
        None
    };
    ManagementState {
        config_path,
        state_dir,
        controller_node,
        controller_script,
        controller_mode,
        controller_launcher,
        mutation_reason,
    }
}

fn is_link_local(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => address.octets()[0] == 169 && address.octets()[1] == 254,
        IpAddr::V6(address) => address.segments()[0] & 0xffc0 == 0xfe80,
    }
}

fn add_access_candidate(candidates: &mut Vec<String>, raw: &str) {
    let value = raw.trim().trim_matches('.');
    if value.is_empty() || value.eq_ignore_ascii_case("localhost") {
        return;
    }
    let valid = normalize_allowed_host(value).ok().filter(|host| {
        host.parse::<IpAddr>()
            .map(|address| {
                !address.is_loopback() && !address.is_unspecified() && !is_link_local(address)
            })
            .unwrap_or(true)
    });
    if let Some(value) = valid {
        if !candidates
            .iter()
            .any(|item| item.eq_ignore_ascii_case(&value))
        {
            candidates.push(value);
        }
    }
}

fn route_selected_address(bind: &str, destination: &str) -> Option<String> {
    let socket = UdpSocket::bind(bind).ok()?;
    socket.connect(destination).ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

fn detected_access_candidates(policy: &RequestPolicy) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();
    if !is_loopback_bind_host(&policy.bind_host) {
        add_access_candidate(&mut candidates, &policy.bind_host);
    }
    if let Some(address) = route_selected_address("0.0.0.0:0", "192.0.2.1:9") {
        add_access_candidate(&mut candidates, &address);
    }
    if let Some(address) = route_selected_address("[::]:0", "[2001:db8::1]:9") {
        add_access_candidate(&mut candidates, &address);
    }
    if let Ok(hostname) = env::var("HOSTNAME") {
        add_access_candidate(&mut candidates, &hostname);
    }
    candidates.truncate(8);
    candidates
}

fn current_remote_access_model(policy: &RequestPolicy, auth: &BridgeAuth) -> RemoteAccessModel {
    RemoteAccessModel {
        enabled: !is_loopback_bind_host(&policy.bind_host),
        accepted_hosts: policy.allowed_hosts.clone(),
        allowed_page_origins: policy.allowed_origins.clone(),
        allowed_bridge_origins: policy.allowed_connect_origins.clone(),
        password_configured: auth.required(),
    }
}

fn bounded_access_value(value: &str, label: &str) -> Result<(), BridgeError> {
    if value.as_bytes().len() > MAX_REMOTE_ACCESS_VALUE_BYTES {
        return Err(BridgeError::BadRequest(format!(
            "{label} entries must be at most {MAX_REMOTE_ACCESS_VALUE_BYTES} bytes"
        )));
    }
    Ok(())
}

fn validate_remote_access_draft(draft: &mut RemoteAccessDraft) -> Result<(), BridgeError> {
    if draft.accepted_hosts.len() > MAX_REMOTE_ACCESS_ITEMS {
        return Err(BridgeError::BadRequest(
            "too many accepted addresses".into(),
        ));
    }
    if draft.allowed_page_origins.len() > MAX_REMOTE_ACCESS_ITEMS {
        return Err(BridgeError::BadRequest(
            "too many allowed page origins".into(),
        ));
    }
    if draft.allowed_bridge_origins.len() > MAX_REMOTE_ACCESS_ITEMS {
        return Err(BridgeError::BadRequest(
            "too many allowed bridge destinations".into(),
        ));
    }
    let mut accepted_hosts = Vec::new();
    for value in &draft.accepted_hosts {
        bounded_access_value(value, "accepted address")?;
        let normalized = normalize_allowed_host(value).map_err(BridgeError::BadRequest)?;
        if !accepted_hosts
            .iter()
            .any(|item: &String| item.eq_ignore_ascii_case(&normalized))
        {
            accepted_hosts.push(normalized);
        }
    }
    let mut page_origins = Vec::new();
    for value in &draft.allowed_page_origins {
        bounded_access_value(value, "allowed page origin")?;
        let normalized = normalize_allowed_origin(value).map_err(BridgeError::BadRequest)?;
        if !page_origins
            .iter()
            .any(|item: &String| item.eq_ignore_ascii_case(&normalized))
        {
            page_origins.push(normalized);
        }
    }
    let mut bridge_origins = Vec::new();
    for value in &draft.allowed_bridge_origins {
        bounded_access_value(value, "allowed bridge destination")?;
        let normalized = normalize_allowed_origin(value).map_err(BridgeError::BadRequest)?;
        if !bridge_origins
            .iter()
            .any(|item: &String| item.eq_ignore_ascii_case(&normalized))
        {
            bridge_origins.push(normalized);
        }
    }
    if draft.enabled && accepted_hosts.is_empty() {
        return Err(BridgeError::BadRequest(
            "remote access needs at least one accepted address".into(),
        ));
    }
    if let Some(hash) = &draft.password_hash {
        if hash.as_bytes().len() > MAX_REMOTE_ACCESS_VALUE_BYTES || !hash.starts_with("$argon2") {
            return Err(BridgeError::BadRequest("password hash is invalid".into()));
        }
    }
    draft.accepted_hosts = accepted_hosts;
    draft.allowed_page_origins = page_origins;
    draft.allowed_bridge_origins = bridge_origins;
    Ok(())
}

fn read_apply_status(management: &ManagementState) -> ApplyStatusResponse {
    let Some(state_dir) = management.state_dir.as_deref() else {
        return ApplyStatusResponse {
            state: "ready".into(),
            reason: None,
            restored: None,
        };
    };
    let path = state_dir.join("remote-access-apply.json");
    let Ok(bytes) = std::fs::read(path) else {
        return ApplyStatusResponse {
            state: "ready".into(),
            reason: None,
            restored: None,
        };
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return ApplyStatusResponse {
            state: "failed".into(),
            reason: Some("controller status is unavailable".into()),
            restored: None,
        };
    };
    let state = value
        .get("state")
        .and_then(serde_json::Value::as_str)
        .filter(|state| matches!(*state, "applying" | "ready" | "failed"))
        .unwrap_or("failed")
        .to_string();
    let reason = value
        .get("reason")
        .and_then(serde_json::Value::as_str)
        .map(|reason| reason.chars().take(MAX_APPLY_REASON_BYTES).collect());
    ApplyStatusResponse {
        state,
        reason,
        restored: value.get("restored").and_then(serde_json::Value::as_bool),
    }
}

#[derive(Debug, Serialize)]
struct Snapshot {
    workspaces: Vec<SnapshotWorkspaceInfo>,
    tabs: Vec<SnapshotTabInfo>,
    panes: Vec<SnapshotPaneInfo>,
    layouts: Vec<PaneLayoutSnapshot>,
    selected_pane_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct SnapshotPaneInfo {
    #[serde(flatten)]
    info: PaneInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    task_summary: Option<String>,
}

#[derive(Debug, Serialize)]
struct SnapshotWorkspaceInfo {
    #[serde(flatten)]
    info: WorkspaceInfo,
    can_clear_name: bool,
}

#[derive(Debug, Serialize)]
struct SnapshotTabInfo {
    #[serde(flatten)]
    info: TabInfo,
    can_clear_name: bool,
}

#[derive(Debug, Serialize)]
struct Capabilities {
    bridge_api_version: u32,
    bridge_version: &'static str,
    herdr_version: String,
    terminal_protocol: u32,
    configured_label: Option<String>,
    features: &'static [&'static str],
    commands: &'static [&'static str],
    web_compat: u32,
    authentication: AuthenticationCapability,
    agent_activity: AgentActivityCapability,
    agent_pins: AgentPinsCapability,
    launcher_presets: LauncherPresetsCapability,
    notes: NotesCapability,
    observability: ObservabilityCapability,
}

#[derive(Debug, Serialize)]
struct AgentActivityCapability {
    version: u32,
}

#[derive(Debug, Serialize)]
struct AgentPinsCapability {
    version: u32,
}

#[derive(Debug, Serialize)]
struct LauncherPresetsCapability {
    version: u32,
}

#[derive(Debug, Serialize)]
struct NotesCapability {
    version: u32,
}

#[derive(Debug, Serialize)]
struct ObservabilityCapability {
    version: u32,
    contract_version: ObservabilityContractVersion,
    health: ObservabilityHealth,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ActivityMessage {
    #[serde(rename = "pane.agent_status_changed")]
    PaneAgentStatusChanged {
        pane_id: String,
        workspace_id: String,
        agent_status: AgentStatus,
        agent: Option<String>,
        title: Option<String>,
        display_agent: Option<String>,
        state_labels: HashMap<String, String>,
    },
    #[serde(rename = "resync_required")]
    ResyncRequired { reason: String },
}

#[derive(Debug, Deserialize)]
struct TerminalQuery {
    terminal_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    coalesce_ms: Option<u64>,
    output_encoding: Option<TerminalOutputWireEncoding>,
    #[serde(default)]
    takeover: bool,
    #[serde(default)]
    probe: bool,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
enum TerminalClientFrame {
    Input {
        data: String,
    },
    Resize {
        cols: u16,
        rows: u16,
        #[serde(default)]
        cell_width_px: u32,
        #[serde(default)]
        cell_height_px: u32,
    },
    Scroll {
        direction: ScrollDirection,
        #[serde(default = "default_scroll_lines")]
        lines: u16,
    },
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ScrollDirection {
    Up,
    Down,
}

fn default_scroll_lines() -> u16 {
    3
}

#[derive(Debug, Clone)]
enum TerminalOutput {
    Bytes(Bytes),
    Close(String),
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TerminalOutputWireEncoding {
    Identity,
    Gzip,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TerminalOutputFlushReason {
    Timer,
    ByteThreshold,
    ChunkThreshold,
    Close,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TerminalOutputCoalescingDecision {
    SendNow(Bytes),
    Pending,
    FlushPending(TerminalOutputFlushReason),
}

#[cfg(test)]
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct TerminalOutputCoalescingStats {
    source_frames: u64,
    source_bytes: u64,
    sent_frames: u64,
    sent_bytes: u64,
    immediate_frames: u64,
    coalesced_source_frames: u64,
    coalesced_sent_frames: u64,
    timer_flushes: u64,
    byte_flushes: u64,
    chunk_flushes: u64,
    single_chunk_flushes: u64,
    merged_flushes: u64,
    lagged_events: u64,
    lagged_frames: u64,
    max_pending_bytes: usize,
    max_pending_chunks: usize,
    total_flush_latency_us: u128,
    max_flush_latency_us: u128,
}

#[cfg(test)]
impl TerminalOutputCoalescingStats {
    fn record_source(&mut self, bytes: usize) {
        self.source_frames += 1;
        self.source_bytes += bytes as u64;
    }

    fn record_immediate_send(&mut self, bytes: usize) {
        self.sent_frames += 1;
        self.sent_bytes += bytes as u64;
        self.immediate_frames += 1;
    }

    fn record_pending(&mut self, bytes: usize, chunks: usize) {
        self.max_pending_bytes = self.max_pending_bytes.max(bytes);
        self.max_pending_chunks = self.max_pending_chunks.max(chunks);
    }

    fn record_flush_reason(&mut self, reason: TerminalOutputFlushReason) {
        match reason {
            TerminalOutputFlushReason::Timer => self.timer_flushes += 1,
            TerminalOutputFlushReason::ByteThreshold => self.byte_flushes += 1,
            TerminalOutputFlushReason::ChunkThreshold => self.chunk_flushes += 1,
            TerminalOutputFlushReason::Close => {}
        }
    }

    fn record_coalesced_send(&mut self, source_chunks: usize, bytes: usize, latency: Duration) {
        self.sent_frames += 1;
        self.sent_bytes += bytes as u64;
        self.coalesced_source_frames += source_chunks as u64;
        self.coalesced_sent_frames += 1;
        if source_chunks <= 1 {
            self.single_chunk_flushes += 1;
        } else {
            self.merged_flushes += 1;
        }

        let latency_us = latency.as_micros();
        self.total_flush_latency_us += latency_us;
        self.max_flush_latency_us = self.max_flush_latency_us.max(latency_us);
    }

    fn record_lagged(&mut self, frames: u64) {
        self.lagged_events += 1;
        self.lagged_frames += frames;
    }

    #[cfg(test)]
    fn frames_saved(&self) -> u64 {
        self.source_frames.saturating_sub(self.sent_frames)
    }

    #[cfg(test)]
    fn coalescing_ratio(&self) -> f64 {
        if self.sent_frames == 0 {
            return 0.0;
        }
        self.source_frames as f64 / self.sent_frames as f64
    }

    #[cfg(test)]
    fn avg_source_frame_bytes(&self) -> f64 {
        if self.source_frames == 0 {
            return 0.0;
        }
        self.source_bytes as f64 / self.source_frames as f64
    }

    #[cfg(test)]
    fn avg_sent_frame_bytes(&self) -> f64 {
        if self.sent_frames == 0 {
            return 0.0;
        }
        self.sent_bytes as f64 / self.sent_frames as f64
    }

    #[cfg(test)]
    fn avg_flush_latency_us(&self) -> f64 {
        if self.coalesced_sent_frames == 0 {
            return 0.0;
        }
        self.total_flush_latency_us as f64 / self.coalesced_sent_frames as f64
    }
}

struct TerminalOutputCoalescer {
    window: Duration,
    pending: Vec<Bytes>,
    pending_bytes: usize,
    pending_started_at: Option<Instant>,
    deadline: Option<Instant>,
    #[cfg(test)]
    lifetime_stats: TerminalOutputCoalescingStats,
}

impl TerminalOutputCoalescer {
    fn new(window: Duration) -> Self {
        Self {
            window,
            pending: Vec::new(),
            pending_bytes: 0,
            pending_started_at: None,
            deadline: None,
            #[cfg(test)]
            lifetime_stats: TerminalOutputCoalescingStats::default(),
        }
    }

    fn deadline(&self) -> Option<Instant> {
        self.deadline
    }

    fn push_bytes(&mut self, bytes: Bytes, now: Instant) -> TerminalOutputCoalescingDecision {
        let byte_count = bytes.len();
        self.record_source(byte_count);

        if self.window.is_zero() {
            self.record_immediate_send(byte_count);
            return TerminalOutputCoalescingDecision::SendNow(bytes);
        }

        if self.deadline.is_none() {
            self.deadline = Some(now + self.window);
            self.record_immediate_send(byte_count);
            return TerminalOutputCoalescingDecision::SendNow(bytes);
        }

        if self.pending.is_empty() {
            self.pending_started_at = Some(now);
        }
        self.pending_bytes += byte_count;
        self.pending.push(bytes);
        self.record_pending();

        if self.pending_bytes >= TERMINAL_OUTPUT_COALESCE_MAX_BYTES {
            TerminalOutputCoalescingDecision::FlushPending(TerminalOutputFlushReason::ByteThreshold)
        } else if self.pending.len() >= TERMINAL_OUTPUT_COALESCE_MAX_CHUNKS {
            TerminalOutputCoalescingDecision::FlushPending(
                TerminalOutputFlushReason::ChunkThreshold,
            )
        } else {
            TerminalOutputCoalescingDecision::Pending
        }
    }

    fn handle_deadline(&mut self) -> Option<TerminalOutputFlushReason> {
        self.deadline?;
        if self.pending.is_empty() {
            self.deadline = None;
            return None;
        }
        Some(TerminalOutputFlushReason::Timer)
    }

    fn flush_pending(&mut self, reason: TerminalOutputFlushReason, now: Instant) -> Option<Bytes> {
        if self.pending.is_empty() {
            self.pending_bytes = 0;
            self.pending_started_at = None;
            if matches!(reason, TerminalOutputFlushReason::Close) {
                self.deadline = None;
            }
            return None;
        }

        self.record_flush_reason(reason);
        let source_chunks = self.pending.len();
        let latency = self
            .pending_started_at
            .map(|started_at| now.saturating_duration_since(started_at))
            .unwrap_or_default();
        let Some(bytes) = drain_terminal_output_pending(&mut self.pending, &mut self.pending_bytes)
        else {
            self.pending_started_at = None;
            return None;
        };

        self.pending_started_at = None;
        if matches!(reason, TerminalOutputFlushReason::Close) {
            self.deadline = None;
        } else {
            // Keep a trailing window warm so sustained redraws continue batching between flushes.
            self.deadline = Some(now + self.window);
        }
        self.record_coalesced_send(source_chunks, bytes.len(), latency);
        Some(bytes)
    }

    #[cfg(test)]
    fn record_lagged(&mut self, frames: u64) {
        self.lifetime_stats.record_lagged(frames);
    }

    #[cfg(not(test))]
    fn record_lagged(&mut self, _frames: u64) {}

    #[cfg(test)]
    fn record_source(&mut self, bytes: usize) {
        self.lifetime_stats.record_source(bytes);
    }

    #[cfg(not(test))]
    fn record_source(&mut self, _bytes: usize) {}

    #[cfg(test)]
    fn record_immediate_send(&mut self, bytes: usize) {
        self.lifetime_stats.record_immediate_send(bytes);
    }

    #[cfg(not(test))]
    fn record_immediate_send(&mut self, _bytes: usize) {}

    #[cfg(test)]
    fn record_pending(&mut self) {
        self.lifetime_stats
            .record_pending(self.pending_bytes, self.pending.len());
    }

    #[cfg(not(test))]
    fn record_pending(&mut self) {}

    #[cfg(test)]
    fn record_flush_reason(&mut self, reason: TerminalOutputFlushReason) {
        self.lifetime_stats.record_flush_reason(reason);
    }

    #[cfg(not(test))]
    fn record_flush_reason(&mut self, _reason: TerminalOutputFlushReason) {}

    #[cfg(test)]
    fn record_coalesced_send(&mut self, chunks: usize, bytes: usize, latency: Duration) {
        self.lifetime_stats
            .record_coalesced_send(chunks, bytes, latency);
    }

    #[cfg(not(test))]
    fn record_coalesced_send(&mut self, _chunks: usize, _bytes: usize, _latency: Duration) {}
}

fn gzip_fast(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(bytes).ok()?;
    encoder.finish().ok()
}

fn encode_terminal_output_frame(bytes: Bytes, encoding: TerminalOutputWireEncoding) -> Bytes {
    if encoding == TerminalOutputWireEncoding::Identity {
        return bytes;
    }

    if bytes.len() >= TERMINAL_OUTPUT_GZIP_MIN_BYTES {
        if let Some(compressed) = gzip_fast(&bytes) {
            if compressed.len() < bytes.len() {
                let mut frame = Vec::with_capacity(compressed.len() + 1);
                frame.push(TERMINAL_OUTPUT_FRAME_GZIP);
                frame.extend_from_slice(&compressed);
                return Bytes::from(frame);
            }
        }
    }

    raw_terminal_output_frame(bytes)
}

fn raw_terminal_output_frame(bytes: Bytes) -> Bytes {
    let mut frame = Vec::with_capacity(bytes.len() + 1);
    frame.push(TERMINAL_OUTPUT_FRAME_RAW);
    frame.extend_from_slice(&bytes);
    Bytes::from(frame)
}

fn drain_terminal_output_pending(
    pending: &mut Vec<Bytes>,
    pending_bytes: &mut usize,
) -> Option<Bytes> {
    if pending.is_empty() {
        *pending_bytes = 0;
        return None;
    }

    let byte_count = *pending_bytes;
    *pending_bytes = 0;
    if pending.len() == 1 {
        return pending.pop();
    }

    let mut output = Vec::with_capacity(byte_count);
    for chunk in pending.drain(..) {
        output.extend_from_slice(&chunk);
    }
    Some(Bytes::from(output))
}

fn terminal_output_coalesce_window(coalesce_ms: Option<u64>) -> Duration {
    Duration::from_millis(
        coalesce_ms
            .unwrap_or(DEFAULT_TERMINAL_OUTPUT_COALESCE_MS)
            .min(MAX_TERMINAL_OUTPUT_COALESCE_MS),
    )
}

fn terminal_bell_bytes(count: u16) -> Option<Bytes> {
    let bounded_count = usize::from(count.min(MAX_TERMINAL_BELL_COUNT));
    (bounded_count > 0).then(|| Bytes::from(vec![0x07; bounded_count]))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum UnexpectedTerminalAttachMessage {
    Graphics,
    GraphicsFile,
    GraphicsTransmissionRetired,
}

impl UnexpectedTerminalAttachMessage {
    fn as_str(self) -> &'static str {
        match self {
            Self::Graphics => "Graphics",
            Self::GraphicsFile => "GraphicsFile",
            Self::GraphicsTransmissionRetired => "GraphicsTransmissionRetired",
        }
    }
}

fn unexpected_terminal_attach_message(
    message: &ServerMessage,
) -> Option<UnexpectedTerminalAttachMessage> {
    match message {
        ServerMessage::Graphics { .. } => Some(UnexpectedTerminalAttachMessage::Graphics),
        ServerMessage::GraphicsFile { .. } => Some(UnexpectedTerminalAttachMessage::GraphicsFile),
        ServerMessage::GraphicsTransmissionRetired { .. } => {
            Some(UnexpectedTerminalAttachMessage::GraphicsTransmissionRetired)
        }
        _ => None,
    }
}

fn warn_unexpected_terminal_attach_message(
    message: &ServerMessage,
    warned_messages: &mut HashSet<UnexpectedTerminalAttachMessage>,
) {
    let Some(message_type) = unexpected_terminal_attach_message(message) else {
        return;
    };
    if warned_messages.insert(message_type) {
        warn!(
            message_type = message_type.as_str(),
            "ignored unexpected terminal attach message"
        );
    }
}

/// Shared attach connections keyed by terminal id. `draining` remembers
/// connections whose `Detach` has been queued but not yet flushed to the
/// daemon and shut down by the writer thread. A reattach waits for that
/// teardown so the new attach cannot reach the daemon ahead of the pending
/// `Detach` and be rejected as a second concurrent client. The daemon never
/// closes attach sockets itself, so the close that resolves a draining entry
/// is always the bridge's own post-`Detach` shutdown. `attaching` serializes
/// fresh attach handshakes per terminal: with two concurrent attaches the
/// daemon accepts one and rejects the other, and which one the map would
/// keep is an independent race — so concurrent acquires instead wait for the
/// in-flight handshake and join the session it publishes.
#[derive(Default)]
struct TerminalSessions {
    active: HashMap<String, SharedTerminalSession>,
    draining: HashMap<String, Arc<ConnectionClosed>>,
    attaching: HashMap<String, Arc<ConnectionClosed>>,
}

/// Signals that a daemon attach connection has fully closed.
#[derive(Default)]
struct ConnectionClosed {
    closed: Mutex<bool>,
    condvar: Condvar,
}

impl ConnectionClosed {
    fn mark_closed(&self) {
        let mut closed = match self.closed.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *closed = true;
        drop(closed);
        self.condvar.notify_all();
    }

    fn is_closed(&self) -> bool {
        match self.closed.lock() {
            Ok(guard) => *guard,
            Err(poisoned) => *poisoned.into_inner(),
        }
    }

    /// Returns true once the connection is closed, or false on timeout.
    fn wait_closed(&self, timeout: Duration) -> bool {
        let closed = match self.closed.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        match self
            .condvar
            .wait_timeout_while(closed, timeout, |closed| !*closed)
        {
            Ok((closed, _)) => *closed,
            Err(poisoned) => *poisoned.into_inner().0,
        }
    }
}

#[derive(Clone)]
struct SharedTerminalSession {
    write_tx: TerminalWriter,
    output_tx: tokio::sync::broadcast::Sender<TerminalOutput>,
    client_count: Arc<AtomicUsize>,
    connection_closed: Arc<ConnectionClosed>,
}

/// Sender for daemon-bound terminal messages that bounds how many input
/// bytes may sit in the writer queue, so a client streaming input faster
/// than the pty consumes it cannot balloon bridge memory.
#[derive(Clone)]
struct TerminalWriter {
    tx: mpsc::Sender<ClientMessage>,
    queued_input_bytes: Arc<AtomicUsize>,
}

impl TerminalWriter {
    fn send(&self, message: ClientMessage) -> Result<(), mpsc::SendError<ClientMessage>> {
        self.tx.send(message)
    }

    /// Reserve queue budget for a whole input frame before any of its chunks
    /// are enqueued, so an oversized frame is rejected atomically instead of
    /// delivering truncated input to the pty.
    fn reserve_input_bytes(&self, len: usize) -> Result<(), String> {
        let queued = self.queued_input_bytes.fetch_add(len, Ordering::AcqRel);
        if queued + len > MAX_QUEUED_TERMINAL_INPUT_BYTES {
            self.queued_input_bytes.fetch_sub(len, Ordering::AcqRel);
            return Err("terminal input backlog exceeded".to_string());
        }
        Ok(())
    }

    fn release_input_bytes(&self, len: usize) {
        self.queued_input_bytes.fetch_sub(len, Ordering::AcqRel);
    }
}

#[derive(Debug)]
pub(crate) enum BridgeError {
    Api(ApiClientError),
    Io(io::Error),
    BadRequest(String),
    Conflict(String),
    Forbidden(String),
    Protocol(String),
}

#[derive(Debug)]
enum UploadError {
    BadRequest(String),
    Conflict { name: String, path: String },
    TooLarge,
    Io(io::Error),
}

impl fmt::Display for BridgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Api(err) => write!(f, "{err}"),
            Self::Io(err) => write!(f, "{err}"),
            Self::BadRequest(message) => write!(f, "{message}"),
            Self::Conflict(message) => write!(f, "{message}"),
            Self::Forbidden(message) => write!(f, "{message}"),
            Self::Protocol(message) => write!(f, "{message}"),
        }
    }
}

impl IntoResponse for BridgeError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::Api(_) | Self::Io(_) | Self::Protocol(_) => StatusCode::BAD_GATEWAY,
        };
        let body = Json(serde_json::json!({
            "error": self.to_string(),
        }));
        (status, body).into_response()
    }
}

impl From<ApiClientError> for BridgeError {
    fn from(err: ApiClientError) -> Self {
        Self::Api(err)
    }
}

impl From<io::Error> for BridgeError {
    fn from(err: io::Error) -> Self {
        Self::Io(err)
    }
}

impl From<NotesError> for BridgeError {
    fn from(err: NotesError) -> Self {
        match err {
            NotesError::BadRequest(message) => Self::BadRequest(message),
            NotesError::Conflict(message) => Self::Conflict(message),
            NotesError::Io(err) => Self::Io(err),
            NotesError::Store(message) => Self::Protocol(message),
        }
    }
}

impl From<AgentPinsError> for BridgeError {
    fn from(err: AgentPinsError) -> Self {
        match err {
            AgentPinsError::BadRequest(message) => Self::BadRequest(message),
            AgentPinsError::Io(err) => Self::Io(err),
            AgentPinsError::Store(message) => Self::Protocol(message),
        }
    }
}

impl IntoResponse for UploadError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            Self::BadRequest(message) => (
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": message }),
            ),
            Self::Conflict { name, path } => (
                StatusCode::CONFLICT,
                serde_json::json!({
                    "error": "file exists",
                    "name": name,
                    "path": path,
                }),
            ),
            Self::TooLarge => (
                StatusCode::PAYLOAD_TOO_LARGE,
                serde_json::json!({ "error": "upload exceeds 25 MB limit" }),
            ),
            Self::Io(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({ "error": err.to_string() }),
            ),
        };
        (status, Json(body)).into_response()
    }
}

impl From<io::Error> for UploadError {
    fn from(err: io::Error) -> Self {
        Self::Io(err)
    }
}

pub(crate) fn run_command(args: &[String]) -> io::Result<i32> {
    if crate::task_summary::is_task_summary_command(args) {
        return crate::task_summary::run_task_summary_command(args);
    }
    let options = match parse_options(args) {
        Ok(Some(options)) => options,
        Ok(None) => return Ok(0),
        Err(message) => {
            eprintln!("{message}");
            eprintln!(
                "usage: herdr-world-bridge [--session NAME] [--host HOST] [--port PORT] [--static-dir DIR] [--launcher-presets PATH] [--bridge-label LABEL] [--allow-origin ORIGIN] [--allow-host HOST] [--allow-connect-origin ORIGIN] [--password-hash HASH]"
            );
            return Ok(2);
        }
    };

    herdr_compat::logging::init_file_logging(crate::session::data_dir(), "herdr-web.log");
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to create tokio runtime");

    match runtime.block_on(run_server(options)) {
        Ok(()) => Ok(0),
        Err(err) => {
            eprintln!("{err}");
            Ok(1)
        }
    }
}

fn parse_options(args: &[String]) -> Result<Option<BridgeOptions>, String> {
    let mut host = DEFAULT_HOST.to_string();
    let mut port = DEFAULT_PORT;
    let mut static_dir = PathBuf::from(DEFAULT_STATIC_DIR);
    let mut upload_dir = default_upload_dir();
    let mut launcher_presets_path = None;
    let mut allowed_hosts = Vec::new();
    let mut allowed_origins = Vec::new();
    let mut allowed_connect_origins = Vec::new();
    let mut allowed_connect_sources = Vec::new();
    let mut password_hash = None;
    let mut configured_label = None;
    let mut explicit_session = None;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "help" | "--help" | "-h" => {
                print_help();
                return Ok(None);
            }
            "--host" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --host".into());
                };
                host = value.clone();
                index += 2;
            }
            "--session" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --session".into());
                };
                crate::session::validate_session_name(value)?;
                explicit_session = Some(value.clone());
                index += 2;
            }
            "--port" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --port".into());
                };
                port = value
                    .parse::<u16>()
                    .map_err(|_| "port must be between 0 and 65535".to_string())?;
                index += 2;
            }
            "--static-dir" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --static-dir".into());
                };
                static_dir = PathBuf::from(value);
                index += 2;
            }
            "--upload-dir" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --upload-dir".into());
                };
                upload_dir = expand_home(value);
                index += 2;
            }
            "--launcher-presets" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --launcher-presets".into());
                };
                launcher_presets_path = Some(expand_home(value));
                index += 2;
            }
            "--allow-host" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --allow-host".into());
                };
                allowed_hosts.push(normalize_allowed_host(value)?);
                index += 2;
            }
            "--allow-origin" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --allow-origin".into());
                };
                allowed_origins.push(normalize_allowed_origin(value)?);
                index += 2;
            }
            "--allow-connect-origin" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --allow-connect-origin".into());
                };
                let origin = normalize_allowed_origin(value)?;
                allowed_connect_origins.push(origin);
                allowed_connect_sources.extend(connect_sources_for_origin(value)?);
                index += 2;
            }
            "--password-hash" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --password-hash".into());
                };
                validate_password_hash(value)?;
                password_hash = Some(value.clone());
                index += 2;
            }
            "--bridge-label" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --bridge-label".into());
                };
                configured_label = Some(normalize_configured_label(value)?);
                index += 2;
            }
            arg => return Err(format!("unknown herdr-world option: {arg}")),
        }
    }

    allowed_connect_sources.sort();
    allowed_connect_sources.dedup();

    if !is_loopback_bind_host(&host) {
        if allowed_hosts.is_empty() {
            return Err(
                "non-loopback binding requires at least one explicit --allow-host value".into(),
            );
        }
    }

    if let Some(name) = explicit_session {
        crate::session::configure_explicit_session(&name)?;
    }

    Ok(Some(BridgeOptions {
        host,
        port,
        static_dir,
        upload_dir,
        launcher_presets_path,
        allowed_hosts,
        allowed_origins,
        allowed_connect_origins,
        allowed_connect_sources,
        password_hash,
        configured_label,
    }))
}

fn print_help() {
    println!("{}", help_text());
}

fn help_text() -> &'static str {
    "herdr-world-bridge\n\
\n\
Usage: herdr-world-bridge [--session NAME] [--host HOST] [--port PORT] [--static-dir DIR] [--upload-dir DIR] [--launcher-presets PATH] [--bridge-label LABEL] [--allow-origin ORIGIN] [--allow-host HOST] [--allow-connect-origin ORIGIN]\n\
\n\
Runs the local HTTP/WebSocket bridge for Herdr World.\n\
Defaults to the active Herdr daemon sockets and 127.0.0.1:8787.\n\
Use --session NAME to target a named Herdr session and ignore HERDR_SOCKET_PATH.\n\
Non-loopback --host values require an explicit --allow-host value.\n\
Every admitted browser has terminal-equivalent access; Host and Origin checks are not authentication.\n\
Same-origin pages matching an allowed Host are admitted automatically.\n\
Use --allow-origin http://localhost for additional clients such as the bundled Android app.\n\
Use --allow-host HOSTNAME to accept that exact DNS hostname in Host headers.\n\
Use --allow-connect-origin ORIGIN to let the served web app connect to another bridge origin.\n\
Use --password-hash HASH for the memory-hard Argon2id hash managed by the plugin controller.\n\
Use --bridge-label LABEL for a bounded diagnostic label; browser host profiles remain authoritative.\n\
Use --launcher-presets PATH or HERDR_WEB_LAUNCHER_PRESETS to load custom launch presets.\n\
Uploads default to HERDR_WEB_UPLOAD_DIR, XDG_DATA_HOME/herdr-web/uploads, or ~/.local/share/herdr-web/uploads."
}

async fn run_server(options: BridgeOptions) -> io::Result<()> {
    if !is_loopback_bind_host(&options.host) {
        warn!(
            host = %options.host,
            port = options.port,
            "every admitted browser has terminal-equivalent access; Host/Origin guards are not authentication; bind only behind operator-managed SSH, VPN, or an authenticated reverse proxy"
        );
    }
    ensure_upload_dir(&options.upload_dir)?;
    let agent_activity = Arc::new(AgentActivityManager::new());
    let agent_pins = Arc::new(AgentPinsManager::new()?);
    let launcher_presets = Arc::new(
        LauncherPresetStore::load(options.launcher_presets_path.clone())
            .map_err(|message| io::Error::new(ErrorKind::InvalidInput, message))?,
    );
    let notes = Arc::new(NotesManager::new()?);
    let request_policy = RequestPolicy {
        bind_host: options.host.clone(),
        bind_port: options.port,
        allowed_hosts: options.allowed_hosts.clone(),
        allowed_origins: options.allowed_origins.clone(),
        allowed_connect_origins: options.allowed_connect_origins.clone(),
        allowed_connect_sources: options.allowed_connect_sources.clone(),
    };
    let auth = Arc::new(BridgeAuth::new(options.password_hash.clone()));
    let api = ApiClient::for_socket_path(crate::session::active_api_socket_path());
    let daemon_status = startup_daemon_status(&api)?;
    let daemon_protocol = daemon_status
        .protocol
        .expect("startup_daemon_status validates protocol");
    let daemon_version = daemon_status
        .version
        .as_deref()
        .expect("startup_daemon_status validates version");
    info!(
        version = daemon_version,
        protocol = daemon_protocol,
        "Herdr World bridge connected to compatible Herdr daemon"
    );
    let state = BridgeState {
        api,
        client_socket_path: crate::session::active_client_socket_path(),
        request_policy: request_policy.clone(),
        auth,
        management: management_state_from_environment(),
        terminal_sessions: Arc::new(Mutex::new(TerminalSessions::default())),
        selected_pane_id: Arc::new(Mutex::new(None)),
        agent_activity,
        agent_pins,
        launcher_presets,
        notes,
        observability: crate::observability_http::state_from_environment(),
        ui_event_tx: tokio::sync::broadcast::channel(256).0,
        activity_tx: tokio::sync::broadcast::channel(512).0,
        upload_dir: options.upload_dir.clone(),
        herdr_version: daemon_version.to_string(),
        terminal_protocol: daemon_protocol,
        configured_label: options.configured_label.clone(),
    };
    spawn_agent_activity_watcher(state.clone());
    let app = bridge_router(state, options.static_dir.clone());
    let bind = listener_bind_address(&options.host, options.port);
    let dual_family = dual_family_listener_required(&options.host, &options.allowed_hosts);
    let listener = if dual_family && is_ipv6_literal(&options.host) {
        bind_ipv6_only_listener(options.port)?
    } else {
        tokio::net::TcpListener::bind(&bind).await?
    };
    let secondary_listener = if dual_family {
        if is_ipv6_literal(&options.host) {
            Some(
                tokio::net::TcpListener::bind(format!("0.0.0.0:{}", listener.local_addr()?.port()))
                    .await?,
            )
        } else {
            Some(bind_ipv6_only_listener(listener.local_addr()?.port())?)
        }
    } else {
        None
    };
    info!(url = %format!("http://{bind}"), "Herdr World bridge listening");
    let primary = axum::serve(
        listener,
        app.clone()
            .into_make_service_with_connect_info::<SocketAddr>(),
    );
    if let Some(listener) = secondary_listener {
        let secondary_bind = listener.local_addr()?;
        info!(url = %format!("http://{secondary_bind}"), "Herdr World bridge listening on the second IP family");
        tokio::select! {
            result = primary => result,
            result = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            ) => result,
        }
    } else {
        primary.await
    }
}

fn bridge_router(state: BridgeState, static_dir: PathBuf) -> Router {
    let request_policy = state.request_policy.clone();
    let agent_activity_routes = Router::new().route(
        "/api/agent-activity",
        get(agent_activity_list_handler).options(preflight_handler),
    );
    let agent_pins_routes = Router::new()
        .route(
            "/api/agent-pins",
            get(agent_pins_list_handler).options(preflight_handler),
        )
        .route(
            "/api/agent-pins/{pane_id}/pin",
            post(agent_pins_pin_handler).options(preflight_handler),
        )
        .route(
            "/api/agent-pins/{pane_id}/unpin",
            post(agent_pins_unpin_handler).options(preflight_handler),
        );
    let notes_routes = Router::new()
        .route(
            "/api/notes",
            get(notes_list_handler)
                .post(notes_create_handler)
                .options(preflight_handler),
        )
        .route(
            "/api/notes/{note_id}/update",
            post(notes_update_handler).options(preflight_handler),
        )
        .route(
            "/api/notes/{note_id}/attach",
            post(notes_attach_handler).options(preflight_handler),
        )
        .route(
            "/api/notes/{note_id}/detach",
            post(notes_detach_handler).options(preflight_handler),
        )
        .route(
            "/api/notes/{note_id}/archive",
            post(notes_archive_handler).options(preflight_handler),
        )
        .route(
            "/api/notes/{note_id}/restore",
            post(notes_restore_handler).options(preflight_handler),
        )
        .route(
            "/api/notes/{note_id}/delete",
            post(notes_delete_handler).options(preflight_handler),
        )
        .layer(DefaultBodyLimit::max(MAX_NOTES_REQUEST_BYTES));
    let launcher_preset_routes = Router::new()
        .route(
            "/api/launcher-presets",
            get(launcher_presets_handler).options(preflight_handler),
        )
        .route(
            "/api/launcher-presets/launch",
            post(launcher_preset_launch_handler).options(preflight_handler),
        );
    let auth_session_route = post(auth_session_handler)
        .options(preflight_handler)
        .layer(DefaultBodyLimit::max(MAX_PASSWORD_REQUEST_BYTES));
    let observability_routes = crate::observability_http::routes(
        state.request_policy.clone(),
        state.observability.clone(),
    );
    let static_routes = static_routes(static_dir);
    let app = Router::new()
        .merge(agent_activity_routes)
        .merge(agent_pins_routes)
        .merge(notes_routes)
        .merge(launcher_preset_routes)
        .merge(observability_routes)
        .route(
            "/api/snapshot",
            get(snapshot_handler).options(preflight_handler),
        )
        .route(
            "/api/capabilities",
            get(capabilities_handler).options(preflight_handler),
        )
        .route(
            "/api/auth/status",
            get(auth_status_handler).options(preflight_handler),
        )
        .route("/api/auth/session", auth_session_route)
        .route(
            "/api/local/remote-access",
            get(remote_access_status_handler)
                .post(remote_access_apply_handler)
                .options(preflight_handler)
                .layer(DefaultBodyLimit::max(MAX_REMOTE_ACCESS_REQUEST_BYTES)),
        )
        .route(
            "/api/command",
            post(command_handler).options(preflight_handler),
        )
        .route(
            "/api/selection",
            post(selection_handler).options(preflight_handler),
        )
        .route(
            "/api/uploads",
            post(upload_handler).options(preflight_handler),
        )
        .route("/ws/events", get(events_ws_handler))
        .route("/ws/activity", get(activity_ws_handler))
        .route("/ws/ui-events", get(ui_events_ws_handler))
        .route("/ws/terminal", get(terminal_ws_handler))
        .merge(static_routes)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            bridge_access_middleware,
        ))
        .layer(middleware::from_fn_with_state(
            request_policy.clone(),
            add_security_headers,
        ))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES))
        .with_state(state);
    app
}

fn static_routes<S>(static_dir: PathBuf) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    let world_entry = static_dir.join("index.html");
    let fallback_entry = world_entry.clone();
    let navigation_fallback = Router::new().fallback(move |request: AxumRequest| {
        let entry = fallback_entry.clone();
        async move {
            if !is_world_navigation_path(request.uri().path()) {
                return StatusCode::NOT_FOUND.into_response();
            }
            match ServeFile::new(entry).oneshot(request).await {
                Ok(response) => response.map(Body::new),
                Err(infallible) => match infallible {},
            }
        }
    });
    Router::new()
        .route_service("/spaces", ServeFile::new(world_entry.clone()))
        .route_service("/spaces/", ServeFile::new(world_entry.clone()))
        .route_service("/world", ServeFile::new(world_entry.clone()))
        .route_service("/world/", ServeFile::new(world_entry))
        .fallback_service(
            ServiceBuilder::new()
                .layer(CompressionLayer::new())
                .service(ServeDir::new(static_dir).fallback(navigation_fallback)),
        )
        .layer(middleware::from_fn(add_static_cache_headers))
}

fn listener_bind_address(host: &str, port: u16) -> String {
    let host = host.trim().trim_start_matches('[').trim_end_matches(']');
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn is_ipv6_literal(host: &str) -> bool {
    host.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<IpAddr>()
        .is_ok_and(|address| address.is_ipv6())
}

fn dual_family_listener_required(host: &str, allowed_hosts: &[String]) -> bool {
    let host = host.trim().trim_start_matches('[').trim_end_matches(']');
    if host != "0.0.0.0" && host != "::" {
        return false;
    }
    let opposite_family = if host == "::" {
        |address: IpAddr| address.is_ipv4()
    } else {
        |address: IpAddr| address.is_ipv6()
    };
    allowed_hosts.iter().any(|allowed| {
        allowed
            .trim()
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<IpAddr>()
            .is_ok_and(opposite_family)
    })
}

fn bind_ipv6_only_listener(port: u16) -> io::Result<tokio::net::TcpListener> {
    let socket = socket2::Socket::new(
        socket2::Domain::IPV6,
        socket2::Type::STREAM,
        Some(socket2::Protocol::TCP),
    )?;
    socket.set_only_v6(true)?;
    socket.set_reuse_address(true)?;
    socket.bind(&socket2::SockAddr::from(SocketAddr::new(
        IpAddr::V6(Ipv6Addr::UNSPECIFIED),
        port,
    )))?;
    socket.listen(1024)?;
    socket.set_nonblocking(true)?;
    tokio::net::TcpListener::from_std(socket.into())
}

fn is_world_navigation_path(path: &str) -> bool {
    if path == "/api"
        || path.starts_with("/api/")
        || path == "/ws"
        || path.starts_with("/ws/")
        || ["/assets", "/fonts", "/legal"]
            .iter()
            .any(|prefix| path == *prefix || path.starts_with(&format!("{prefix}/")))
    {
        return false;
    }
    Path::new(path)
        .file_name()
        .and_then(|name| Path::new(name).extension())
        .is_none()
}

async fn add_static_cache_headers(request: AxumRequest, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let mut response = next.run(request).await;
    let status = response.status();
    insert_static_cache_header(response.headers_mut(), &path, status);
    response
}

fn insert_static_cache_header(headers: &mut HeaderMap, path: &str, status: StatusCode) {
    if headers.contains_key(CACHE_CONTROL)
        || (!status.is_success() && status != StatusCode::NOT_MODIFIED)
    {
        return;
    }
    let value = if path.starts_with("/assets/") {
        HeaderValue::from_static("public, max-age=31536000, immutable")
    } else {
        HeaderValue::from_static("no-cache")
    };
    headers.insert(CACHE_CONTROL, value);
}

async fn add_security_headers(
    State(policy): State<RequestPolicy>,
    request: AxumRequest,
    next: Next,
) -> Response {
    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|info| info.0);
    let cors_origin = cors_origin_header_from_peer(request.headers(), &policy, peer);
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        content_security_policy(&policy),
    );
    if let Some(origin) = cors_origin {
        insert_cors_headers(headers, origin);
    }
    response
}

async fn bridge_access_middleware(
    State(state): State<BridgeState>,
    request: AxumRequest,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if !(path.starts_with("/api/") || path.starts_with("/ws/")) {
        return next.run(request).await;
    }

    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|info| info.0);
    if let Err(error) =
        ensure_allowed_request_from_peer(request.headers(), &state.request_policy, peer)
    {
        return error.into_response();
    }
    if request.method() == axum::http::Method::OPTIONS {
        return next.run(request).await;
    }

    if !is_public_bootstrap_path(path) {
        if !state.auth.request_is_authorized(request.headers(), peer) {
            return unauthorized_response();
        }
    }
    next.run(request).await
}

fn is_public_bootstrap_path(path: &str) -> bool {
    matches!(
        path,
        "/api/capabilities" | "/api/auth/status" | "/api/auth/session" | "/api/local/remote-access"
    )
}

fn unauthorized_response() -> Response {
    let mut response = (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({
            "code": "authentication_required",
            "error": "password required or rejected",
        })),
    )
        .into_response();
    response.headers_mut().insert(
        WWW_AUTHENTICATE,
        HeaderValue::from_static("Bearer realm=herdr-world"),
    );
    response
}

fn local_management_allowed(
    headers: &HeaderMap,
    policy: &RequestPolicy,
    peer: SocketAddr,
) -> Result<(), BridgeError> {
    ensure_allowed_request_from_peer(headers, policy, Some(peer))?;
    if !BridgeAuth::local_peer_allowed(Some(peer)) {
        return Err(BridgeError::Forbidden(
            "local management requires an actual loopback TCP peer".into(),
        ));
    }
    Ok(())
}

const CONTROLLER_ENVIRONMENT: &[&str] = &[
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "HERDR_CONFIG_PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "HOSTNAME",
    "PATH",
    "HERDR_PLUGIN_CONFIG_DIR",
    "HERDR_PLUGIN_STATE_DIR",
    "HERDR_SOCKET_PATH",
    "HERDR_BIN_PATH",
    "HERDR_WORLD_SETUP",
    "HERDR_WORLD_PLUGIN_SERVICE_ID",
    "HERDR_WORLD_CONTROLLER",
    "HERDR_WORLD_NODE_PATH",
    "HERDR_WORLD_CONTROLLER_MODE",
    "HERDR_WORLD_SYSTEMCTL",
    "HERDR_WORLD_LAUNCHCTL",
    "HERDR_WORLD_SYSTEMD_RUN",
];

fn controller_environment_arguments() -> Vec<String> {
    CONTROLLER_ENVIRONMENT
        .iter()
        .filter_map(|name| env::var(name).ok().map(|value| format!("{name}={value}")))
        .collect()
}

fn apply_controller_environment(command: &mut Command) {
    command.env_clear();
    for value in controller_environment_arguments() {
        if let Some((name, value)) = value.split_once('=') {
            command.env(name, value);
        }
    }
}

fn spawn_management_controller(
    management: &ManagementState,
    request_path: &Path,
) -> io::Result<()> {
    let node = management
        .controller_node
        .as_deref()
        .ok_or_else(|| io::Error::new(ErrorKind::NotFound, "controller node is unavailable"))?;
    let controller = management
        .controller_script
        .as_deref()
        .ok_or_else(|| io::Error::new(ErrorKind::NotFound, "controller script is unavailable"))?;
    let mode = management.controller_mode.as_deref().unwrap_or_default();
    let sequence = CONTROLLER_TEMP_COUNTER.fetch_add(1, Ordering::AcqRel);
    match mode {
        "systemd-user" => {
            let launcher = management
                .controller_launcher
                .as_deref()
                .ok_or_else(|| io::Error::new(ErrorKind::NotFound, "systemd-run is unavailable"))?;
            let unit = format!(
                "herdr-world-apply-{}-{sequence}.service",
                std::process::id()
            );
            let mut command = Command::new(launcher);
            command
                .arg("--user")
                .arg("--unit")
                .arg(unit)
                .arg("--collect")
                .arg("--no-block");
            for value in controller_environment_arguments() {
                command.arg("--setenv").arg(value);
            }
            command.arg("--setenv").arg(format!(
                "HERDR_WORLD_APPLY_GRACE_MS={CONTROLLER_HANDOFF_GRACE_MS}"
            ));
            command
                .arg("--")
                .arg(node)
                .arg(controller)
                .arg("apply")
                .arg(request_path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            let mut child = command.spawn()?;
            let status = child.wait()?;
            if status.success() {
                Ok(())
            } else {
                Err(io::Error::new(
                    ErrorKind::Other,
                    "systemd-run did not start the controller",
                ))
            }
        }
        "launchd" => {
            let launcher = management
                .controller_launcher
                .as_deref()
                .ok_or_else(|| io::Error::new(ErrorKind::NotFound, "launchctl is unavailable"))?;
            let label = format!(
                "io.ivoryheart.herdr-world.apply.{}-{sequence}",
                std::process::id()
            );
            let mut command = Command::new(launcher);
            command
                .arg("submit")
                .arg("-l")
                .arg(label)
                .arg("--")
                .arg("/usr/bin/env");
            for value in controller_environment_arguments() {
                command.arg(value);
            }
            command.arg(format!(
                "HERDR_WORLD_APPLY_GRACE_MS={CONTROLLER_HANDOFF_GRACE_MS}"
            ));
            command
                .arg(node)
                .arg(controller)
                .arg("apply")
                .arg(request_path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            let mut child = command.spawn()?;
            let status = child.wait()?;
            if status.success() {
                Ok(())
            } else {
                Err(io::Error::new(
                    ErrorKind::Other,
                    "launchctl did not submit the controller",
                ))
            }
        }
        "fallback" => {
            let mut command = Command::new(node);
            apply_controller_environment(&mut command);
            command.env("HERDR_WORLD_APPLY_GRACE_MS", CONTROLLER_HANDOFF_GRACE_MS);
            command
                .arg(controller)
                .arg("apply")
                .arg(request_path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            #[cfg(unix)]
            unsafe {
                command.pre_exec(|| {
                    if libc::setsid() == -1 {
                        Err(io::Error::last_os_error())
                    } else {
                        Ok(())
                    }
                });
            }
            command.spawn().map(|_| ())
        }
        _ => Err(io::Error::new(
            ErrorKind::PermissionDenied,
            "controller supervisor boundary is unavailable",
        )),
    }
}

async fn auth_status_handler(
    State(state): State<BridgeState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, BridgeError> {
    ensure_allowed_request_from_peer(&headers, &state.request_policy, Some(peer))?;
    Ok(Json(serde_json::json!({
        "required": state.auth.required(),
        "authenticated": state.auth.request_is_authorized(&headers, Some(peer)),
        "local_peer_bypass": BridgeAuth::local_peer_allowed(Some(peer)),
    })))
}

async fn auth_session_handler(
    State(state): State<BridgeState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<PasswordSessionResponse>, Response> {
    if let Err(error) =
        ensure_allowed_request_from_peer(&headers, &state.request_policy, Some(peer))
    {
        return Err(error.into_response());
    }
    if body.len() > MAX_PASSWORD_REQUEST_BYTES {
        return Err(
            BridgeError::BadRequest("password request is too large".into()).into_response(),
        );
    }
    let request: PasswordRequest = serde_json::from_slice(&body).map_err(|_| {
        BridgeError::BadRequest("password request is invalid".into()).into_response()
    })?;
    if request.password.as_bytes().len() > MAX_PASSWORD_BYTES {
        return Err(BridgeError::BadRequest(format!(
            "password must be at most {MAX_PASSWORD_BYTES} bytes"
        ))
        .into_response());
    }
    match state
        .auth
        .issue_session(Some(peer), &request.password)
        .await
    {
        Ok(token) => Ok(Json(PasswordSessionResponse {
            authenticated: true,
            expires_in_seconds: AUTH_SESSION_TTL.as_secs(),
            token: Some(token),
        })),
        Err(AuthFailure::InvalidInput) => Err(BridgeError::BadRequest(format!(
            "password must be at most {MAX_PASSWORD_BYTES} bytes"
        ))
        .into_response()),
        Err(AuthFailure::NotRequired) => Err(BridgeError::BadRequest(
            "password protection is not enabled".into(),
        )
        .into_response()),
        Err(AuthFailure::RateLimited) => Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({
                "code": "authentication_rate_limited",
                "error": "too many password attempts; retry shortly",
            })),
        )
            .into_response()),
        Err(AuthFailure::Rejected) => Err(unauthorized_response()),
        Err(AuthFailure::Unavailable) => {
            Err(BridgeError::Protocol("authentication service unavailable".into()).into_response())
        }
    }
}

async fn remote_access_status_handler(
    State(state): State<BridgeState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<RemoteAccessStatusResponse>, BridgeError> {
    local_management_allowed(&headers, &state.request_policy, peer)?;
    Ok(Json(remote_access_status(&state)))
}

fn remote_access_status(state: &BridgeState) -> RemoteAccessStatusResponse {
    let model = current_remote_access_model(&state.request_policy, &state.auth);
    RemoteAccessStatusResponse {
        remote_access: model,
        port: state.request_policy.bind_port,
        suggestions: detected_access_candidates(&state.request_policy),
        mutation_allowed: state.management.mutation_reason.is_none()
            && state
                .management
                .config_path
                .as_ref()
                .is_some_and(|path| path.parent().is_some_and(Path::is_dir)),
        mutation_reason: state.management.mutation_reason.clone(),
        apply: read_apply_status(&state.management),
    }
}

async fn remote_access_apply_handler(
    State(state): State<BridgeState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<ApplyStatusResponse>), BridgeError> {
    local_management_allowed(&headers, &state.request_policy, peer)?;
    if let Some(reason) = &state.management.mutation_reason {
        return Err(BridgeError::Forbidden(reason.clone()));
    }
    if state.management.config_path.as_ref().map_or(true, |path| {
        path.parent().map_or(true, |parent| !parent.is_dir())
    }) {
        return Err(BridgeError::Forbidden(
            "remote access configuration storage is unavailable".into(),
        ));
    }
    if body.len() > 64 * 1024 {
        return Err(BridgeError::BadRequest(
            "remote access draft is too large".into(),
        ));
    }
    let mut request: RemoteAccessApplyRequest = serde_json::from_slice(&body)
        .map_err(|_| BridgeError::BadRequest("remote access draft is invalid".into()))?;
    match request.password_action {
        PasswordAction::Keep => {
            request.remote_access.password_hash = state.auth.password_hash();
            if request.password.is_some() {
                return Err(BridgeError::BadRequest(
                    "password is only accepted when setting or changing it".into(),
                ));
            }
        }
        PasswordAction::Remove => {
            if request.password.is_some() {
                return Err(BridgeError::BadRequest(
                    "password is not accepted when removing protection".into(),
                ));
            }
            request.remote_access.password_hash = None;
        }
        PasswordAction::Set => {
            let password = request
                .password
                .as_deref()
                .ok_or_else(|| BridgeError::BadRequest("a password is required".into()))?;
            request.remote_access.password_hash = Some(
                hash_password_async(password)
                    .await
                    .map_err(BridgeError::BadRequest)?,
            );
        }
    }
    validate_remote_access_draft(&mut request.remote_access)?;

    let Some(state_dir) = state.management.state_dir.as_deref() else {
        return Err(BridgeError::Forbidden(
            "remote access mutation is unavailable".into(),
        ));
    };
    std::fs::create_dir_all(state_dir).map_err(BridgeError::Io)?;
    let request_path = state_dir.join(format!(
        ".remote-access-request-{}-{}.json",
        std::process::id(),
        UPLOAD_TEMP_COUNTER.fetch_add(1, Ordering::AcqRel)
    ));
    let content = serde_json::to_vec(&serde_json::json!({
        "remote_access": request.remote_access,
    }))
    .map_err(|error| BridgeError::Protocol(error.to_string()))?;
    write_restrictive_file(&request_path, &content)?;
    if let Err(error) = spawn_management_controller(&state.management, &request_path) {
        let _ = std::fs::remove_file(&request_path);
        return Err(BridgeError::Io(error));
    }
    Ok((
        StatusCode::ACCEPTED,
        Json(ApplyStatusResponse {
            state: "applying".into(),
            reason: Some("settings saved; the managed bridge is restarting".into()),
            restored: None,
        }),
    ))
}

fn write_restrictive_file(path: &Path, content: &[u8]) -> Result<(), BridgeError> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(BridgeError::Io)?;
    file.write_all(content).map_err(BridgeError::Io)?;
    file.flush().map_err(BridgeError::Io)
}

async fn preflight_handler(
    State(state): State<BridgeState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Response, BridgeError> {
    preflight_response_from_peer(&headers, &state.request_policy, Some(peer))
}

pub(crate) fn preflight_response_from_peer(
    headers: &HeaderMap,
    policy: &RequestPolicy,
    peer: Option<SocketAddr>,
) -> Result<Response, BridgeError> {
    ensure_allowed_request_from_peer(headers, policy, peer)?;
    let Some(origin) = cors_origin_header_from_peer(headers, policy, peer) else {
        return Err(BridgeError::Forbidden(
            "cross-origin requests are not allowed".to_string(),
        ));
    };
    let mut response = StatusCode::NO_CONTENT.into_response();
    insert_cors_headers(response.headers_mut(), origin);
    if let Some(request_headers) = headers.get(ACCESS_CONTROL_REQUEST_HEADERS) {
        response
            .headers_mut()
            .insert(ACCESS_CONTROL_ALLOW_HEADERS, request_headers.clone());
    }
    Ok(response)
}

#[cfg(test)]
fn cors_origin_header(headers: &HeaderMap, policy: &RequestPolicy) -> Option<HeaderValue> {
    cors_origin_header_from_peer(headers, policy, None)
}

fn cors_origin_header_from_peer(
    headers: &HeaderMap,
    policy: &RequestPolicy,
    peer: Option<SocketAddr>,
) -> Option<HeaderValue> {
    let origin = headers.get(ORIGIN)?;
    if request_allowed_from_peer(headers, policy, peer) {
        Some(origin.clone())
    } else {
        None
    }
}

fn insert_cors_headers(headers: &mut HeaderMap, origin: HeaderValue) {
    headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    headers.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    if !headers.contains_key(ACCESS_CONTROL_ALLOW_HEADERS) {
        headers.insert(
            ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("content-type"),
        );
    }
    headers.insert(ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("600"));
    headers.insert(VARY, HeaderValue::from_static("Origin"));
}

fn is_loopback_bind_host(host: &str) -> bool {
    matches!(
        host.to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1"
    )
}

fn default_upload_dir() -> PathBuf {
    if let Some(path) = non_empty_env_path("HERDR_WEB_UPLOAD_DIR") {
        return path;
    }
    if let Some(data_home) = non_empty_env_path("XDG_DATA_HOME") {
        return data_home.join("herdr-web").join("uploads");
    }
    if let Some(home) = non_empty_env_path("HOME") {
        return home
            .join(".local")
            .join("share")
            .join("herdr-web")
            .join("uploads");
    }
    PathBuf::from("herdr-web-uploads")
}

// Intentionally diverges from `store_util::non_empty_env_path`: upload dir
// configuration trims whitespace and expands a leading `~`.
fn non_empty_env_path(name: &str) -> Option<PathBuf> {
    let value = env::var(name).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(expand_home(trimmed))
    }
}

fn expand_home(value: &str) -> PathBuf {
    if value == "~" {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home);
        }
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(value)
}

fn ensure_upload_dir(path: &Path) -> io::Result<()> {
    // Only tighten permissions on directories the bridge itself creates; an
    // operator-supplied pre-existing directory keeps its permissions.
    let pre_existing = path.is_dir();
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    if !pre_existing {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn sanitize_upload_file_name(input: &str) -> Option<String> {
    let normalized = input.replace('\\', "/");
    let file_name = Path::new(&normalized).file_name()?.to_string_lossy();
    let mut output = String::new();
    for ch in file_name.trim().chars() {
        if ch == '/' || ch == '\\' || ch.is_control() {
            continue;
        }
        output.push(ch);
    }
    let output = output.trim_matches('.').trim().to_string();
    if output.is_empty() || output == "." || output == ".." {
        return None;
    }
    if output.len() > 180 {
        let mut truncated = String::new();
        for ch in output.chars() {
            if truncated.len() + ch.len_utf8() > 180 {
                break;
            }
            truncated.push(ch);
        }
        return finalize_upload_file_name(truncated);
    }
    finalize_upload_file_name(output)
}

fn finalize_upload_file_name(name: String) -> Option<String> {
    let name = name.trim_matches('.').trim().to_string();
    if name.is_empty() || name == "." || name == ".." {
        None
    } else {
        Some(name)
    }
}

fn generated_upload_name(mime: Option<&str>) -> String {
    let extension = upload_extension_for_mime(mime).unwrap_or("bin");
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let suffix = UPLOAD_TEMP_COUNTER.fetch_add(1, Ordering::AcqRel);
    format!("pasted-file-{millis}-{suffix}.{extension}")
}

fn upload_extension_for_mime(mime: Option<&str>) -> Option<&'static str> {
    match mime?
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        "text/plain" => Some("txt"),
        "application/pdf" => Some("pdf"),
        _ => None,
    }
}

fn is_direct_child(parent: &Path, child: &Path) -> bool {
    child
        .parent()
        .is_some_and(|child_parent| child_parent == parent)
}

/// Mutating methods the browser client is allowed to invoke. Anything outside
/// this list (e.g. `server.stop`, `pane.send_keys`) is rejected so the bridge
/// only exposes the workspace/tab/pane lifecycle the UI needs.
const ALLOWED_COMMANDS: &[&str] = &[
    "workspace.create",
    "workspace.rename",
    "workspace.close",
    "workspace.focus",
    // Atomic same-session workspace ordering; the browser supplies explicit ids only.
    "workspace.move_block",
    "tab.create",
    "tab.rename",
    "tab.close",
    "tab.focus",
    "pane.rename",
    "pane.close",
    // Layout-mutating: the web client builds splits directly.
    "pane.split",
    // Directional pane focus: explicit pane_id only, matching the web selection.
    "pane.focus_direction",
    // Narrow live pane moves: new tab or new workspace destinations only.
    "pane.move",
];

const CAPABILITY_FEATURES: &[&str] = &[
    "snapshot",
    "structural_events",
    "shared_selection",
    "agent_activity",
    "agent_pins",
    "launcher_presets",
    "notes",
    "uploads",
    "terminal_attach",
    "terminal_input",
    "terminal_resize",
    "terminal_scroll",
    "terminal_shared_fanout",
    "observability_extension",
];

fn ensure_allowed_request_from_peer(
    headers: &HeaderMap,
    policy: &RequestPolicy,
    peer: Option<SocketAddr>,
) -> Result<(), BridgeError> {
    if request_allowed_from_peer(headers, policy, peer) {
        return Ok(());
    }
    Err(BridgeError::Forbidden(
        "cross-origin requests are not allowed".to_string(),
    ))
}

#[cfg(test)]
fn request_allowed(headers: &HeaderMap, policy: &RequestPolicy) -> bool {
    request_allowed_from_peer(headers, policy, None)
}

fn request_allowed_from_peer(
    headers: &HeaderMap,
    policy: &RequestPolicy,
    peer: Option<SocketAddr>,
) -> bool {
    request_host_allowed_from_peer(headers, policy, peer)
        && request_origin_allowed_from_peer(headers, policy, peer)
}

fn request_host_allowed_from_peer(
    headers: &HeaderMap,
    policy: &RequestPolicy,
    peer: Option<SocketAddr>,
) -> bool {
    let Some(host) = headers.get(HOST).and_then(|host| host.to_str().ok()) else {
        return false;
    };
    host_authority_allowed_from_peer(host, policy, peer)
}

#[cfg(test)]
fn host_authority_allowed(authority: &str, policy: &RequestPolicy) -> bool {
    host_authority_allowed_from_peer(authority, policy, None)
}

fn host_authority_allowed_from_peer(
    authority: &str,
    policy: &RequestPolicy,
    peer: Option<SocketAddr>,
) -> bool {
    let host = host_part(authority);
    if host.is_empty() {
        return false;
    }

    if is_loopback_bind_host(&policy.bind_host) && is_loopback_host(host) {
        return true;
    }

    if peer.is_some_and(peer_is_loopback)
        && is_loopback_host(host)
        && authority_port_matches(authority, policy.bind_port)
    {
        return true;
    }

    // A LAN/VPN listener must never accept a loopback Host value as a shortcut.
    // The accepted TCP peer is checked separately for local authentication.
    if is_loopback_host(host) {
        return false;
    }

    if !authority_port_matches(authority, policy.bind_port) {
        return false;
    }

    if policy
        .allowed_hosts
        .iter()
        .any(|allowed| host.eq_ignore_ascii_case(allowed))
    {
        return true;
    }

    false
}

#[cfg(test)]
fn request_origin_allowed(headers: &HeaderMap, policy: &RequestPolicy) -> bool {
    request_origin_allowed_from_peer(headers, policy, None)
}

fn request_origin_allowed_from_peer(
    headers: &HeaderMap,
    policy: &RequestPolicy,
    peer: Option<SocketAddr>,
) -> bool {
    let Some(origin) = headers.get(ORIGIN) else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let Some(origin_authority) = origin_authority(origin) else {
        return false;
    };
    let Some(host) = headers.get(HOST).and_then(|host| host.to_str().ok()) else {
        return false;
    };

    let explicitly_allowed = policy
        .allowed_origins
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(origin));
    if !is_loopback_bind_host(&policy.bind_host)
        && !(peer.is_some_and(peer_is_loopback)
            && is_loopback_authority(origin_authority)
            && is_loopback_authority(host))
    {
        return same_authority(origin_authority, host) || explicitly_allowed;
    }

    same_authority(origin_authority, host)
        || (is_loopback_authority(origin_authority) && is_loopback_authority(host))
        || explicitly_allowed
}

fn origin_authority(origin: &str) -> Option<&str> {
    let rest = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))?;
    if rest.is_empty() || rest.contains('/') {
        return None;
    }
    Some(rest)
}

fn normalize_allowed_origin(origin: &str) -> Result<String, String> {
    let origin = origin.trim().to_ascii_lowercase();
    let Some(authority) = origin_authority(&origin) else {
        return Err("allowed origin must be an http or https origin without a path".into());
    };
    if authority.is_empty() {
        return Err("allowed origin must include a host".into());
    }
    Ok(origin)
}

fn connect_sources_for_origin(origin: &str) -> Result<Vec<String>, String> {
    let origin = normalize_allowed_origin(origin)?;
    let websocket_origin = if let Some(authority) = origin.strip_prefix("http://") {
        format!("ws://{authority}")
    } else if let Some(authority) = origin.strip_prefix("https://") {
        format!("wss://{authority}")
    } else {
        unreachable!("normalize_allowed_origin only accepts http and https origins")
    };
    Ok(vec![origin, websocket_origin])
}

fn content_security_policy(policy: &RequestPolicy) -> HeaderValue {
    let mut connect_src = vec!["'self'".to_string(), "data:".to_string()];
    connect_src.extend(policy.allowed_connect_sources.iter().cloned());
    let value = format!(
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src {}; \
         img-src 'self' data: blob:; \
         style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; \
         frame-ancestors 'none'",
        connect_src.join(" ")
    );
    HeaderValue::from_str(&value).expect("connect-src sources are validated origins")
}

fn websocket_auth_protocol(headers: &HeaderMap) -> Option<String> {
    BridgeAuth::websocket_token(headers).map(|token| format!("herdr-world-auth.{token}"))
}

fn configure_websocket_protocol(ws: WebSocketUpgrade, headers: &HeaderMap) -> WebSocketUpgrade {
    if let Some(protocol) = websocket_auth_protocol(headers) {
        ws.protocols([protocol])
    } else {
        ws
    }
}

fn normalize_allowed_host(host: &str) -> Result<String, String> {
    let host = host.trim().trim_matches('.');
    if host.is_empty() {
        return Err("allowed host must not be empty".into());
    }
    if host.contains('/') || host.contains('\\') {
        return Err(
            "allowed host must be a hostname or IP literal without scheme, port, or path".into(),
        );
    }
    let ip_candidate = host.trim_start_matches('[').trim_end_matches(']');
    if ip_candidate.parse::<IpAddr>().is_ok() {
        return Ok(ip_candidate.to_ascii_lowercase());
    }
    if host.contains(':') || !is_valid_dns_hostname(host) {
        return Err("allowed host is not a valid hostname or IP literal".into());
    }
    Ok(host.to_ascii_lowercase())
}

fn validate_password_hash(hash: &str) -> Result<(), String> {
    if hash.as_bytes().len() > MAX_REMOTE_ACCESS_VALUE_BYTES || !hash.starts_with("$argon2") {
        return Err("password hash must be a bounded Argon2 hash".into());
    }
    PasswordHash::new(hash)
        .map(|_| ())
        .map_err(|_| "password hash is invalid".to_string())
}

fn normalize_configured_label(label: &str) -> Result<String, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("bridge label must not be empty".into());
    }
    if label.chars().count() > MAX_CONFIGURED_LABEL_CHARS || label.chars().any(|ch| ch.is_control())
    {
        return Err(format!(
            "bridge label must be at most {MAX_CONFIGURED_LABEL_CHARS} display-safe characters"
        ));
    }
    Ok(label.to_string())
}

fn is_valid_dns_hostname(host: &str) -> bool {
    if host.len() > 253 {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}

fn same_authority(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

fn is_loopback_authority(authority: &str) -> bool {
    let host = host_part(authority);
    is_loopback_host(host)
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
}

fn peer_is_loopback(address: SocketAddr) -> bool {
    address.ip().is_loopback()
        || matches!(
            address.ip(),
            IpAddr::V6(address) if address
                .to_ipv4_mapped()
                .is_some_and(|mapped| mapped.is_loopback())
        )
}

fn authority_port_matches(authority: &str, expected_port: u16) -> bool {
    match authority_port(authority) {
        Some(port) => port == expected_port,
        None => expected_port == 80,
    }
}

fn authority_port(authority: &str) -> Option<u16> {
    if authority.parse::<IpAddr>().is_ok() {
        return None;
    }
    if let Some(rest) = authority.strip_prefix('[') {
        let end = rest.find(']')?;
        return rest[end + 1..]
            .strip_prefix(':')
            .and_then(|port| port.parse().ok());
    }
    let (_, port) = authority.rsplit_once(':')?;
    if port.contains(':') {
        return None;
    }
    port.parse().ok()
}

fn host_part(authority: &str) -> &str {
    if let Some(rest) = authority.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            return &rest[..end];
        }
    }
    if authority.parse::<IpAddr>().is_ok() {
        return authority;
    }
    authority.split(':').next().unwrap_or(authority)
}

fn validate_web_command(method: &Method) -> Result<(), BridgeError> {
    match method {
        Method::WorkspaceCreate(params) => {
            if params.cwd.is_some() || !params.env.is_empty() || !params.focus {
                return Err(BridgeError::BadRequest(
                    "workspace.create is limited to focused default workspaces through Herdr World"
                        .to_string(),
                ));
            }
            if params
                .label
                .as_deref()
                .is_some_and(|label| label.trim().is_empty() || label.len() > 120)
            {
                return Err(BridgeError::BadRequest(
                    "workspace.create label must be non-empty and up to 120 bytes".to_string(),
                ));
            }
        }
        Method::WorkspaceMoveBlock(params) => {
            if params.workspace_ids.is_empty() || params.workspace_ids.len() > 256 {
                return Err(BridgeError::BadRequest(
                    "workspace.move_block requires between 1 and 256 workspace_ids".to_string(),
                ));
            }
            let mut unique_ids = HashSet::with_capacity(params.workspace_ids.len());
            if params.workspace_ids.iter().any(|workspace_id| {
                workspace_id.trim().is_empty()
                    || workspace_id.len() > 256
                    || !unique_ids.insert(workspace_id.as_str())
            }) {
                return Err(BridgeError::BadRequest(
                    "workspace.move_block workspace_ids must be unique, non-empty, and at most 256 bytes"
                        .to_string(),
                ));
            }
            if params
                .before_workspace_id
                .as_deref()
                .is_some_and(|workspace_id| {
                    workspace_id.trim().is_empty()
                        || workspace_id.len() > 256
                        || unique_ids.contains(workspace_id)
                })
            {
                return Err(BridgeError::BadRequest(
                    "workspace.move_block before_workspace_id must be a distinct valid workspace id"
                        .to_string(),
                ));
            }
        }
        Method::TabCreate(params) => {
            if params
                .workspace_id
                .as_deref()
                .is_none_or(|workspace_id| workspace_id.trim().is_empty())
                || params.cwd.is_some()
                || !params.env.is_empty()
                || !params.focus
            {
                return Err(BridgeError::BadRequest(
                    "tab.create is limited to focused tabs in an existing workspace through Herdr World"
                        .to_string(),
                ));
            }
            if params
                .label
                .as_deref()
                .is_some_and(|label| label.trim().is_empty() || label.len() > 120)
            {
                return Err(BridgeError::BadRequest(
                    "tab.create label must be non-empty and up to 120 bytes".to_string(),
                ));
            }
        }
        Method::WorkspaceRename(params) => {
            if params.workspace_id.trim().is_empty() {
                return Err(BridgeError::BadRequest(
                    "workspace_id is required".to_string(),
                ));
            }
            validate_optional_label(&params.label, "workspace.rename label")?;
        }
        Method::TabRename(params) => {
            if params.tab_id.trim().is_empty() {
                return Err(BridgeError::BadRequest("tab_id is required".to_string()));
            }
            validate_optional_label(&params.label, "tab.rename label")?;
        }
        Method::PaneSplit(params) => {
            if params
                .target_pane_id
                .as_deref()
                .is_none_or(|pane_id| pane_id.trim().is_empty())
            {
                return Err(BridgeError::BadRequest(
                    "pane.split requires target_pane_id".to_string(),
                ));
            }
            if params.workspace_id.is_some()
                || params.ratio.is_some()
                || params.cwd.is_some()
                || !params.env.is_empty()
            {
                return Err(BridgeError::BadRequest(
                    "pane.split supports only target pane, direction, and focus through Herdr World"
                        .to_string(),
                ));
            }
        }
        Method::PaneFocusDirection(params) => {
            if params
                .pane_id
                .as_deref()
                .is_none_or(|pane_id| pane_id.trim().is_empty())
            {
                return Err(BridgeError::BadRequest(
                    "pane.focus_direction requires pane_id".to_string(),
                ));
            }
        }
        Method::PaneMove(params) => {
            if params.pane_id.trim().is_empty() {
                return Err(BridgeError::BadRequest("pane_id is required".to_string()));
            }
            if !params.focus {
                return Err(BridgeError::BadRequest(
                    "pane.move must focus the moved pane through Herdr World".to_string(),
                ));
            }
            match &params.destination {
                PaneMoveDestination::NewTab {
                    workspace_id,
                    label,
                } => {
                    if workspace_id
                        .as_deref()
                        .is_none_or(|workspace_id| workspace_id.trim().is_empty())
                    {
                        return Err(BridgeError::BadRequest(
                            "pane.move new_tab requires workspace_id through Herdr World"
                                .to_string(),
                        ));
                    }
                    validate_optional_label(label, "pane.move new_tab label")?;
                }
                PaneMoveDestination::NewWorkspace { label, tab_label } => {
                    validate_optional_label(label, "pane.move new_workspace label")?;
                    validate_optional_label(tab_label, "pane.move new_workspace tab_label")?;
                }
                PaneMoveDestination::Tab { .. } => {
                    return Err(BridgeError::BadRequest(
                        "pane.move to existing tabs is not exposed through Herdr World".to_string(),
                    ));
                }
            }
        }
        Method::PaneRename(params) => {
            if params.pane_id.trim().is_empty() {
                return Err(BridgeError::BadRequest("pane_id is required".to_string()));
            }
            validate_optional_label(&params.label, "pane.rename label")?;
        }
        _ => {}
    }
    Ok(())
}

fn validate_optional_label(label: &Option<String>, field: &str) -> Result<(), BridgeError> {
    if label
        .as_deref()
        .is_some_and(|label| label.trim().is_empty() || label.len() > 120)
    {
        return Err(BridgeError::BadRequest(format!(
            "{field} must be non-empty and up to 120 bytes"
        )));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct CommandRequest {
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct SelectionRequest {
    pane_id: String,
}

#[derive(Debug, Deserialize)]
struct UploadQuery {
    name: Option<String>,
    #[serde(default)]
    overwrite: bool,
}

#[derive(Debug, Serialize)]
struct UploadEntry {
    name: String,
    path: String,
    size: usize,
    mime: Option<String>,
}

#[derive(Debug, Serialize)]
struct UploadResponse {
    file: UploadEntry,
}

#[derive(Debug, Deserialize)]
struct LauncherPresetLaunchRequest {
    preset_id: String,
    target: LauncherPresetLaunchTarget,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
enum LauncherPresetLaunchTarget {
    Tab {
        workspace_id: String,
    },
    Split {
        tab_id: String,
        target_pane_id: String,
        direction: SplitDirection,
    },
}

#[derive(Debug, Serialize)]
struct LauncherPresetLaunchResponse {
    preset_id: String,
    title: String,
    workspace_id: String,
    tab_id: String,
    pane_id: String,
}

#[derive(Debug)]
struct LauncherPresetError {
    status: StatusCode,
    code: &'static str,
    message: String,
    herdr_code: Option<String>,
}

impl LauncherPresetError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "invalid_preset_launch",
            message: message.into(),
            herdr_code: None,
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "preset_not_found",
            message: message.into(),
            herdr_code: None,
        }
    }

    fn layout_changed(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            code: "layout_changed",
            message: message.into(),
            herdr_code: None,
        }
    }

    fn launch_failed(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            code: "herdr_launch_failed",
            message: message.into(),
            herdr_code: None,
        }
    }

    fn from_herdr_error(code: String, message: String) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            code: "herdr_launch_failed",
            message,
            herdr_code: Some(code),
        }
    }
}

impl IntoResponse for LauncherPresetError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({
                "code": self.code,
                "error": self.message,
            })),
        )
            .into_response()
    }
}

async fn command_handler(
    State(state): State<BridgeState>,
    Json(body): Json<CommandRequest>,
) -> Result<Json<serde_json::Value>, BridgeError> {
    if !ALLOWED_COMMANDS.contains(&body.method.as_str()) {
        return Err(BridgeError::Forbidden(format!(
            "command not allowed: {}",
            body.method
        )));
    }

    let params = if body.params.is_null() {
        serde_json::json!({})
    } else {
        body.params
    };
    let request_value = serde_json::json!({
        "id": format!("herdr-web:cmd:{}", body.method),
        "method": body.method,
        "params": params,
    });
    let mut request: Request = serde_json::from_value(request_value)
        .map_err(|err| BridgeError::BadRequest(format!("invalid command: {err}")))?;
    validate_web_command(&request.method)?;
    let should_prune_terminal_sessions = command_may_close_terminal_session(&request.method);

    let api = state.api.clone();
    let response = tokio::task::spawn_blocking(move || {
        fill_clear_rename_labels(&api, &mut request.method)?;
        Ok::<_, BridgeError>(api.request(request)?)
    })
    .await
    .map_err(|err| BridgeError::Protocol(err.to_string()))??;
    if let ResponseResult::PaneMove { move_result } = &response.result {
        if move_result.changed {
            let notes = state.notes.clone();
            let previous_pane_id = move_result.previous_pane_id.clone();
            let moved_pane = (*move_result.pane).clone();
            match tokio::task::spawn_blocking(move || {
                notes.update_for_pane_move(&previous_pane_id, &moved_pane)
            })
            .await
            .map_err(|err| BridgeError::Protocol(err.to_string()))?
            {
                Ok(true) => broadcast_notes_changed(&state, None, None),
                Ok(false) => {}
                Err(err) => warn!(error = %err, "failed to update note attachment after pane move"),
            }
        }
    }
    let value = serde_json::to_value(response.result)
        .map_err(|err| BridgeError::Protocol(err.to_string()))?;
    if should_prune_terminal_sessions {
        let prune_state = state.clone();
        tokio::task::spawn_blocking(move || prune_detached_terminal_sessions(&prune_state));
    }
    Ok(Json(value))
}

async fn launcher_presets_handler(
    State(state): State<BridgeState>,
) -> Result<Json<crate::launcher_presets::LauncherPresetsResponse>, BridgeError> {
    Ok(Json(state.launcher_presets.response()))
}

async fn launcher_preset_launch_handler(
    State(state): State<BridgeState>,
    body: Bytes,
) -> Result<Json<LauncherPresetLaunchResponse>, LauncherPresetError> {
    let body = parse_launcher_preset_launch_request(&body)?;
    let preset = state
        .launcher_presets
        .preset(&body.preset_id)
        .cloned()
        .ok_or_else(|| LauncherPresetError::not_found("launcher preset not found"))?;
    let title = resolve_launch_title(body.title.as_deref(), &preset.label)?;
    info!(
        preset_id = %preset.id,
        title = %title,
        target = body.target.kind(),
        "launching configured preset"
    );
    let api = state.api.clone();
    let response = tokio::task::spawn_blocking(move || {
        launch_preset_blocking(&api, &preset, &title, body.target)
    })
    .await
    .map_err(|err| LauncherPresetError::launch_failed(err.to_string()))??;
    Ok(Json(response))
}

fn parse_launcher_preset_launch_request(
    body: &[u8],
) -> Result<LauncherPresetLaunchRequest, LauncherPresetError> {
    serde_json::from_slice(body).map_err(|err| LauncherPresetError::invalid(err.to_string()))
}

fn resolve_launch_title(
    requested: Option<&str>,
    fallback: &str,
) -> Result<String, LauncherPresetError> {
    let title = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .trim()
        .to_string();
    if title.is_empty() || title.len() > MAX_LABEL_BYTES || title.contains('\0') {
        return Err(LauncherPresetError::invalid(
            "launch title must be non-empty, NUL-free, and up to 120 bytes",
        ));
    }
    Ok(title)
}

fn launch_preset_blocking(
    api: &ApiClient,
    preset: &ResolvedLauncherPreset,
    title: &str,
    target: LauncherPresetLaunchTarget,
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let mut api = HerdrLauncherApi(api);
    launch_preset_with(&mut api, preset, title, target)
}

trait LauncherApiRequest {
    fn request(&mut self, id: &str, method: Method) -> Result<ResponseResult, LauncherPresetError>;

    fn now(&self) -> std::time::Instant {
        std::time::Instant::now()
    }

    fn wait(&mut self, duration: Duration) {
        thread::sleep(duration);
    }
}

struct HerdrLauncherApi<'a>(&'a ApiClient);

impl LauncherApiRequest for HerdrLauncherApi<'_> {
    fn request(&mut self, id: &str, method: Method) -> Result<ResponseResult, LauncherPresetError> {
        api_request(self.0, id, method).map_err(|err| match err {
            BridgeError::Api(ApiClientError::ErrorResponse(response)) => {
                LauncherPresetError::from_herdr_error(response.error.code, response.error.message)
            }
            err => LauncherPresetError::launch_failed(err.to_string()),
        })
    }
}

fn launch_preset_with(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    target: LauncherPresetLaunchTarget,
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    match target {
        LauncherPresetLaunchTarget::Tab { workspace_id } => {
            if workspace_id.trim().is_empty() {
                return Err(LauncherPresetError::invalid("workspace_id is required"));
            }
            match &preset.launch {
                LauncherPresetLaunch::Shell => {
                    launch_builtin_shell_tab(api, preset, title, workspace_id)
                }
                LauncherPresetLaunch::ManagedAgent { kind, args } => {
                    launch_managed_agent_tab(api, preset, title, workspace_id, *kind, args)
                }
                LauncherPresetLaunch::CustomCommand(command) => {
                    launch_layout_tab(api, preset, title, workspace_id, command)
                }
            }
        }
        LauncherPresetLaunchTarget::Split {
            tab_id,
            target_pane_id,
            direction,
        } => {
            if tab_id.trim().is_empty() || target_pane_id.trim().is_empty() {
                return Err(LauncherPresetError::invalid(
                    "tab_id and target_pane_id are required",
                ));
            }
            match &preset.launch {
                LauncherPresetLaunch::Shell => {
                    launch_builtin_shell_split(api, preset, title, target_pane_id, direction)
                }
                LauncherPresetLaunch::ManagedAgent { kind, args } => launch_managed_agent_split(
                    api,
                    preset,
                    title,
                    target_pane_id,
                    direction,
                    *kind,
                    args,
                ),
                LauncherPresetLaunch::CustomCommand(command) => launch_layout_split(
                    api,
                    preset,
                    title,
                    tab_id,
                    target_pane_id,
                    direction,
                    command,
                ),
            }
        }
    }
}

impl LauncherPresetLaunchTarget {
    fn kind(&self) -> &'static str {
        match self {
            Self::Tab { .. } => "tab",
            Self::Split { .. } => "split",
        }
    }
}

fn launch_builtin_shell_tab(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    workspace_id: String,
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let result = api.request(
        "herdr-web:launcher:builtin-shell-tab",
        Method::TabCreate(TabCreateParams {
            workspace_id: Some(workspace_id),
            cwd: None,
            focus: true,
            label: None,
            env: HashMap::new(),
        }),
    )?;
    let ResponseResult::TabCreated { tab, root_pane } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for shell tab launch",
        ));
    };
    if let Err(error) = rename_launched_pane(api, &root_pane.pane_id, title) {
        rollback_created_tab(api, &tab.tab_id, &error);
        return Err(error);
    }
    Ok(LauncherPresetLaunchResponse {
        preset_id: preset.id.clone(),
        title: title.into(),
        workspace_id: tab.workspace_id,
        tab_id: tab.tab_id,
        pane_id: root_pane.pane_id,
    })
}

fn launch_builtin_shell_split(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    target_pane_id: String,
    direction: SplitDirection,
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let result = api.request(
        "herdr-web:launcher:builtin-shell-split",
        Method::PaneSplit(PaneSplitParams {
            workspace_id: None,
            target_pane_id: Some(target_pane_id),
            direction,
            ratio: None,
            cwd: None,
            focus: true,
            right_click: Default::default(),
            env: HashMap::new(),
        }),
    )?;
    let ResponseResult::PaneInfo { pane } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for shell split launch",
        ));
    };
    if let Err(error) = rename_launched_pane(api, &pane.pane_id, title) {
        rollback_created_pane(api, &pane.pane_id, &error);
        return Err(error);
    }
    Ok(LauncherPresetLaunchResponse {
        preset_id: preset.id.clone(),
        title: title.into(),
        workspace_id: pane.workspace_id,
        tab_id: pane.tab_id,
        pane_id: pane.pane_id,
    })
}

fn launch_managed_agent_tab(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    workspace_id: String,
    kind: ManagedAgentKind,
    args: &[String],
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let result = api.request(
        "herdr-web:launcher:managed-agent-tab",
        Method::TabCreate(TabCreateParams {
            workspace_id: Some(workspace_id),
            cwd: None,
            focus: true,
            label: None,
            env: HashMap::new(),
        }),
    )?;
    let ResponseResult::TabCreated { tab, root_pane } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for managed agent tab launch",
        ));
    };
    if let Err(error) = rename_launched_pane(api, &root_pane.pane_id, title) {
        rollback_created_tab(api, &tab.tab_id, &error);
        return Err(error);
    }
    if let Err(error) = start_managed_agent(api, &root_pane.pane_id, kind, args) {
        rollback_created_tab(api, &tab.tab_id, &error);
        return Err(error);
    }
    Ok(LauncherPresetLaunchResponse {
        preset_id: preset.id.clone(),
        title: title.into(),
        workspace_id: tab.workspace_id,
        tab_id: tab.tab_id,
        pane_id: root_pane.pane_id,
    })
}

fn launch_managed_agent_split(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    target_pane_id: String,
    direction: SplitDirection,
    kind: ManagedAgentKind,
    args: &[String],
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let result = api.request(
        "herdr-web:launcher:managed-agent-split",
        Method::PaneSplit(PaneSplitParams {
            workspace_id: None,
            target_pane_id: Some(target_pane_id),
            direction,
            ratio: None,
            cwd: None,
            focus: true,
            right_click: Default::default(),
            env: HashMap::new(),
        }),
    )?;
    let ResponseResult::PaneInfo { pane } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for managed agent split launch",
        ));
    };
    if let Err(error) = rename_launched_pane(api, &pane.pane_id, title) {
        rollback_created_pane(api, &pane.pane_id, &error);
        return Err(error);
    }
    if let Err(error) = start_managed_agent(api, &pane.pane_id, kind, args) {
        rollback_created_pane(api, &pane.pane_id, &error);
        return Err(error);
    }
    Ok(LauncherPresetLaunchResponse {
        preset_id: preset.id.clone(),
        title: title.into(),
        workspace_id: pane.workspace_id,
        tab_id: pane.tab_id,
        pane_id: pane.pane_id,
    })
}

fn start_managed_agent(
    api: &mut impl LauncherApiRequest,
    pane_id: &str,
    kind: ManagedAgentKind,
    args: &[String],
) -> Result<(), LauncherPresetError> {
    let name = managed_agent_name(kind, pane_id);
    // Herdr v0.8 can acknowledge pane creation before its process detector sees the shell as the
    // pane's foreground job. The API exposes no shell-ready event or authoritative readiness flag,
    // so allow that shell to settle and retry only the transient `agent_pane_busy` response.
    let deadline = api.now() + MANAGED_AGENT_SHELL_READY_TIMEOUT;
    api.wait(MANAGED_AGENT_SHELL_SETTLE_DELAY);
    let mut retry_delay = MANAGED_AGENT_SHELL_RETRY_INITIAL_DELAY;
    let result = loop {
        match api.request(
            "herdr-web:launcher:start-managed-agent",
            Method::AgentStart(AgentStartParams {
                name: name.clone(),
                kind: kind.as_str().to_string(),
                pane_id: pane_id.to_string(),
                args: args.to_vec(),
                timeout_ms: None,
            }),
        ) {
            Ok(result) => break result,
            Err(error)
                if error.herdr_code.as_deref() == Some("agent_pane_busy")
                    && api.now() < deadline =>
            {
                let remaining = deadline.saturating_duration_since(api.now());
                api.wait(retry_delay.min(remaining));
                retry_delay = retry_delay.saturating_mul(3);
            }
            Err(error) => return Err(error),
        }
    };
    let ResponseResult::AgentStarted { agent, .. } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for managed agent launch",
        ));
    };
    let terminal_id = agent.terminal_id.clone();
    wait_for_managed_agent(api, &name, pane_id, kind, &terminal_id, agent)
}

fn wait_for_managed_agent(
    api: &mut impl LauncherApiRequest,
    name: &str,
    pane_id: &str,
    kind: ManagedAgentKind,
    terminal_id: &str,
    mut agent: AgentInfo,
) -> Result<(), LauncherPresetError> {
    let deadline = std::time::Instant::now() + MANAGED_AGENT_START_TIMEOUT;
    loop {
        match managed_agent_launch_state(&agent, name, kind, terminal_id) {
            Ok(true) => return Ok(()),
            Ok(false) => {}
            Err(error) => return Err(error),
        }
        if std::time::Instant::now() >= deadline {
            let _ = api.request(
                "herdr-web:launcher:managed-agent-timeout-reconcile",
                Method::AgentGet(AgentTarget {
                    target: name.to_string(),
                }),
            );
            return Err(LauncherPresetError::launch_failed(
                "timed out waiting for managed agent startup",
            ));
        }

        agent = match api.request(
            "herdr-web:launcher:managed-agent-ready",
            Method::AgentGet(AgentTarget {
                target: name.to_string(),
            }),
        ) {
            Ok(ResponseResult::AgentInfo { agent }) => agent,
            Ok(_) => {
                return Err(LauncherPresetError::launch_failed(
                    "unexpected response while waiting for managed agent startup",
                ));
            }
            Err(_) => match api.request(
                "herdr-web:launcher:managed-agent-ready-by-pane",
                Method::AgentGet(AgentTarget {
                    target: pane_id.to_string(),
                }),
            ) {
                Ok(ResponseResult::AgentInfo { agent }) => agent,
                Ok(_) => {
                    return Err(LauncherPresetError::launch_failed(
                        "unexpected response while resolving managed agent pane",
                    ));
                }
                Err(_) => {
                    thread::sleep(MANAGED_AGENT_POLL_INTERVAL);
                    continue;
                }
            },
        };
        if !agent.interactive_ready && agent.launch_pending {
            thread::sleep(MANAGED_AGENT_POLL_INTERVAL);
        }
    }
}

fn managed_agent_launch_state(
    agent: &AgentInfo,
    name: &str,
    kind: ManagedAgentKind,
    terminal_id: &str,
) -> Result<bool, LauncherPresetError> {
    if agent.terminal_id != terminal_id {
        return Err(LauncherPresetError::launch_failed(format!(
            "managed agent {name} no longer owns the target terminal"
        )));
    }
    if agent.name.as_deref() != Some(name) {
        return Err(LauncherPresetError::launch_failed(format!(
            "managed agent was not found under the expected name {name}"
        )));
    }
    if agent
        .agent
        .as_deref()
        .is_some_and(|actual| actual != kind.as_str())
    {
        return Err(LauncherPresetError::launch_failed(format!(
            "managed agent kind mismatch: expected {}, detected {}",
            kind.as_str(),
            agent.agent.as_deref().unwrap_or_default()
        )));
    }
    if agent.interactive_ready {
        return Ok(true);
    }
    if !agent.launch_pending {
        return Err(LauncherPresetError::launch_failed(
            "managed agent process exited before becoming interactive",
        ));
    }
    Ok(false)
}

fn managed_agent_name(kind: ManagedAgentKind, pane_id: &str) -> String {
    let hash = pane_id.bytes().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    });
    format!("web-{}-{hash:016x}", kind.as_str())
}

fn launch_layout_tab(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    workspace_id: String,
    layout_preset: &CustomCommandPreset,
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let result = api.request(
        "herdr-web:launcher:layout-tab",
        Method::LayoutApply(LayoutApplyParams {
            workspace_id: Some(workspace_id),
            tab_id: None,
            tab_label: Some(title.into()),
            focus: true,
            root: layout_leaf_for_preset(layout_preset, title),
        }),
    )?;
    let ResponseResult::LayoutApply { layout } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for layout tab launch",
        ));
    };
    Ok(LauncherPresetLaunchResponse {
        preset_id: preset.id.clone(),
        title: title.into(),
        workspace_id: layout.workspace_id,
        tab_id: layout.tab_id,
        pane_id: layout.focused_pane_id,
    })
}

fn launch_layout_split(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    tab_id: String,
    target_pane_id: String,
    direction: SplitDirection,
    layout_preset: &CustomCommandPreset,
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let exported = api.request(
        "herdr-web:launcher:layout-export",
        Method::LayoutExport(LayoutExportParams {
            tab_id: Some(tab_id.clone()),
            pane_id: None,
        }),
    )?;
    let ResponseResult::LayoutExport { layout } = exported else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for layout export",
        ));
    };
    if !layout_contains_pane(&layout.root, &target_pane_id) {
        return Err(LauncherPresetError::layout_changed(
            "target pane is no longer present in the tab layout",
        ));
    }
    let original_root = layout.root.clone();
    let before_panes = layout_pane_ids(&original_root);
    let root = split_layout_with_command_preset(
        layout.root,
        &target_pane_id,
        direction,
        layout_preset,
        title,
    )
    .map_err(|_| LauncherPresetError::layout_changed("target pane changed before launch"))?;
    let latest = api.request(
        "herdr-web:launcher:layout-export-check",
        Method::LayoutExport(LayoutExportParams {
            tab_id: Some(tab_id.clone()),
            pane_id: None,
        }),
    )?;
    let ResponseResult::LayoutExport { layout: latest } = latest else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for layout export check",
        ));
    };
    if latest.root != original_root {
        return Err(LauncherPresetError::layout_changed(
            "tab layout changed before launch",
        ));
    }
    let result = api.request(
        "herdr-web:launcher:layout-split",
        Method::LayoutApply(LayoutApplyParams {
            workspace_id: None,
            tab_id: Some(tab_id),
            tab_label: None,
            focus: true,
            root,
        }),
    )?;
    let ResponseResult::LayoutApply { layout } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for layout split launch",
        ));
    };
    let pane_id = layout_pane_ids(&layout.root)
        .into_iter()
        .find(|pane_id| !before_panes.contains(pane_id))
        .unwrap_or_else(|| layout.focused_pane_id.clone());
    Ok(LauncherPresetLaunchResponse {
        preset_id: preset.id.clone(),
        title: title.into(),
        workspace_id: layout.workspace_id,
        tab_id: layout.tab_id,
        pane_id,
    })
}

fn rename_launched_pane(
    api: &mut impl LauncherApiRequest,
    pane_id: &str,
    title: &str,
) -> Result<(), LauncherPresetError> {
    api.request(
        "herdr-web:launcher:rename-pane",
        Method::PaneRename(herdr_compat::api::schema::PaneRenameParams {
            pane_id: pane_id.into(),
            label: Some(title.into()),
        }),
    )?;
    Ok(())
}

fn rollback_created_tab(
    api: &mut impl LauncherApiRequest,
    tab_id: &str,
    original_error: &LauncherPresetError,
) {
    if let Err(cleanup_error) = api.request(
        "herdr-web:launcher:rollback-tab",
        Method::TabClose(TabTarget {
            tab_id: tab_id.to_string(),
        }),
    ) {
        warn!(
            tab_id,
            original_error = %original_error.message,
            cleanup_error = %cleanup_error.message,
            "failed to roll back launcher-created tab"
        );
    }
}

fn rollback_created_pane(
    api: &mut impl LauncherApiRequest,
    pane_id: &str,
    original_error: &LauncherPresetError,
) {
    if let Err(cleanup_error) = api.request(
        "herdr-web:launcher:rollback-pane",
        Method::PaneClose(PaneTarget {
            pane_id: pane_id.to_string(),
        }),
    ) {
        warn!(
            pane_id,
            original_error = %original_error.message,
            cleanup_error = %cleanup_error.message,
            "failed to roll back launcher-created pane"
        );
    }
}

fn layout_contains_pane(root: &herdr_compat::api::schema::LayoutNode, pane_id: &str) -> bool {
    match root {
        herdr_compat::api::schema::LayoutNode::Pane { pane } => {
            pane.pane_id.as_deref() == Some(pane_id)
        }
        herdr_compat::api::schema::LayoutNode::Split { first, second, .. } => {
            layout_contains_pane(first, pane_id) || layout_contains_pane(second, pane_id)
        }
    }
}

fn layout_pane_ids(root: &herdr_compat::api::schema::LayoutNode) -> HashSet<String> {
    let mut ids = HashSet::new();
    collect_layout_pane_ids(root, &mut ids);
    ids
}

fn collect_layout_pane_ids(
    root: &herdr_compat::api::schema::LayoutNode,
    ids: &mut HashSet<String>,
) {
    match root {
        herdr_compat::api::schema::LayoutNode::Pane { pane } => {
            if let Some(pane_id) = &pane.pane_id {
                ids.insert(pane_id.clone());
            }
        }
        herdr_compat::api::schema::LayoutNode::Split { first, second, .. } => {
            collect_layout_pane_ids(first, ids);
            collect_layout_pane_ids(second, ids);
        }
    }
}

fn command_may_close_terminal_session(method: &Method) -> bool {
    matches!(
        method,
        Method::WorkspaceClose(_)
            | Method::TabClose(_)
            | Method::PaneClose(_)
            | Method::PaneMove(_)
    )
}

fn fill_clear_rename_labels(api: &ApiClient, method: &mut Method) -> Result<(), BridgeError> {
    fill_clear_rename_labels_with(
        method,
        |workspace_id| default_workspace_label(api, workspace_id),
        |tab_id| default_tab_label(api, tab_id),
    )
}

fn fill_clear_rename_labels_with(
    method: &mut Method,
    mut workspace_default: impl FnMut(&str) -> Result<String, BridgeError>,
    mut tab_default: impl FnMut(&str) -> Result<String, BridgeError>,
) -> Result<(), BridgeError> {
    match method {
        Method::WorkspaceRename(params) if params.label.is_none() => {
            params.label = Some(workspace_default(&params.workspace_id)?);
        }
        Method::TabRename(params) if params.label.is_none() => {
            params.label = Some(tab_default(&params.tab_id)?);
        }
        _ => {}
    }
    Ok(())
}

fn default_tab_label(api: &ApiClient, tab_id: &str) -> Result<String, BridgeError> {
    match api_request(
        api,
        "herdr-web:clear-tab-label",
        Method::TabList(TabListParams::default()),
    )? {
        ResponseResult::TabList { tabs } => default_tab_label_from_tabs(tab_id, tabs.iter()),
        other => Err(BridgeError::Protocol(format!(
            "unexpected response: {other:?}"
        ))),
    }
}

fn default_tab_label_from_tabs<'a>(
    tab_id: &str,
    mut tabs: impl Iterator<Item = &'a TabInfo>,
) -> Result<String, BridgeError> {
    tabs.find(|tab| tab.tab_id == tab_id)
        .map(|tab| tab.number.to_string())
        .ok_or_else(|| BridgeError::BadRequest(format!("tab not found: {tab_id}")))
}

fn default_workspace_label(api: &ApiClient, workspace_id: &str) -> Result<String, BridgeError> {
    Ok(default_workspace_label_from_panes(
        workspace_id,
        current_panes(api)?.iter(),
    ))
}

fn default_workspace_label_from_panes<'a>(
    workspace_id: &str,
    panes: impl Iterator<Item = &'a PaneInfo>,
) -> String {
    panes
        .filter(|pane| pane.workspace_id == workspace_id)
        .filter_map(|pane| pane.foreground_cwd.as_ref().or(pane.cwd.as_ref()))
        .min()
        .map(|cwd| crate::workspace::derive_label_from_cwd(Path::new(cwd)))
        .filter(|label| !label.trim().is_empty())
        .unwrap_or_else(|| "workspace".to_string())
}

async fn selection_handler(
    State(state): State<BridgeState>,
    Json(body): Json<SelectionRequest>,
) -> Result<Json<serde_json::Value>, BridgeError> {
    let pane_id = body.pane_id.trim();
    if pane_id.is_empty() {
        return Err(BridgeError::BadRequest("missing pane_id".to_string()));
    }
    let api = state.api.clone();
    let panes = tokio::task::spawn_blocking(move || current_panes(&api))
        .await
        .map_err(|err| BridgeError::Protocol(err.to_string()))??;
    if !panes.iter().any(|pane| pane.pane_id == pane_id) {
        return Err(BridgeError::Protocol(format!("pane not found: {pane_id}")));
    }
    {
        let mut selected = state
            .selected_pane_id
            .lock()
            .map_err(|_| BridgeError::Protocol("selection lock poisoned".to_string()))?;
        *selected = Some(pane_id.to_string());
    }
    let _ = state.ui_event_tx.send(
        serde_json::json!({
            "type": "herdr_web.selection_changed",
            "pane_id": pane_id,
        })
        .to_string(),
    );
    Ok(Json(serde_json::json!({ "selected_pane_id": pane_id })))
}

async fn upload_handler(
    State(state): State<BridgeState>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<UploadResponse>, UploadError> {
    if body.len() > MAX_UPLOAD_BYTES {
        return Err(UploadError::TooLarge);
    }

    let mime = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    debug!(
        bytes = body.len(),
        mime = ?mime,
        overwrite = query.overwrite,
        "Herdr World bridge upload request"
    );
    let name = match query.name.as_deref().and_then(sanitize_upload_file_name) {
        Some(name) => name,
        None => generated_upload_name(mime.as_deref()),
    };
    let destination = state.upload_dir.join(&name);
    if !is_direct_child(&state.upload_dir, &destination) {
        return Err(UploadError::BadRequest("invalid file name".to_string()));
    }

    tokio::fs::create_dir_all(&state.upload_dir).await?;
    let existing = tokio::fs::symlink_metadata(&destination).await.ok();
    if let Some(existing) = existing {
        if !query.overwrite {
            info!(
                name = %name,
                "Herdr World bridge upload conflict"
            );
            return Err(UploadError::Conflict {
                name,
                path: destination.display().to_string(),
            });
        }
        if existing.file_type().is_symlink() || existing.is_dir() {
            return Err(UploadError::BadRequest(
                "refusing to overwrite non-file path".to_string(),
            ));
        }
    }

    if !query.overwrite {
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .await
        {
            Ok(mut file) => {
                tokio::io::AsyncWriteExt::write_all(&mut file, &body).await?;
                tokio::io::AsyncWriteExt::flush(&mut file).await?;
            }
            Err(err) if err.kind() == ErrorKind::AlreadyExists => {
                return Err(UploadError::Conflict {
                    name,
                    path: destination.display().to_string(),
                });
            }
            Err(err) => return Err(UploadError::Io(err)),
        }
    } else {
        let temp_path = state.upload_dir.join(format!(
            ".herdr-web-upload-{}-{}.tmp",
            std::process::id(),
            UPLOAD_TEMP_COUNTER.fetch_add(1, Ordering::AcqRel)
        ));
        tokio::fs::write(&temp_path, &body).await?;
        if destination.exists() {
            tokio::fs::remove_file(&destination).await?;
        }
        match tokio::fs::rename(&temp_path, &destination).await {
            Ok(()) => {}
            Err(err) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Err(UploadError::Io(err));
            }
        }
    }

    let response = UploadResponse {
        file: UploadEntry {
            name,
            path: destination.display().to_string(),
            size: body.len(),
            mime,
        },
    };
    info!(bytes = body.len(), "Herdr World bridge upload saved");
    Ok(Json(response))
}

async fn snapshot_handler(State(state): State<BridgeState>) -> Result<Json<Snapshot>, BridgeError> {
    let api_state = state.clone();
    let session_snapshot = tokio::task::spawn_blocking(move || {
        match api_request(
            &api_state.api,
            "herdr-web:session-snapshot",
            Method::SessionSnapshot(EmptyParams::default()),
        )? {
            ResponseResult::SessionSnapshot { snapshot } => Ok(*snapshot),
            other => Err(BridgeError::Protocol(format!(
                "unexpected response: {other:?}"
            ))),
        }
    })
    .await
    .map_err(|err| BridgeError::Protocol(err.to_string()))??;
    observe_agent_activity_snapshot(&state, &session_snapshot.panes);
    let notes = state.notes.clone();
    let note_panes = session_snapshot.panes.clone();
    match tokio::task::spawn_blocking(move || notes.observe_panes(&note_panes))
        .await
        .map_err(|err| BridgeError::Protocol(err.to_string()))?
    {
        Ok(true) => broadcast_notes_changed(&state, None, None),
        Ok(false) => {}
        Err(err) => warn!(error = %err, "failed to update pane note observations"),
    }
    let selected_pane_id = shared_selected_pane(&state, &session_snapshot.panes)?;

    Ok(Json(web_snapshot_from_session_snapshot(
        session_snapshot,
        selected_pane_id,
    )))
}

fn web_snapshot_from_session_snapshot(
    snapshot: SessionSnapshot,
    selected_pane_id: Option<String>,
) -> Snapshot {
    let SessionSnapshot {
        focused_pane_id,
        workspaces,
        tabs,
        panes,
        layouts,
        ..
    } = snapshot;
    let selected_pane_id = selected_pane_id
        .filter(|pane_id| panes.iter().any(|pane| pane.pane_id == pane_id.as_str()))
        .or_else(|| {
            focused_pane_id
                .filter(|pane_id| panes.iter().any(|pane| pane.pane_id == pane_id.as_str()))
        });
    let workspaces = workspaces
        .into_iter()
        .map(|workspace| {
            let can_clear_name = workspace.label
                != default_workspace_label_from_panes(&workspace.workspace_id, panes.iter());
            SnapshotWorkspaceInfo {
                info: workspace,
                can_clear_name,
            }
        })
        .collect();
    let tabs = tabs
        .into_iter()
        .map(|tab| {
            let can_clear_name = !is_default_tab_label(&tab.label);
            SnapshotTabInfo {
                info: tab,
                can_clear_name,
            }
        })
        .collect();

    let panes = panes
        .into_iter()
        .map(|pane| SnapshotPaneInfo {
            task_summary: crate::task_summary::task_summary_from_pane(&pane),
            info: pane,
        })
        .collect();

    Snapshot {
        workspaces,
        tabs,
        panes,
        layouts,
        selected_pane_id,
    }
}

fn is_default_tab_label(label: &str) -> bool {
    let label = label.trim();
    !label.is_empty() && label.chars().all(|ch| ch.is_ascii_digit())
}

async fn capabilities_handler(
    State(state): State<BridgeState>,
) -> Result<Json<Capabilities>, BridgeError> {
    let observability = state
        .observability
        .descriptor()
        .map_err(|err| BridgeError::Protocol(err.to_string()))?;
    Ok(Json(Capabilities {
        bridge_api_version: BRIDGE_API_VERSION,
        bridge_version: env!("CARGO_PKG_VERSION"),
        herdr_version: state.herdr_version.clone(),
        terminal_protocol: state.terminal_protocol,
        configured_label: state.configured_label.clone(),
        features: CAPABILITY_FEATURES,
        commands: ALLOWED_COMMANDS,
        web_compat: WEB_COMPAT_VERSION,
        authentication: AuthenticationCapability {
            required: state.auth.required(),
            session: "bearer",
            local_peer_bypass: true,
        },
        agent_activity: AgentActivityCapability { version: 1 },
        agent_pins: AgentPinsCapability { version: 1 },
        launcher_presets: LauncherPresetsCapability { version: 1 },
        notes: NotesCapability { version: 1 },
        observability: ObservabilityCapability {
            version: crate::observability::OBSERVABILITY_BRIDGE_CAPABILITY_VERSION,
            contract_version: observability.contract_version,
            health: observability.health,
        },
    }))
}

async fn agent_activity_list_handler(
    State(state): State<BridgeState>,
) -> Result<Json<AgentActivityListResponse>, BridgeError> {
    let list_state = state.clone();
    let response = tokio::task::spawn_blocking(move || {
        let panes = current_panes(&list_state.api)?;
        observe_agent_activity_snapshot(&list_state, &panes);
        Ok::<_, BridgeError>(list_state.agent_activity.list(&panes))
    })
    .await
    .map_err(|err| BridgeError::Protocol(err.to_string()))??;
    Ok(Json(response))
}

async fn agent_pins_list_handler(
    State(state): State<BridgeState>,
) -> Result<Json<AgentPinsListResponse>, BridgeError> {
    Ok(Json(
        run_store_task(state, move |state| {
            let panes = current_panes(&state.api)?;
            Ok(state.agent_pins.list(&panes)?)
        })
        .await?,
    ))
}

async fn agent_pins_pin_handler(
    State(state): State<BridgeState>,
    AxumPath(pane_id): AxumPath<String>,
) -> Result<Json<AgentPinsListResponse>, BridgeError> {
    let event_pane_id = pane_id.clone();
    let response = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.agent_pins.pin(&pane_id, &panes)?)
    })
    .await?;
    broadcast_agent_pins_changed(&state, Some(&event_pane_id));
    Ok(Json(response))
}

async fn agent_pins_unpin_handler(
    State(state): State<BridgeState>,
    AxumPath(pane_id): AxumPath<String>,
) -> Result<Json<AgentPinsListResponse>, BridgeError> {
    let event_pane_id = pane_id.clone();
    let response = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.agent_pins.unpin(&pane_id, &panes)?)
    })
    .await?;
    broadcast_agent_pins_changed(&state, Some(&event_pane_id));
    Ok(Json(response))
}

async fn notes_list_handler(
    State(state): State<BridgeState>,
    Query(query): Query<NotesListQuery>,
) -> Result<Json<NotesListResponse>, BridgeError> {
    Ok(Json(
        run_store_task(state, move |state| {
            let panes = current_panes(&state.api)?;
            Ok(state.notes.list(query, &panes)?)
        })
        .await?,
    ))
}

async fn notes_create_handler(
    State(state): State<BridgeState>,
    Json(body): Json<CreateNoteRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.create(body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn notes_update_handler(
    State(state): State<BridgeState>,
    AxumPath(note_id): AxumPath<String>,
    Json(body): Json<UpdateNoteRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.update(&note_id, body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn notes_attach_handler(
    State(state): State<BridgeState>,
    AxumPath(note_id): AxumPath<String>,
    Json(body): Json<AttachNoteRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.attach(&note_id, body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn notes_detach_handler(
    State(state): State<BridgeState>,
    AxumPath(note_id): AxumPath<String>,
    Json(body): Json<RevisionRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.detach(&note_id, body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn notes_archive_handler(
    State(state): State<BridgeState>,
    AxumPath(note_id): AxumPath<String>,
    Json(body): Json<RevisionRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.archive(&note_id, body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn notes_restore_handler(
    State(state): State<BridgeState>,
    AxumPath(note_id): AxumPath<String>,
    Json(body): Json<RevisionRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.restore(&note_id, body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn notes_delete_handler(
    State(state): State<BridgeState>,
    AxumPath(note_id): AxumPath<String>,
    Json(body): Json<RevisionRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.delete(&note_id, body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn run_store_task<T, F>(state: BridgeState, task: F) -> Result<T, BridgeError>
where
    T: Send + 'static,
    F: FnOnce(BridgeState) -> Result<T, BridgeError> + Send + 'static,
{
    tokio::task::spawn_blocking(move || task(state))
        .await
        .map_err(|err| BridgeError::Protocol(err.to_string()))?
}

fn broadcast_agent_pins_changed(state: &BridgeState, pane_id: Option<&str>) {
    let mut payload = serde_json::json!({
        "type": "herdr_web.agent_pins_changed",
    });
    if let Some(pane_id) = pane_id {
        payload["pane_id"] = serde_json::json!(pane_id);
    }
    let _ = state.ui_event_tx.send(payload.to_string());
}

fn broadcast_agent_activity_changed(state: &BridgeState) {
    let payload = serde_json::json!({
        "type": "herdr_web.agent_activity_changed",
    });
    let _ = state.ui_event_tx.send(payload.to_string());
}

fn broadcast_notes_changed(state: &BridgeState, note_id: Option<&str>, revision: Option<u64>) {
    let mut payload = serde_json::json!({
        "type": "herdr_web.notes_changed",
    });
    if let Some(note_id) = note_id {
        payload["note_id"] = serde_json::json!(note_id);
    }
    if let Some(revision) = revision {
        payload["revision"] = serde_json::json!(revision);
    }
    let _ = state.ui_event_tx.send(payload.to_string());
}

fn observe_agent_activity_snapshot(state: &BridgeState, panes: &[PaneInfo]) {
    if state.agent_activity.observe_snapshot(panes) {
        broadcast_agent_activity_changed(state);
    }
}

fn current_panes(api: &ApiClient) -> Result<Vec<PaneInfo>, BridgeError> {
    match api_request(
        api,
        "herdr-web:pane-list",
        Method::PaneList(PaneListParams::default()),
    )? {
        ResponseResult::PaneList { panes } => Ok(panes),
        other => Err(BridgeError::Protocol(format!(
            "unexpected response: {other:?}"
        ))),
    }
}

fn shared_selected_pane(
    state: &BridgeState,
    panes: &[PaneInfo],
) -> Result<Option<String>, BridgeError> {
    let mut selected = state
        .selected_pane_id
        .lock()
        .map_err(|_| BridgeError::Protocol("selection lock poisoned".to_string()))?;
    if selected
        .as_ref()
        .is_some_and(|pane_id| panes.iter().any(|pane| pane.pane_id == pane_id.as_str()))
    {
        return Ok(selected.clone());
    }
    *selected = None;
    Ok(None)
}

fn api_request(api: &ApiClient, id: &str, method: Method) -> Result<ResponseResult, BridgeError> {
    Ok(api
        .request(Request {
            id: id.to_string(),
            method,
        })?
        .result)
}

async fn terminal_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<BridgeState>,
    Query(query): Query<TerminalQuery>,
    headers: HeaderMap,
) -> Response {
    configure_websocket_protocol(ws, &headers)
        .on_upgrade(move |socket| handle_terminal_socket(socket, state, query))
        .into_response()
}

async fn events_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<BridgeState>,
    headers: HeaderMap,
) -> Response {
    configure_websocket_protocol(ws, &headers)
        .on_upgrade(move |socket| handle_events_socket(socket, state))
        .into_response()
}

async fn activity_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<BridgeState>,
    headers: HeaderMap,
) -> Response {
    configure_websocket_protocol(ws, &headers)
        .on_upgrade(move |socket| handle_activity_socket(socket, state))
        .into_response()
}

async fn ui_events_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<BridgeState>,
    headers: HeaderMap,
) -> Response {
    configure_websocket_protocol(ws, &headers)
        .on_upgrade(move |socket| handle_ui_events_socket(socket, state))
        .into_response()
}

async fn handle_events_socket(socket: WebSocket, state: BridgeState) {
    let api = state.api.clone();
    let mut ui_event_rx = state.ui_event_tx.subscribe();
    let subscribed = tokio::task::spawn_blocking(move || open_event_subscription(api)).await;
    let Ok(Ok(mut event_rx)) = subscribed else {
        return;
    };

    let (mut ws_sender, mut ws_receiver) = socket.split();
    loop {
        tokio::select! {
            Some(event) = event_rx.recv() => {
                if event_may_close_terminal_session(&event) {
                    let prune_state = state.clone();
                    tokio::task::spawn_blocking(move || prune_detached_terminal_sessions(&prune_state));
                }
                if ws_sender.send(Message::Text(event.into())).await.is_err() {
                    break;
                }
            }
            event = ui_event_rx.recv() => {
                match event {
                    Ok(event) => {
                        if ws_sender.send(Message::Text(event.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            Some(message) = ws_receiver.next() => {
                match message {
                    Ok(Message::Close(_)) | Err(_) => break,
                    Ok(Message::Text(_))
                    | Ok(Message::Binary(_))
                    | Ok(Message::Ping(_))
                    | Ok(Message::Pong(_)) => {}
                }
            }
            else => break,
        }
    }
}

async fn handle_activity_socket(socket: WebSocket, state: BridgeState) {
    let mut activity_rx = state.activity_tx.subscribe();
    let (mut ws_sender, mut ws_receiver) = socket.split();
    loop {
        tokio::select! {
            event = activity_rx.recv() => {
                match event {
                    Ok(event) => {
                        if send_activity_message(&mut ws_sender, &event).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let event = ActivityMessage::ResyncRequired {
                            reason: "activity receiver lagged".to_string(),
                        };
                        let _ = send_activity_message(&mut ws_sender, &event).await;
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            Some(message) = ws_receiver.next() => {
                match message {
                    Ok(Message::Close(_)) | Err(_) => break,
                    Ok(Message::Text(_))
                    | Ok(Message::Binary(_))
                    | Ok(Message::Ping(_))
                    | Ok(Message::Pong(_)) => {}
                }
            }
            else => break,
        }
    }
}

async fn send_activity_message(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    event: &ActivityMessage,
) -> Result<(), axum::Error> {
    let text = serde_json::to_string(event).unwrap_or_else(|_| {
        r#"{"type":"resync_required","reason":"activity serialization failed"}"#.to_string()
    });
    ws_sender.send(Message::Text(text.into())).await
}

async fn handle_ui_events_socket(socket: WebSocket, state: BridgeState) {
    let mut ui_event_rx = state.ui_event_tx.subscribe();
    let (mut ws_sender, mut ws_receiver) = socket.split();
    loop {
        tokio::select! {
            event = ui_event_rx.recv() => {
                match event {
                    Ok(event) => {
                        if ws_sender.send(Message::Text(event.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            Some(message) = ws_receiver.next() => {
                match message {
                    Ok(Message::Close(_)) | Err(_) => break,
                    Ok(Message::Text(_))
                    | Ok(Message::Binary(_))
                    | Ok(Message::Ping(_))
                    | Ok(Message::Pong(_)) => {}
                }
            }
            else => break,
        }
    }
}

async fn handle_terminal_socket(socket: WebSocket, state: BridgeState, query: TerminalQuery) {
    if query.terminal_id.trim().is_empty() {
        return;
    }

    let terminal_id = query.terminal_id.clone();
    let cols = query.cols.unwrap_or(DEFAULT_COLS);
    let rows = query.rows.unwrap_or(DEFAULT_ROWS);
    let coalesce_window = terminal_output_coalesce_window(query.coalesce_ms);
    let output_encoding = query
        .output_encoding
        .unwrap_or(TerminalOutputWireEncoding::Identity);
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let session = match acquire_terminal_session(
        state.clone(),
        terminal_id.clone(),
        cols,
        rows,
        query.takeover,
    )
    .await
    {
        Ok(session) => session,
        Err(err) => {
            let _ = ws_sender
                .send(Message::Text(close_message(&err.to_string()).into()))
                .await;
            return;
        }
    };

    if query.probe {
        let _ = ws_sender
            .send(Message::Text(TERMINAL_ATTACH_READY.into()))
            .await;
        release_terminal_session(&state.terminal_sessions, &terminal_id, &session);
        return;
    }

    let write_tx = session.write_tx.clone();
    let mut terminal_rx = session.output_tx.subscribe();
    if output_encoding == TerminalOutputWireEncoding::Gzip {
        let ack = Message::Text(TERMINAL_OUTPUT_GZIP_ACKNOWLEDGEMENT.into());
        if ws_sender.send(ack).await.is_err() {
            release_terminal_session(&state.terminal_sessions, &terminal_id, &session);
            return;
        }
    }

    let mut output_coalescer = TerminalOutputCoalescer::new(coalesce_window);
    let _ = write_tx.send(ClientMessage::Resize {
        cols,
        rows,
        cell_width_px: 0,
        cell_height_px: 0,
    });

    loop {
        if let Some(deadline) = output_coalescer.deadline() {
            tokio::select! {
                biased;
                _ = tokio::time::sleep_until(deadline) => {
                    if !handle_terminal_output_deadline(
                        &mut ws_sender,
                        &mut output_coalescer,
                        output_encoding,
                    )
                    .await
                    {
                        break;
                    }
                }
                Some(message) = ws_receiver.next() => {
                    if !handle_terminal_client_message(&write_tx, message) {
                        break;
                    }
                }
                output = terminal_rx.recv() => {
                    if !handle_terminal_output_message(
                        output,
                        &mut ws_sender,
                        &mut output_coalescer,
                        output_encoding,
                    )
                    .await
                    {
                        break;
                    }
                }
                else => break,
            }
        } else {
            tokio::select! {
                output = terminal_rx.recv() => {
                    if !handle_terminal_output_message(
                        output,
                        &mut ws_sender,
                        &mut output_coalescer,
                        output_encoding,
                    )
                    .await
                    {
                        break;
                    }
                }
                Some(message) = ws_receiver.next() => {
                    if !handle_terminal_client_message(&write_tx, message) {
                        break;
                    }
                }
                else => break,
            }
        }
    }

    release_terminal_session(&state.terminal_sessions, &terminal_id, &session);
}

async fn handle_terminal_output_deadline(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    output_coalescer: &mut TerminalOutputCoalescer,
    output_encoding: TerminalOutputWireEncoding,
) -> bool {
    let Some(reason) = output_coalescer.handle_deadline() else {
        return true;
    };
    let Some(bytes) = output_coalescer.flush_pending(reason, Instant::now()) else {
        return true;
    };
    send_terminal_output_frame(ws_sender, bytes, output_encoding).await
}

async fn send_terminal_output_frame(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    bytes: Bytes,
    output_encoding: TerminalOutputWireEncoding,
) -> bool {
    ws_sender
        .send(Message::Binary(encode_terminal_output_frame(
            bytes,
            output_encoding,
        )))
        .await
        .is_ok()
}

async fn handle_terminal_output_message(
    output: Result<TerminalOutput, tokio::sync::broadcast::error::RecvError>,
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    output_coalescer: &mut TerminalOutputCoalescer,
    output_encoding: TerminalOutputWireEncoding,
) -> bool {
    match output {
        Ok(TerminalOutput::Bytes(bytes)) => {
            let decision = output_coalescer.push_bytes(bytes, Instant::now());
            match decision {
                TerminalOutputCoalescingDecision::SendNow(bytes) => {
                    if !send_terminal_output_frame(ws_sender, bytes, output_encoding).await {
                        return false;
                    }
                }
                TerminalOutputCoalescingDecision::Pending => {}
                TerminalOutputCoalescingDecision::FlushPending(reason) => {
                    let Some(bytes) = output_coalescer.flush_pending(reason, Instant::now()) else {
                        return true;
                    };
                    if !send_terminal_output_frame(ws_sender, bytes, output_encoding).await {
                        return false;
                    }
                }
            }
            true
        }
        Ok(TerminalOutput::Close(reason)) => {
            if let Some(bytes) =
                output_coalescer.flush_pending(TerminalOutputFlushReason::Close, Instant::now())
            {
                if !send_terminal_output_frame(ws_sender, bytes, output_encoding).await {
                    return false;
                }
            }
            let _ = ws_sender
                .send(Message::Text(close_message(&reason).into()))
                .await;
            false
        }
        Err(tokio::sync::broadcast::error::RecvError::Lagged(frames)) => {
            // Dropped frames would silently corrupt the stateful ANSI stream.
            // Close the socket without a "closed" frame so the client
            // reconnects and gets a clean repaint from a fresh attach.
            output_coalescer.record_lagged(frames);
            warn!(frames, "terminal output lagged; closing socket for resync");
            false
        }
        Err(tokio::sync::broadcast::error::RecvError::Closed) => false,
    }
}

fn handle_terminal_client_message(
    write_tx: &TerminalWriter,
    message: Result<Message, axum::Error>,
) -> bool {
    match message {
        Ok(Message::Text(text)) => handle_terminal_text_frame(write_tx, text.as_str()).is_ok(),
        Ok(Message::Binary(bytes)) => send_terminal_input_chunks(write_tx, &bytes).is_ok(),
        Ok(Message::Close(_)) => false,
        Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => true,
        Err(_) => false,
    }
}

async fn acquire_terminal_session(
    state: BridgeState,
    terminal_id: String,
    cols: u16,
    rows: u16,
    takeover: bool,
) -> Result<SharedTerminalSession, BridgeError> {
    tokio::task::spawn_blocking(move || {
        // What to do after inspecting the maps under one lock hold.
        enum AttachStep {
            WaitDrain(Arc<ConnectionClosed>),
            WaitGate(Arc<ConnectionClosed>),
            Handshake(Arc<ConnectionClosed>),
        }

        let mut drain_waits = 0;
        let mut gate_waits = 0;
        let mut handshake_retries = 0;
        'attach: loop {
            // All maps can change while this thread waits without the lock, so
            // every wait loops back here: a session attached meanwhile must be
            // joined, another thread's in-flight handshake must be awaited
            // (two concurrent fresh attaches make the daemon reject one — it
            // races whichever the map keeps), and a draining connection must
            // finish tearing down before a fresh attach, or the daemon rejects
            // it as a second concurrent client.
            let step = {
                let mut sessions = state.terminal_sessions.lock().map_err(|_| {
                    BridgeError::Protocol("terminal session lock poisoned".to_string())
                })?;
                if let Some(session) = sessions.active.get(&terminal_id) {
                    session.client_count.fetch_add(1, Ordering::AcqRel);
                    return Ok(session.clone());
                }
                if let Some(gate) = sessions.attaching.get(&terminal_id) {
                    if gate_waits < MAX_TERMINAL_DETACH_DRAIN_WAITS {
                        AttachStep::WaitGate(gate.clone())
                    } else {
                        // Progress guard: handshake anyway, without claiming
                        // the gate another thread still holds.
                        warn!(
                            terminal_id = %terminal_id,
                            "attaching despite a stuck concurrent attach handshake"
                        );
                        AttachStep::Handshake(Arc::new(ConnectionClosed::default()))
                    }
                } else if let Some(draining) = sessions.draining.get(&terminal_id) {
                    if drain_waits < MAX_TERMINAL_DETACH_DRAIN_WAITS {
                        AttachStep::WaitDrain(draining.clone())
                    } else {
                        warn!(
                            terminal_id = %terminal_id,
                            "reattaching despite pending detach teardown after repeated drain waits"
                        );
                        let gate = Arc::new(ConnectionClosed::default());
                        sessions.attaching.insert(terminal_id.clone(), gate.clone());
                        AttachStep::Handshake(gate)
                    }
                } else {
                    let gate = Arc::new(ConnectionClosed::default());
                    sessions.attaching.insert(terminal_id.clone(), gate.clone());
                    AttachStep::Handshake(gate)
                }
            };

            let gate = match step {
                AttachStep::WaitGate(gate) => {
                    gate_waits += 1;
                    if !gate.wait_closed(TERMINAL_ATTACH_GATE_TIMEOUT) {
                        warn!(
                            terminal_id = %terminal_id,
                            "timed out waiting for a concurrent terminal attach handshake"
                        );
                    }
                    continue 'attach;
                }
                AttachStep::WaitDrain(draining) => {
                    drain_waits += 1;
                    if !draining.wait_closed(TERMINAL_DETACH_DRAIN_TIMEOUT) {
                        warn!(
                            terminal_id = %terminal_id,
                            "timed out waiting for detached terminal connection to close"
                        );
                    }
                    let mut sessions = state.terminal_sessions.lock().map_err(|_| {
                        BridgeError::Protocol("terminal session lock poisoned".to_string())
                    })?;
                    if sessions
                        .draining
                        .get(&terminal_id)
                        .is_some_and(|entry| Arc::ptr_eq(entry, &draining))
                    {
                        sessions.draining.remove(&terminal_id);
                    }
                    continue 'attach;
                }
                AttachStep::Handshake(gate) => gate,
            };

            // Perform the daemon handshake without holding the map lock so a
            // stalled daemon cannot wedge every other terminal client. The
            // gate keeps concurrent acquires for this terminal waiting; they
            // join the published session once it opens.
            let handshake = || -> Result<SharedTerminalSession, BridgeError> {
                let protocol_version = terminal_attach_protocol(&state.api)?;
                let (output_tx, _) = tokio::sync::broadcast::channel(256);
                let attach = open_terminal_attach(
                    state.client_socket_path.clone(),
                    terminal_id.clone(),
                    cols,
                    rows,
                    takeover,
                    protocol_version,
                    output_tx.clone(),
                )?;
                Ok(SharedTerminalSession {
                    write_tx: attach.write_tx,
                    output_tx,
                    client_count: Arc::new(AtomicUsize::new(0)),
                    connection_closed: attach.connection_closed,
                })
            };
            let session = match handshake() {
                Ok(session) => session,
                Err(err) => {
                    release_attach_gate(&state.terminal_sessions, &terminal_id, &gate);
                    return Err(err);
                }
            };

            let Ok(mut sessions) = state.terminal_sessions.lock() else {
                let _ = session.write_tx.send(ClientMessage::Detach);
                gate.mark_closed();
                return Err(BridgeError::Protocol(
                    "terminal session lock poisoned".to_string(),
                ));
            };
            if let Some(existing) = sessions.active.get(&terminal_id) {
                // Safety net: only reachable via the stuck-gate fallback.
                // Keep the established session and detach the redundant one.
                existing.client_count.fetch_add(1, Ordering::AcqRel);
                let existing = existing.clone();
                drop(sessions);
                let _ = session.write_tx.send(ClientMessage::Detach);
                release_attach_gate(&state.terminal_sessions, &terminal_id, &gate);
                return Ok(existing);
            }
            if sessions.draining.contains_key(&terminal_id) {
                // A connection attached and began detaching while we were
                // handshaking (only possible via the stuck-gate fallback), so
                // the daemon may have rejected our attach as a second
                // concurrent client. Never publish the possibly dead session:
                // retry, and once the retry budget is spent fail with a reason
                // the web client treats as retryable.
                drop(sessions);
                let _ = session.write_tx.send(ClientMessage::Detach);
                release_attach_gate(&state.terminal_sessions, &terminal_id, &gate);
                if handshake_retries < MAX_ATTACH_HANDSHAKE_RETRIES {
                    handshake_retries += 1;
                    continue 'attach;
                }
                warn!(
                    terminal_id = %terminal_id,
                    "giving up terminal attach amid sustained detach churn"
                );
                return Err(BridgeError::Protocol(
                    "terminal attach conflicted with a pending detach; retry shortly".to_string(),
                ));
            }
            session.client_count.fetch_add(1, Ordering::AcqRel);
            sessions.active.insert(terminal_id.clone(), session.clone());
            drop(sessions);
            release_attach_gate(&state.terminal_sessions, &terminal_id, &gate);
            return Ok(session);
        }
    })
    .await
    .map_err(|err| BridgeError::Protocol(err.to_string()))?
}

fn release_terminal_session(
    sessions: &Mutex<TerminalSessions>,
    terminal_id: &str,
    session: &SharedTerminalSession,
) {
    // Decrement while holding the map lock so a concurrent acquire cannot
    // join the session between the last-client check and its removal.
    let Ok(mut sessions) = sessions.lock() else {
        return;
    };
    if session.client_count.fetch_sub(1, Ordering::AcqRel) != 1 {
        return;
    }

    let _ = session.write_tx.send(ClientMessage::Detach);
    if sessions
        .active
        .get(terminal_id)
        .is_some_and(|current| Arc::ptr_eq(&current.client_count, &session.client_count))
    {
        sessions.active.remove(terminal_id);
        remember_draining_connection(&mut sessions, terminal_id, session);
    }
}

/// Releases a terminal's attach-handshake gate and wakes its waiters, who
/// re-check the maps and normally join the session the handshake published.
fn release_attach_gate(
    sessions: &Mutex<TerminalSessions>,
    terminal_id: &str,
    gate: &Arc<ConnectionClosed>,
) {
    if let Ok(mut sessions) = sessions.lock() {
        if sessions
            .attaching
            .get(terminal_id)
            .is_some_and(|entry| Arc::ptr_eq(entry, gate))
        {
            sessions.attaching.remove(terminal_id);
        }
    }
    gate.mark_closed();
}

/// Records a detached connection so a quick reattach waits for the daemon to
/// finish tearing it down instead of racing the queued `Detach`. Entries are
/// cleared by the next reattach or swept once closed during session pruning.
fn remember_draining_connection(
    sessions: &mut TerminalSessions,
    terminal_id: &str,
    session: &SharedTerminalSession,
) {
    if session.connection_closed.is_closed() {
        return;
    }
    sessions
        .draining
        .insert(terminal_id.to_string(), session.connection_closed.clone());
}

fn prune_detached_terminal_sessions(state: &BridgeState) {
    let Ok(panes) = current_panes(&state.api) else {
        warn!("failed to prune herdr web terminal sessions");
        return;
    };
    let active_terminal_ids = panes
        .iter()
        .map(|pane| pane.terminal_id.as_str())
        .collect::<HashSet<_>>();
    let stale_sessions = {
        let Ok(mut sessions) = state.terminal_sessions.lock() else {
            warn!("failed to lock herdr web terminal sessions for pruning");
            return;
        };
        sessions
            .draining
            .retain(|_, connection| !connection.is_closed());
        sessions
            .active
            .iter()
            .filter(|(terminal_id, _)| !active_terminal_ids.contains(terminal_id.as_str()))
            .map(|(terminal_id, session)| (terminal_id.clone(), session.clone()))
            .collect::<Vec<_>>()
    };

    for (terminal_id, session) in stale_sessions {
        close_terminal_session(
            &state.terminal_sessions,
            &terminal_id,
            &session,
            "terminal closed by Herdr",
        );
    }
}

fn close_terminal_session(
    sessions: &Mutex<TerminalSessions>,
    terminal_id: &str,
    session: &SharedTerminalSession,
    reason: &str,
) {
    let _ = session
        .output_tx
        .send(TerminalOutput::Close(reason.to_string()));
    let _ = session.write_tx.send(ClientMessage::Detach);
    let Ok(mut sessions) = sessions.lock() else {
        return;
    };
    if sessions
        .active
        .get(terminal_id)
        .is_some_and(|current| Arc::ptr_eq(&current.client_count, &session.client_count))
    {
        sessions.active.remove(terminal_id);
        remember_draining_connection(&mut sessions, terminal_id, session);
    }
}

fn event_may_close_terminal_session(event: &str) -> bool {
    event.contains("workspace.closed")
        || event.contains("tab.closed")
        || event.contains("pane.closed")
}

fn close_message(reason: &str) -> String {
    format!(
        r#"{{"type":"closed","reason":{}}}"#,
        serde_json::to_string(reason).unwrap_or_else(|_| "\"closed\"".into())
    )
}

fn spawn_agent_activity_watcher(state: BridgeState) {
    let (resubscribe_tx, resubscribe_rx) = mpsc::channel();
    let structural_state = state.clone();
    if let Err(err) = thread::Builder::new()
        .name("herdr-web-activity-structural".to_string())
        .spawn(move || agent_activity_structural_watcher_loop(structural_state, resubscribe_tx))
    {
        warn!(error = %err, "failed to start Herdr World activity structural watcher");
    }
    if let Err(err) = thread::Builder::new()
        .name("herdr-web-activity".to_string())
        .spawn(move || agent_activity_watcher_loop(state, resubscribe_rx))
    {
        warn!(error = %err, "failed to start Herdr World activity watcher");
    }
}

fn agent_activity_structural_watcher_loop(state: BridgeState, resubscribe_tx: mpsc::Sender<()>) {
    let mut backoff = ACTIVITY_WATCHER_INITIAL_BACKOFF;
    loop {
        match run_agent_activity_structural_subscription(&state, &resubscribe_tx) {
            Ok(()) => {
                backoff = ACTIVITY_WATCHER_INITIAL_BACKOFF;
            }
            Err(err) => {
                warn!(error = %err, "Herdr World activity structural watcher will retry");
                thread::sleep(backoff);
                backoff = (backoff * 2).min(ACTIVITY_WATCHER_MAX_BACKOFF);
            }
        }
    }
}

fn agent_activity_watcher_loop(state: BridgeState, resubscribe_rx: mpsc::Receiver<()>) {
    let mut backoff = ACTIVITY_WATCHER_INITIAL_BACKOFF;
    loop {
        match run_agent_activity_subscription(&state, &resubscribe_rx) {
            Ok(()) => {
                backoff = ACTIVITY_WATCHER_INITIAL_BACKOFF;
                thread::sleep(ACTIVITY_RESUBSCRIBE_DEBOUNCE);
            }
            Err(err) => {
                warn!(error = %err, "Herdr World activity watcher will retry");
                thread::sleep(backoff);
                backoff = (backoff * 2).min(ACTIVITY_WATCHER_MAX_BACKOFF);
            }
        }
    }
}

fn run_agent_activity_structural_subscription(
    state: &BridgeState,
    resubscribe_tx: &mpsc::Sender<()>,
) -> Result<(), BridgeError> {
    let request = Request {
        id: "herdr-web:activity-structural".to_string(),
        method: Method::EventsSubscribe(EventsSubscribeParams {
            subscriptions: structural_event_subscriptions(),
        }),
    };
    let (ack, mut stream) = state.api.subscribe_value(&request, None)?;
    let response = herdr_compat::api::client::parse_response_value(ack)?;
    if !matches!(response.result, ResponseResult::SubscriptionStarted {}) {
        return Err(BridgeError::Protocol(format!(
            "unexpected subscription response: {:?}",
            response.result
        )));
    }

    while let Some(value) = stream.next_value()? {
        if is_structural_event_value(&value) && resubscribe_tx.send(()).is_err() {
            return Ok(());
        }
    }
    Err(BridgeError::Protocol(
        "activity structural subscription ended".to_string(),
    ))
}

fn run_agent_activity_subscription(
    state: &BridgeState,
    resubscribe_rx: &mpsc::Receiver<()>,
) -> Result<(), BridgeError> {
    drain_resubscribe_signals(resubscribe_rx);
    let panes = current_panes(&state.api)?;
    observe_agent_activity_snapshot(state, &panes);
    let pane_ids = sorted_pane_ids(&panes);
    if pane_ids.is_empty() {
        wait_for_resubscribe_signal(resubscribe_rx)?;
        return Ok(());
    }
    let request = Request {
        id: "herdr-web:activity".to_string(),
        method: Method::EventsSubscribe(EventsSubscribeParams {
            subscriptions: activity_subscriptions(&pane_ids),
        }),
    };
    let (ack, mut stream) = state.api.subscribe_value(&request, None)?;
    let response = herdr_compat::api::client::parse_response_value(ack)?;
    if !matches!(response.result, ResponseResult::SubscriptionStarted {}) {
        return Err(BridgeError::Protocol(format!(
            "unexpected subscription response: {:?}",
            response.result
        )));
    }
    stream.set_read_timeout(ACTIVITY_READ_TIMEOUT)?;

    loop {
        if drain_resubscribe_signals(resubscribe_rx) {
            let next_panes = current_panes(&state.api)?;
            observe_agent_activity_snapshot(state, &next_panes);
            if !activity_resubscribe_needed(&pane_ids, &next_panes) {
                continue;
            }
            return Ok(());
        }
        match stream.next_value() {
            Ok(Some(value)) => {
                if let Some(message) = activity_message_from_subscription_value(value) {
                    if let ActivityMessage::PaneAgentStatusChanged {
                        pane_id,
                        agent_status,
                        ..
                    } = &message
                    {
                        if state
                            .agent_activity
                            .observe_status_event(pane_id, *agent_status)
                        {
                            broadcast_agent_activity_changed(state);
                        }
                    }
                    let _ = state.activity_tx.send(message);
                }
            }
            Ok(None) => {
                return Err(BridgeError::Protocol(
                    "activity subscription ended".to_string(),
                ))
            }
            Err(err) if is_timeout_error(&err) => continue,
            Err(err) => return Err(err.into()),
        }
    }
}

fn sorted_pane_ids(panes: &[PaneInfo]) -> Vec<String> {
    let mut pane_ids = panes
        .iter()
        .map(|pane| pane.pane_id.clone())
        .collect::<Vec<_>>();
    pane_ids.sort();
    pane_ids.dedup();
    pane_ids
}

fn activity_resubscribe_needed(current_pane_ids: &[String], next_panes: &[PaneInfo]) -> bool {
    sorted_pane_ids(next_panes) != current_pane_ids
}

fn wait_for_resubscribe_signal(resubscribe_rx: &mpsc::Receiver<()>) -> Result<(), BridgeError> {
    resubscribe_rx
        .recv()
        .map(|_| ())
        .map_err(|_| BridgeError::Protocol("activity resubscribe channel closed".to_string()))
}

fn activity_subscriptions(pane_ids: &[String]) -> Vec<Subscription> {
    let mut pane_ids = pane_ids.to_vec();
    pane_ids.sort();
    pane_ids.dedup();
    pane_ids
        .into_iter()
        .map(|pane_id| Subscription::PaneAgentStatusChanged {
            pane_id,
            agent_status: None,
        })
        .collect()
}

fn structural_event_subscriptions() -> Vec<Subscription> {
    vec![
        Subscription::WorkspaceCreated {},
        Subscription::WorkspaceUpdated {},
        Subscription::WorkspaceRenamed {},
        Subscription::WorkspaceMoved {},
        Subscription::WorkspaceReordered {},
        Subscription::WorkspaceClosed {},
        Subscription::WorkspaceFocused {},
        Subscription::WorktreeCreated {},
        Subscription::WorktreeOpened {},
        Subscription::WorktreeRemoved {},
        Subscription::TabCreated {},
        Subscription::TabClosed {},
        Subscription::TabFocused {},
        Subscription::TabRenamed {},
        Subscription::TabMoved {},
        Subscription::PaneCreated {},
        Subscription::PaneClosed {},
        Subscription::PaneUpdated {},
        Subscription::PaneFocused {},
        Subscription::PaneMoved {},
        Subscription::PaneExited {},
        Subscription::PaneAgentDetected {},
        Subscription::LayoutUpdated {},
    ]
}

fn activity_message_from_subscription_value(value: serde_json::Value) -> Option<ActivityMessage> {
    let envelope: SubscriptionEventEnvelope = serde_json::from_value(value).ok()?;
    if envelope.event != SubscriptionEventKind::PaneAgentStatusChanged {
        return None;
    }
    let SubscriptionEventData::PaneAgentStatusChanged(event) = envelope.data else {
        return None;
    };
    Some(ActivityMessage::PaneAgentStatusChanged {
        pane_id: event.pane_id,
        workspace_id: event.workspace_id,
        agent_status: event.agent_status,
        agent: event.agent,
        title: event.title,
        display_agent: event.display_agent,
        state_labels: event.state_labels,
    })
}

fn is_structural_event_value(value: &serde_json::Value) -> bool {
    value
        .get("event")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|event| event != "pane.agent_status_changed")
}

fn drain_resubscribe_signals(resubscribe_rx: &mpsc::Receiver<()>) -> bool {
    let mut received = false;
    while resubscribe_rx.try_recv().is_ok() {
        received = true;
    }
    received
}

fn is_timeout_error(err: &ApiClientError) -> bool {
    matches!(
        err,
        ApiClientError::Io(err)
            if matches!(err.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock)
    )
}

fn open_event_subscription(
    api: ApiClient,
) -> Result<tokio::sync::mpsc::UnboundedReceiver<String>, BridgeError> {
    let request = Request {
        id: "herdr-web:events".to_string(),
        method: Method::EventsSubscribe(EventsSubscribeParams {
            subscriptions: structural_event_subscriptions(),
        }),
    };
    let (ack, mut stream) = api.subscribe_value(&request, None)?;
    let response = herdr_compat::api::client::parse_response_value(ack)?;
    if !matches!(response.result, ResponseResult::SubscriptionStarted {}) {
        return Err(BridgeError::Protocol(format!(
            "unexpected subscription response: {:?}",
            response.result
        )));
    }

    let (event_tx, event_rx) = tokio::sync::mpsc::unbounded_channel();
    thread::spawn(move || loop {
        match stream.next_value() {
            Ok(Some(event)) => {
                if event_tx.send(event.to_string()).is_err() {
                    break;
                }
            }
            Ok(None) => break,
            Err(err) => {
                let _ = event_tx.send(
                    serde_json::json!({
                        "type": "error",
                        "error": err.to_string(),
                    })
                    .to_string(),
                );
                break;
            }
        }
    });

    Ok(event_rx)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TerminalInputChunkStats {
    chunks: usize,
    max_chunk_bytes: usize,
}

fn send_terminal_input_chunks(
    write_tx: &TerminalWriter,
    data: &[u8],
) -> Result<TerminalInputChunkStats, String> {
    write_tx.reserve_input_bytes(data.len())?;
    if data.is_empty() {
        if write_tx
            .send(ClientMessage::Input { data: Vec::new() })
            .is_err()
        {
            return Err("terminal writer closed".to_string());
        }
        return Ok(TerminalInputChunkStats {
            chunks: 1,
            max_chunk_bytes: 0,
        });
    }

    let mut stats = TerminalInputChunkStats {
        chunks: 0,
        max_chunk_bytes: 0,
    };
    let mut sent_bytes = 0usize;
    for chunk in data.chunks(MAX_TERMINAL_INPUT_CHUNK_BYTES) {
        stats.chunks += 1;
        stats.max_chunk_bytes = stats.max_chunk_bytes.max(chunk.len());
        if write_tx
            .send(ClientMessage::Input {
                data: chunk.to_vec(),
            })
            .is_err()
        {
            write_tx.release_input_bytes(data.len() - sent_bytes);
            return Err("terminal writer closed".to_string());
        }
        sent_bytes += chunk.len();
    }
    Ok(stats)
}

fn handle_terminal_text_frame(write_tx: &TerminalWriter, text: &str) -> Result<(), String> {
    let frame = parse_terminal_client_frame(text)?;
    match frame {
        TerminalClientFrame::Input { data } => {
            send_terminal_input_chunks(write_tx, data.as_bytes())?;
            Ok(())
        }
        TerminalClientFrame::Resize {
            cols,
            rows,
            cell_width_px,
            cell_height_px,
        } => write_tx
            .send(ClientMessage::Resize {
                cols,
                rows,
                cell_width_px,
                cell_height_px,
            })
            .map(|_| ())
            .map_err(|_| "terminal writer closed".to_string()),
        TerminalClientFrame::Scroll { direction, lines } => write_tx
            .send(ClientMessage::AttachScroll {
                source: AttachScrollSource::Wheel,
                direction: match direction {
                    ScrollDirection::Up => AttachScrollDirection::Up,
                    ScrollDirection::Down => AttachScrollDirection::Down,
                },
                lines: lines.max(1),
                column: None,
                row: None,
                modifiers: 0,
            })
            .map(|_| ())
            .map_err(|_| "terminal writer closed".to_string()),
    }
}

fn parse_terminal_client_frame(text: &str) -> Result<TerminalClientFrame, String> {
    serde_json::from_str(text).map_err(|err| format!("invalid terminal frame: {err}"))
}

struct TerminalAttach {
    write_tx: TerminalWriter,
    connection_closed: Arc<ConnectionClosed>,
}

fn open_terminal_attach(
    client_socket_path: PathBuf,
    terminal_id: String,
    cols: u16,
    rows: u16,
    takeover: bool,
    protocol_version: u32,
    output_tx: tokio::sync::broadcast::Sender<TerminalOutput>,
) -> Result<TerminalAttach, BridgeError> {
    let mut stream = herdr_compat::ipc::connect_local_stream(&client_socket_path)?;
    protocol::write_message(
        &mut stream,
        &ClientMessage::Hello {
            version: protocol_version,
            cols,
            rows,
            cell_width_px: 0,
            cell_height_px: 0,
            requested_encoding: RenderEncoding::TerminalAnsi,
            keybindings: ClientKeybindings::Server,
            launch_mode: ClientLaunchMode::TerminalAttach,
        },
    )
    .map_err(|err| BridgeError::Protocol(err.to_string()))?;

    let welcome: ServerMessage = protocol::read_message(&mut stream, MAX_FRAME_SIZE)
        .map_err(|err| BridgeError::Protocol(err.to_string()))?;
    match welcome {
        ServerMessage::Welcome { error: None, .. } => {}
        ServerMessage::Welcome {
            error: Some(error), ..
        } => return Err(BridgeError::Protocol(error)),
        other => {
            return Err(BridgeError::Protocol(format!(
                "expected welcome, got {other:?}"
            )))
        }
    }

    protocol::write_message(
        &mut stream,
        &ClientMessage::AttachTerminal {
            terminal_id: terminal_id.clone(),
            takeover,
        },
    )
    .map_err(|err| BridgeError::Protocol(err.to_string()))?;

    let mut read_stream = stream.try_clone()?;
    let (write_tx, write_rx) = mpsc::channel::<ClientMessage>();
    let queued_input_bytes = Arc::new(AtomicUsize::new(0));
    let writer_queued_input_bytes = queued_input_bytes.clone();
    let connection_closed = Arc::new(ConnectionClosed::default());
    let reader_connection_closed = connection_closed.clone();

    thread::spawn(move || {
        let mut write_stream = stream;
        for message in write_rx {
            let is_detach = matches!(message, ClientMessage::Detach);
            let input_len = match &message {
                ClientMessage::Input { data } => data.len(),
                _ => 0,
            };
            let result = protocol::write_message(&mut write_stream, &message);
            if input_len > 0 {
                writer_queued_input_bytes.fetch_sub(input_len, Ordering::AcqRel);
            }
            if result.is_err() {
                break;
            }
            let _ = write_stream.flush();
            if is_detach {
                // The daemon unregisters the client when it processes Detach
                // but never closes the socket. Without a local shutdown both
                // read sides stay blocked forever: this bridge's read thread
                // (whose exit resolves the draining marker) and the daemon's
                // reader thread. Shutting down delivers EOF to both.
                shutdown_terminal_attach_stream(&write_stream);
                break;
            }
        }
    });

    thread::spawn(move || {
        let mut warned_unexpected_messages = HashSet::new();
        loop {
            let message: ServerMessage =
                match protocol::read_message(&mut read_stream, MAX_GRAPHICS_FRAME_SIZE) {
                    Ok(message) => message,
                    Err(err) => {
                        let _ = output_tx.send(TerminalOutput::Close(err.to_string()));
                        break;
                    }
                };
            warn_unexpected_terminal_attach_message(&message, &mut warned_unexpected_messages);
            match message {
                ServerMessage::Terminal(frame) => {
                    let _ = output_tx.send(TerminalOutput::Bytes(Bytes::from(frame.bytes)));
                }
                ServerMessage::TerminalBell { count } => {
                    if let Some(bytes) = terminal_bell_bytes(count) {
                        let _ = output_tx.send(TerminalOutput::Bytes(bytes));
                    }
                }
                ServerMessage::ServerShutdown { reason } => {
                    let reason = reason.unwrap_or_else(|| "server shutdown".to_string());
                    // The daemon does not log these (attach rejections in
                    // particular), so this is the only record of why an
                    // attach connection was closed from the daemon side.
                    warn!(
                        terminal_id = %terminal_id,
                        reason = %reason,
                        "terminal attach connection closed by daemon"
                    );
                    let _ = output_tx.send(TerminalOutput::Close(reason));
                    break;
                }
                ServerMessage::Welcome { .. } => {}
                ServerMessage::Notify { .. }
                | ServerMessage::Clipboard { .. }
                | ServerMessage::WindowTitle { .. }
                | ServerMessage::ReloadSoundConfig
                | ServerMessage::MouseCapture { .. }
                | ServerMessage::KittyKeyboardReportAll { .. }
                | ServerMessage::PrefixInputSource { .. }
                | ServerMessage::Frame(_)
                | ServerMessage::Graphics { .. }
                | ServerMessage::GraphicsFile { .. }
                | ServerMessage::GraphicsTransmissionRetired { .. } => {}
            }
        }
        // By this point the Detach (if any) has been flushed and the socket
        // shut down, so a reattach waiter that proceeds now can no longer
        // beat the queued Detach to the daemon.
        reader_connection_closed.mark_closed();
    });

    Ok(TerminalAttach {
        write_tx: TerminalWriter {
            tx: write_tx,
            queued_input_bytes,
        },
        connection_closed,
    })
}

/// Shuts down a terminal attach socket so both its blocked readers (the
/// bridge's and the daemon's) observe EOF; the daemon does not close attach
/// connections on its own after a `Detach`.
fn shutdown_terminal_attach_stream(stream: &herdr_compat::ipc::LocalStream) {
    #[cfg(unix)]
    match stream {
        herdr_compat::ipc::LocalStream::UdSocket(inner) => {
            let _ = inner.inner().shutdown(std::net::Shutdown::Both);
        }
    }
    #[cfg(not(unix))]
    let _ = stream; // Named pipes tear down once both processes drop handles.
}

fn terminal_attach_protocol(api: &ApiClient) -> Result<u32, BridgeError> {
    validated_daemon_protocol(api.status_with_timeout(DAEMON_STATUS_TIMEOUT)?)
}

fn startup_daemon_status(api: &ApiClient) -> io::Result<herdr_compat::api::RuntimeStatus> {
    let status = api
        .status_with_timeout(DAEMON_STATUS_TIMEOUT)
        .map_err(BridgeError::from)
        .map_err(startup_daemon_error)?;
    validated_daemon_protocol(status.clone()).map_err(startup_daemon_error)?;
    Ok(status)
}

fn validated_daemon_protocol(status: herdr_compat::api::RuntimeStatus) -> Result<u32, BridgeError> {
    let version = status.version.as_deref().ok_or_else(|| {
        BridgeError::Protocol(format!(
            "Herdr daemon status did not include a version; need Herdr {MIN_HERDR_VERSION_LABEL} or newer with protocol {PROTOCOL_VERSION}"
        ))
    })?;
    let version_triplet = parse_version_triplet(version).ok_or_else(|| {
        BridgeError::Protocol(format!(
            "Herdr daemon reported an invalid version; need Herdr {MIN_HERDR_VERSION_LABEL} or newer with protocol {PROTOCOL_VERSION}"
        ))
    })?;
    if version_triplet < MIN_HERDR_VERSION {
        return Err(BridgeError::Protocol(format!(
            "Herdr daemon version is too old for Herdr World; need Herdr {MIN_HERDR_VERSION_LABEL} or newer with protocol {PROTOCOL_VERSION}"
        )));
    }

    let protocol = status.protocol.ok_or_else(|| {
        BridgeError::Protocol(format!(
            "Herdr daemon status did not include a protocol; need Herdr {MIN_HERDR_VERSION_LABEL} or newer with protocol {PROTOCOL_VERSION}"
        ))
    })?;
    if protocol == PROTOCOL_VERSION {
        Ok(protocol)
    } else {
        Err(BridgeError::Protocol(format!(
            "Herdr daemon protocol {protocol} is incompatible with Herdr World; need Herdr {MIN_HERDR_VERSION_LABEL} or newer with protocol {PROTOCOL_VERSION}"
        )))
    }
}

fn parse_version_triplet(version: &str) -> Option<(u64, u64, u64)> {
    let version = version.trim();
    let version = version.strip_prefix('v').unwrap_or(version);
    let (release, build_metadata) = match version.split_once('+') {
        Some((release, metadata)) => (release, Some(metadata)),
        None => (version, None),
    };
    if release.contains('-')
        || build_metadata.is_some_and(|metadata| {
            metadata.is_empty()
                || metadata.split('.').any(|identifier| {
                    identifier.is_empty()
                        || !identifier
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                })
        })
    {
        return None;
    }
    let mut parts = release.split('.');
    let parse_number = |part: Option<&str>| {
        let part = part?;
        if part.is_empty()
            || !part.bytes().all(|byte| byte.is_ascii_digit())
            || (part.len() > 1 && part.starts_with('0'))
        {
            return None;
        }
        part.parse().ok()
    };
    let major = parse_number(parts.next())?;
    let minor = parse_number(parts.next())?;
    let patch = parse_number(parts.next())?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

fn startup_daemon_error(err: BridgeError) -> io::Error {
    io::Error::new(
        ErrorKind::ConnectionRefused,
        format!(
            "unable to start Herdr World bridge: {err}. Install, update, or start Herdr v0.8.2 or newer, then retry. Packaged users can run bin/herdr-world for consent-based setup; custom sessions must use --session NAME or HERDR_SOCKET_PATH."
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request as HttpRequest;
    use flate2::read::GzDecoder;
    use std::future::IntoFuture;
    use std::io::Read;
    use tower::ServiceExt;

    #[tokio::test]
    async fn static_world_entry_routes_receive_revalidation_cache_policy() {
        let static_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../web");
        let app = static_routes(static_dir);

        for path in [
            "/",
            "/spaces",
            "/spaces/",
            "/world",
            "/world/",
            "/future-navigation",
            "/future/navigation/path",
        ] {
            let response = app
                .clone()
                .oneshot(
                    HttpRequest::builder()
                        .uri(path)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            assert_eq!(
                response.headers().get(CACHE_CONTROL).unwrap(),
                "no-cache",
                "{path}"
            );
        }

        for path in ["/missing.js", "/assets/missing.js", "/api/missing"] {
            let response = app
                .clone()
                .oneshot(
                    HttpRequest::builder()
                        .uri(path)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
            assert!(response.headers().get(CACHE_CONTROL).is_none(), "{path}");
        }
    }

    #[test]
    fn gzip_terminal_output_frame_round_trips_and_reduces_repeated_output() {
        let payload = Bytes::from(vec![b'x'; 4096]);

        let frame = encode_terminal_output_frame(payload.clone(), TerminalOutputWireEncoding::Gzip);

        assert_eq!(frame[0], TERMINAL_OUTPUT_FRAME_GZIP);
        let mut decoded = Vec::new();
        GzDecoder::new(&frame[1..])
            .read_to_end(&mut decoded)
            .expect("gzip terminal output should decode");
        assert_eq!(decoded, payload);
        assert!(frame.len() < payload.len() / 4);
    }

    #[test]
    fn identity_terminal_output_encoding_preserves_legacy_frames() {
        let payload = Bytes::from_static(b"legacy terminal bytes");

        let frame =
            encode_terminal_output_frame(payload.clone(), TerminalOutputWireEncoding::Identity);

        assert_eq!(frame, payload);
    }

    #[test]
    fn gzip_terminal_output_frame_keeps_small_output_raw() {
        let payload = Bytes::from_static(b"ready> ");

        let frame = encode_terminal_output_frame(payload.clone(), TerminalOutputWireEncoding::Gzip);

        assert_eq!(frame[0], TERMINAL_OUTPUT_FRAME_RAW);
        assert_eq!(&frame[1..], payload);
    }

    #[test]
    fn static_cache_headers_revalidate_entrypoints_and_public_files() {
        for path in [
            "/",
            "/index.html",
            "/manifest.json",
            "/herdr-logo.svg",
            "/spaces",
            "/spaces/",
            "/world",
            "/world/",
        ] {
            let mut headers = HeaderMap::new();
            insert_static_cache_header(&mut headers, path, StatusCode::OK);
            assert_eq!(headers.get(CACHE_CONTROL).unwrap(), "no-cache", "{path}");
        }
    }

    #[test]
    fn static_cache_headers_make_successful_vite_assets_immutable() {
        let mut headers = HeaderMap::new();
        insert_static_cache_header(&mut headers, "/assets/index-AbCd1234.js", StatusCode::OK);
        assert_eq!(
            headers.get(CACHE_CONTROL).unwrap(),
            "public, max-age=31536000, immutable"
        );
    }

    #[test]
    fn static_cache_headers_do_not_cache_missing_assets() {
        let mut headers = HeaderMap::new();
        insert_static_cache_header(&mut headers, "/assets/missing.js", StatusCode::NOT_FOUND);
        assert!(!headers.contains_key(CACHE_CONTROL));
    }

    #[test]
    fn static_cache_headers_preserve_service_policy() {
        let mut headers = HeaderMap::new();
        headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
        insert_static_cache_header(&mut headers, "/index.html", StatusCode::OK);
        assert_eq!(headers.get(CACHE_CONTROL).unwrap(), "no-store");
    }

    #[test]
    fn coalescer_sends_first_output_immediately() {
        let now = Instant::now();
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));

        assert_eq!(
            coalescer.push_bytes(Bytes::from_static(b"first"), now),
            TerminalOutputCoalescingDecision::SendNow(Bytes::from_static(b"first"))
        );
        assert_eq!(
            coalescer.deadline(),
            Some(now + terminal_output_coalesce_window(None))
        );
        assert_eq!(coalescer.lifetime_stats.source_frames, 1);
        assert_eq!(coalescer.lifetime_stats.sent_frames, 1);
        assert_eq!(coalescer.lifetime_stats.immediate_frames, 1);
    }

    #[test]
    fn terminal_bell_bytes_are_zero_safe_and_bounded() {
        assert_eq!(terminal_bell_bytes(0), None);
        assert_eq!(
            terminal_bell_bytes(3),
            Some(Bytes::from_static(b"\x07\x07\x07"))
        );
        assert_eq!(terminal_bell_bytes(16).unwrap().len(), 16);
        assert_eq!(terminal_bell_bytes(u16::MAX).unwrap().len(), 16);
    }

    #[test]
    fn terminal_bell_preserves_order_through_enabled_coalescing() {
        let now = Instant::now();
        let window = terminal_output_coalesce_window(None);
        let mut coalescer = TerminalOutputCoalescer::new(window);

        let first = coalescer.push_bytes(Bytes::from_static(b"A"), now);
        assert_eq!(
            first,
            TerminalOutputCoalescingDecision::SendNow(Bytes::from_static(b"A"))
        );
        assert_eq!(
            coalescer.push_bytes(terminal_bell_bytes(2).unwrap(), now),
            TerminalOutputCoalescingDecision::Pending
        );
        assert_eq!(
            coalescer.push_bytes(Bytes::from_static(b"B"), now),
            TerminalOutputCoalescingDecision::Pending
        );
        assert_eq!(
            coalescer.handle_deadline(),
            Some(TerminalOutputFlushReason::Timer)
        );
        let pending = coalescer
            .flush_pending(TerminalOutputFlushReason::Timer, now + window)
            .unwrap();
        assert_eq!(
            [Bytes::from_static(b"A"), pending]
                .into_iter()
                .flat_map(|bytes| bytes.to_vec())
                .collect::<Vec<_>>(),
            b"A\x07\x07B"
        );
    }

    #[test]
    fn terminal_bell_preserves_order_with_coalescing_disabled() {
        let now = Instant::now();
        let mut coalescer = TerminalOutputCoalescer::new(Duration::ZERO);
        let mut output = Vec::new();
        for bytes in [
            Bytes::from_static(b"A"),
            terminal_bell_bytes(2).unwrap(),
            Bytes::from_static(b"B"),
        ] {
            let TerminalOutputCoalescingDecision::SendNow(bytes) = coalescer.push_bytes(bytes, now)
            else {
                panic!("disabled coalescing must send each output chunk immediately");
            };
            output.extend_from_slice(&bytes);
        }
        assert_eq!(output, b"A\x07\x07B");
    }

    #[test]
    fn direct_graphics_messages_are_ignored_and_warned_once_per_connection() {
        let graphics = ServerMessage::Graphics {
            bytes: b"secret-control-payload".to_vec(),
        };
        let graphics_file = ServerMessage::GraphicsFile {
            path: "/secret/private/image".into(),
            expected_len: 12,
            image_id: 7,
            transfer_id: 8,
            leading: b"secret-leading".to_vec(),
            control: "secret-control".into(),
        };
        let retired = ServerMessage::GraphicsTransmissionRetired {
            transfer_id: 8,
            image_id: 7,
        };
        let mut warned = HashSet::new();

        for message in [
            &graphics,
            &graphics,
            &graphics_file,
            &graphics_file,
            &retired,
            &retired,
        ] {
            warn_unexpected_terminal_attach_message(message, &mut warned);
        }

        assert_eq!(warned.len(), 3);
        assert!(warned.contains(&UnexpectedTerminalAttachMessage::Graphics));
        assert!(warned.contains(&UnexpectedTerminalAttachMessage::GraphicsFile));
        assert!(warned.contains(&UnexpectedTerminalAttachMessage::GraphicsTransmissionRetired));
        assert_eq!(
            unexpected_terminal_attach_message(&graphics_file)
                .unwrap()
                .as_str(),
            "GraphicsFile"
        );
        assert!(!UnexpectedTerminalAttachMessage::GraphicsFile
            .as_str()
            .contains("secret"));
    }

    #[test]
    fn coalescer_can_disable_output_coalescing() {
        let now = Instant::now();
        let mut coalescer = TerminalOutputCoalescer::new(Duration::ZERO);

        assert_eq!(
            coalescer.push_bytes(Bytes::from_static(b"first"), now),
            TerminalOutputCoalescingDecision::SendNow(Bytes::from_static(b"first"))
        );
        assert_eq!(
            coalescer.push_bytes(Bytes::from_static(b"second"), now),
            TerminalOutputCoalescingDecision::SendNow(Bytes::from_static(b"second"))
        );
        assert_eq!(coalescer.deadline(), None);
        assert_eq!(coalescer.lifetime_stats.source_frames, 2);
        assert_eq!(coalescer.lifetime_stats.sent_frames, 2);
        assert_eq!(coalescer.lifetime_stats.coalesced_sent_frames, 0);
    }

    #[test]
    fn terminal_output_coalesce_window_defaults_and_clamps() {
        assert_eq!(
            terminal_output_coalesce_window(None),
            Duration::from_millis(DEFAULT_TERMINAL_OUTPUT_COALESCE_MS)
        );
        assert_eq!(terminal_output_coalesce_window(Some(0)), Duration::ZERO);
        assert_eq!(
            terminal_output_coalesce_window(Some(128)),
            Duration::from_millis(128)
        );
        assert_eq!(
            terminal_output_coalesce_window(Some(999)),
            Duration::from_millis(MAX_TERMINAL_OUTPUT_COALESCE_MS)
        );
    }

    #[test]
    fn coalescer_pends_output_inside_active_window() {
        let now = Instant::now();
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));
        let _ = coalescer.push_bytes(Bytes::from_static(b"first"), now);

        assert_eq!(
            coalescer.push_bytes(Bytes::from_static(b"second"), now),
            TerminalOutputCoalescingDecision::Pending
        );
        assert_eq!(coalescer.pending_bytes, 6);
        assert_eq!(coalescer.pending.len(), 1);
        assert_eq!(coalescer.lifetime_stats.max_pending_bytes, 6);
        assert_eq!(coalescer.lifetime_stats.max_pending_chunks, 1);
    }

    #[test]
    fn coalescer_flushes_when_byte_threshold_is_reached() {
        let now = Instant::now();
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));
        let _ = coalescer.push_bytes(Bytes::from_static(b"first"), now);

        let decision = coalescer.push_bytes(
            Bytes::from(vec![b'x'; TERMINAL_OUTPUT_COALESCE_MAX_BYTES]),
            now,
        );

        assert_eq!(
            decision,
            TerminalOutputCoalescingDecision::FlushPending(
                TerminalOutputFlushReason::ByteThreshold
            )
        );
        let flushed = coalescer
            .flush_pending(TerminalOutputFlushReason::ByteThreshold, now)
            .unwrap();
        assert_eq!(flushed.len(), TERMINAL_OUTPUT_COALESCE_MAX_BYTES);
        assert_eq!(coalescer.pending_bytes, 0);
        assert_eq!(coalescer.pending.len(), 0);
        assert_eq!(coalescer.lifetime_stats.byte_flushes, 1);
        assert_eq!(coalescer.lifetime_stats.coalesced_sent_frames, 1);
    }

    #[test]
    fn coalescer_deadline_returns_to_idle_when_nothing_pending() {
        let now = Instant::now();
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));
        let _ = coalescer.push_bytes(Bytes::from_static(b"first"), now);

        assert_eq!(coalescer.handle_deadline(), None);
        assert_eq!(coalescer.deadline(), None);
    }

    #[test]
    fn coalescer_deadline_flushes_pending_and_rearms_window() {
        let now = Instant::now();
        let flush_at = now + terminal_output_coalesce_window(None);
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));
        let _ = coalescer.push_bytes(Bytes::from_static(b"first"), now);
        let _ = coalescer.push_bytes(Bytes::from_static(b"second"), now);

        assert_eq!(
            coalescer.handle_deadline(),
            Some(TerminalOutputFlushReason::Timer)
        );
        assert_eq!(
            coalescer.flush_pending(TerminalOutputFlushReason::Timer, flush_at),
            Some(Bytes::from_static(b"second"))
        );
        assert_eq!(
            coalescer.deadline(),
            Some(flush_at + terminal_output_coalesce_window(None))
        );
        assert_eq!(coalescer.lifetime_stats.timer_flushes, 1);
    }

    #[test]
    fn coalescer_keeps_spaced_output_immediate() {
        let now = Instant::now();
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));

        assert_eq!(
            coalescer.push_bytes(Bytes::from_static(b"one"), now),
            TerminalOutputCoalescingDecision::SendNow(Bytes::from_static(b"one"))
        );
        assert_eq!(coalescer.handle_deadline(), None);
        assert_eq!(
            coalescer.push_bytes(
                Bytes::from_static(b"two"),
                now + terminal_output_coalesce_window(None) + Duration::from_millis(1),
            ),
            TerminalOutputCoalescingDecision::SendNow(Bytes::from_static(b"two"))
        );
        assert_eq!(coalescer.handle_deadline(), None);
        assert_eq!(
            coalescer.push_bytes(
                Bytes::from_static(b"three"),
                now + terminal_output_coalesce_window(None) * 2 + Duration::from_millis(2),
            ),
            TerminalOutputCoalescingDecision::SendNow(Bytes::from_static(b"three"))
        );

        assert_eq!(coalescer.lifetime_stats.source_frames, 3);
        assert_eq!(coalescer.lifetime_stats.sent_frames, 3);
        assert_eq!(coalescer.lifetime_stats.immediate_frames, 3);
        assert_eq!(coalescer.lifetime_stats.coalesced_source_frames, 0);
        assert_eq!(coalescer.lifetime_stats.coalesced_sent_frames, 0);
        assert_eq!(coalescer.lifetime_stats.merged_flushes, 0);
    }

    #[test]
    fn coalescer_keeps_continuous_stream_in_active_window() {
        let now = Instant::now();
        let first_flush = now + terminal_output_coalesce_window(None);
        let second_flush = first_flush + terminal_output_coalesce_window(None);
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));

        let _ = coalescer.push_bytes(Bytes::from_static(b"one"), now);
        let _ = coalescer.push_bytes(Bytes::from_static(b"two"), now + Duration::from_millis(1));
        let _ = coalescer.push_bytes(Bytes::from_static(b"three"), now + Duration::from_millis(2));
        assert_eq!(
            coalescer.handle_deadline(),
            Some(TerminalOutputFlushReason::Timer)
        );
        assert_eq!(
            coalescer.flush_pending(TerminalOutputFlushReason::Timer, first_flush),
            Some(Bytes::from_static(b"twothree"))
        );

        let _ = coalescer.push_bytes(
            Bytes::from_static(b"four"),
            first_flush + Duration::from_millis(1),
        );
        let _ = coalescer.push_bytes(
            Bytes::from_static(b"five"),
            first_flush + Duration::from_millis(2),
        );
        assert_eq!(
            coalescer.handle_deadline(),
            Some(TerminalOutputFlushReason::Timer)
        );
        assert_eq!(
            coalescer.flush_pending(TerminalOutputFlushReason::Timer, second_flush),
            Some(Bytes::from_static(b"fourfive"))
        );

        assert_eq!(coalescer.lifetime_stats.source_frames, 5);
        assert_eq!(coalescer.lifetime_stats.sent_frames, 3);
        assert_eq!(coalescer.lifetime_stats.immediate_frames, 1);
        assert_eq!(coalescer.lifetime_stats.coalesced_source_frames, 4);
        assert_eq!(coalescer.lifetime_stats.coalesced_sent_frames, 2);
        assert_eq!(coalescer.lifetime_stats.merged_flushes, 2);
    }

    #[test]
    fn draining_terminal_output_pending_preserves_order() {
        let mut pending = vec![
            Bytes::from_static(b"abc"),
            Bytes::from_static(b"def"),
            Bytes::from_static(b"ghi"),
        ];
        let mut pending_bytes = 9;

        assert_eq!(
            drain_terminal_output_pending(&mut pending, &mut pending_bytes),
            Some(Bytes::from_static(b"abcdefghi"))
        );
        assert!(pending.is_empty());
        assert_eq!(pending_bytes, 0);
    }

    #[test]
    fn coalescing_stats_derived_values_are_zero_safe() {
        let stats = TerminalOutputCoalescingStats::default();

        assert_eq!(stats.frames_saved(), 0);
        assert_eq!(stats.coalescing_ratio(), 0.0);
        assert_eq!(stats.avg_source_frame_bytes(), 0.0);
        assert_eq!(stats.avg_sent_frame_bytes(), 0.0);
        assert_eq!(stats.avg_flush_latency_us(), 0.0);
    }

    #[test]
    fn coalescing_stats_track_saved_frames_and_latency() {
        let mut stats = TerminalOutputCoalescingStats::default();

        stats.record_source(4);
        stats.record_source(6);
        stats.record_source(10);
        stats.record_immediate_send(4);
        stats.record_flush_reason(TerminalOutputFlushReason::Timer);
        stats.record_coalesced_send(2, 16, Duration::from_micros(800));

        assert_eq!(stats.sent_frames, 2);
        assert_eq!(stats.frames_saved(), 1);
        assert_eq!(stats.coalesced_source_frames, 2);
        assert_eq!(stats.merged_flushes, 1);
        assert_eq!(
            stats.sent_frames,
            stats.immediate_frames + stats.coalesced_sent_frames
        );
        assert_eq!(
            stats.source_frames,
            stats.immediate_frames + stats.coalesced_source_frames
        );
        assert_eq!(stats.coalescing_ratio(), 1.5);
        assert_eq!(stats.avg_flush_latency_us(), 800.0);
        assert_eq!(stats.avg_source_frame_bytes(), 20.0 / 3.0);
        assert_eq!(stats.avg_sent_frame_bytes(), 10.0);
    }

    #[test]
    fn parses_input_frame() {
        assert_eq!(
            parse_terminal_client_frame(r#"{"type":"input","data":"ls\n"}"#).unwrap(),
            TerminalClientFrame::Input {
                data: "ls\n".to_string()
            }
        );
    }

    #[test]
    fn terminal_probe_query_is_non_mutating_and_has_no_resize_defaults() {
        let query: TerminalQuery = serde_json::from_str(
            r#"{"terminal_id":"terminal-test","takeover":false,"probe":true}"#,
        )
        .unwrap();
        assert!(query.probe);
        assert_eq!(query.cols, None);
        assert_eq!(query.rows, None);
    }

    fn test_terminal_writer() -> (TerminalWriter, mpsc::Receiver<ClientMessage>) {
        let (tx, rx) = mpsc::channel();
        (
            TerminalWriter {
                tx,
                queued_input_bytes: Arc::new(AtomicUsize::new(0)),
            },
            rx,
        )
    }

    #[test]
    fn chunks_terminal_input_below_daemon_limit() {
        let (tx, rx) = test_terminal_writer();
        let data = vec![b'x'; MAX_TERMINAL_INPUT_CHUNK_BYTES * 2 + 17];

        let stats = send_terminal_input_chunks(&tx, &data).unwrap();

        assert_eq!(
            stats,
            TerminalInputChunkStats {
                chunks: 3,
                max_chunk_bytes: MAX_TERMINAL_INPUT_CHUNK_BYTES
            }
        );
        let chunks: Vec<Vec<u8>> = rx
            .try_iter()
            .map(|message| match message {
                ClientMessage::Input { data } => data,
                other => panic!("unexpected terminal message: {other:?}"),
            })
            .collect();
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].len(), MAX_TERMINAL_INPUT_CHUNK_BYTES);
        assert_eq!(chunks[1].len(), MAX_TERMINAL_INPUT_CHUNK_BYTES);
        assert_eq!(chunks[2].len(), 17);
        assert_eq!(chunks.concat(), data);
    }

    #[test]
    fn forwards_empty_terminal_input_as_one_message() {
        let (tx, rx) = test_terminal_writer();

        let stats = send_terminal_input_chunks(&tx, &[]).unwrap();

        assert_eq!(
            stats,
            TerminalInputChunkStats {
                chunks: 1,
                max_chunk_bytes: 0
            }
        );
        assert_eq!(
            rx.recv().unwrap(),
            ClientMessage::Input { data: Vec::new() }
        );
    }

    fn test_shared_terminal_session() -> (SharedTerminalSession, mpsc::Receiver<ClientMessage>) {
        let (write_tx, rx) = test_terminal_writer();
        let (output_tx, _) = tokio::sync::broadcast::channel(8);
        (
            SharedTerminalSession {
                write_tx,
                output_tx,
                client_count: Arc::new(AtomicUsize::new(1)),
                connection_closed: Arc::new(ConnectionClosed::default()),
            },
            rx,
        )
    }

    #[test]
    fn releasing_last_client_detaches_and_records_draining_connection() {
        let (session, rx) = test_shared_terminal_session();
        let sessions = Mutex::new(TerminalSessions::default());
        sessions
            .lock()
            .unwrap()
            .active
            .insert("term-1".to_string(), session.clone());

        release_terminal_session(&sessions, "term-1", &session);

        let map = sessions.lock().unwrap();
        assert!(map.active.is_empty());
        assert!(Arc::ptr_eq(
            map.draining.get("term-1").unwrap(),
            &session.connection_closed
        ));
        assert_eq!(rx.try_iter().count(), 1);
    }

    #[test]
    fn releasing_non_last_client_keeps_session_attached() {
        let (session, rx) = test_shared_terminal_session();
        session.client_count.store(2, Ordering::SeqCst);
        let sessions = Mutex::new(TerminalSessions::default());
        sessions
            .lock()
            .unwrap()
            .active
            .insert("term-1".to_string(), session.clone());

        release_terminal_session(&sessions, "term-1", &session);

        let map = sessions.lock().unwrap();
        assert!(map.active.contains_key("term-1"));
        assert!(map.draining.is_empty());
        assert_eq!(rx.try_iter().count(), 0);
    }

    #[test]
    fn does_not_record_already_closed_connection_as_draining() {
        let (session, _rx) = test_shared_terminal_session();
        session.connection_closed.mark_closed();
        let sessions = Mutex::new(TerminalSessions::default());
        sessions
            .lock()
            .unwrap()
            .active
            .insert("term-1".to_string(), session.clone());

        release_terminal_session(&sessions, "term-1", &session);

        let map = sessions.lock().unwrap();
        assert!(map.active.is_empty());
        assert!(map.draining.is_empty());
    }

    #[test]
    fn attach_gate_release_removes_only_matching_gate_and_wakes_waiters() {
        let sessions = Mutex::new(TerminalSessions::default());
        let gate = Arc::new(ConnectionClosed::default());
        let other = Arc::new(ConnectionClosed::default());
        sessions
            .lock()
            .unwrap()
            .attaching
            .insert("term-1".to_string(), gate.clone());

        // Releasing a non-matching gate signals it but leaves the entry.
        release_attach_gate(&sessions, "term-1", &other);
        assert!(other.is_closed());
        assert!(sessions.lock().unwrap().attaching.contains_key("term-1"));

        release_attach_gate(&sessions, "term-1", &gate);
        assert!(gate.is_closed());
        assert!(sessions.lock().unwrap().attaching.is_empty());
    }

    #[test]
    fn connection_closed_wait_times_out_while_open() {
        let connection = ConnectionClosed::default();
        assert!(!connection.wait_closed(Duration::from_millis(10)));
    }

    #[test]
    fn connection_closed_wait_wakes_on_mark_closed() {
        let connection = Arc::new(ConnectionClosed::default());
        let waiter = connection.clone();
        let handle = thread::spawn(move || waiter.wait_closed(Duration::from_secs(5)));
        thread::sleep(Duration::from_millis(20));
        connection.mark_closed();
        assert!(handle.join().unwrap());
        assert!(connection.is_closed());
    }

    /// The daemon unregisters a client on `Detach` but keeps the socket open,
    /// so the bridge must shut the connection down itself or the draining
    /// marker would only ever resolve by timeout (a 2s stall on reattach).
    #[cfg(unix)]
    #[test]
    fn detach_tears_down_attach_connection_without_daemon_close() {
        let dir = std::env::temp_dir();
        let dir = if dir.as_os_str().len() <= 40 {
            dir
        } else {
            PathBuf::from("/tmp")
        };
        let socket_path = dir.join(format!("herdr-web-detach-test-{}.sock", std::process::id()));
        let _ = std::fs::remove_file(&socket_path);
        let listener = std::os::unix::net::UnixListener::bind(&socket_path).unwrap();

        let (daemon_tx, daemon_rx) = mpsc::channel();
        let daemon = thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            sock.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let hello: ClientMessage = protocol::read_message(&mut sock, MAX_FRAME_SIZE).unwrap();
            assert!(matches!(hello, ClientMessage::Hello { .. }));
            protocol::write_message(
                &mut sock,
                &ServerMessage::Welcome {
                    version: PROTOCOL_VERSION,
                    encoding: RenderEncoding::TerminalAnsi,
                    error: None,
                },
            )
            .unwrap();
            let attach: ClientMessage = protocol::read_message(&mut sock, MAX_FRAME_SIZE).unwrap();
            assert!(matches!(attach, ClientMessage::AttachTerminal { .. }));
            let detach: ClientMessage = protocol::read_message(&mut sock, MAX_FRAME_SIZE).unwrap();
            assert!(matches!(detach, ClientMessage::Detach));
            // Like the real daemon: keep the socket open after Detach and
            // just keep reading. Only the bridge's shutdown ends this read.
            let bridge_shut_down =
                protocol::read_message::<_, ClientMessage>(&mut sock, MAX_FRAME_SIZE).is_err();
            daemon_tx.send(bridge_shut_down).unwrap();
        });

        let (output_tx, _) = tokio::sync::broadcast::channel(8);
        let attach = open_terminal_attach(
            socket_path.clone(),
            "term-test".to_string(),
            80,
            24,
            false,
            PROTOCOL_VERSION,
            output_tx,
        )
        .unwrap();

        attach.write_tx.send(ClientMessage::Detach).unwrap();

        // The bridge's own post-Detach shutdown must resolve the close signal
        // quickly; before the fix this only resolved by drain timeout.
        assert!(attach.connection_closed.wait_closed(Duration::from_secs(2)));
        assert!(daemon_rx.recv_timeout(Duration::from_secs(2)).unwrap());
        daemon.join().unwrap();
        let _ = std::fs::remove_file(&socket_path);
    }

    /// Direct-graphics messages are transport-visible to a terminal attach but
    /// must not trigger file reads, browser frames, or client responses. A
    /// later terminal message proves that the attach remains usable.
    #[cfg(unix)]
    #[test]
    fn terminal_attach_ignores_direct_graphics_and_keeps_stream_open() {
        let dir = std::env::temp_dir();
        let dir = if dir.as_os_str().len() <= 40 {
            dir
        } else {
            PathBuf::from("/tmp")
        };
        let socket_path = dir.join(format!(
            "herdr-web-graphics-test-{}.sock",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&socket_path);
        let listener = std::os::unix::net::UnixListener::bind(&socket_path).unwrap();

        let daemon = thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let hello: ClientMessage = protocol::read_message(&mut sock, MAX_FRAME_SIZE).unwrap();
            assert!(matches!(hello, ClientMessage::Hello { .. }));
            protocol::write_message(
                &mut sock,
                &ServerMessage::Welcome {
                    version: PROTOCOL_VERSION,
                    encoding: RenderEncoding::TerminalAnsi,
                    error: None,
                },
            )
            .unwrap();
            let attach: ClientMessage = protocol::read_message(&mut sock, MAX_FRAME_SIZE).unwrap();
            assert!(matches!(attach, ClientMessage::AttachTerminal { .. }));

            let graphics_file = ServerMessage::GraphicsFile {
                path: "/private/should-never-be-opened".into(),
                expected_len: 5,
                image_id: 1,
                transfer_id: 2,
                leading: b"private-leading".to_vec(),
                control: "private-control".into(),
            };
            for message in [
                graphics_file.clone(),
                graphics_file,
                ServerMessage::GraphicsTransmissionRetired {
                    transfer_id: 2,
                    image_id: 1,
                },
                ServerMessage::GraphicsTransmissionRetired {
                    transfer_id: 2,
                    image_id: 1,
                },
                ServerMessage::Graphics {
                    bytes: b"private-graphics".to_vec(),
                },
            ] {
                protocol::write_message(&mut sock, &message).unwrap();
            }
            protocol::write_message(&mut sock, &ServerMessage::TerminalBell { count: 3 }).unwrap();
            protocol::write_message(
                &mut sock,
                &ServerMessage::Terminal(protocol::TerminalFrame {
                    seq: 1,
                    width: 80,
                    height: 24,
                    full: false,
                    bytes: b"after-graphics".to_vec(),
                }),
            )
            .unwrap();

            let detach: ClientMessage = protocol::read_message(&mut sock, MAX_FRAME_SIZE).unwrap();
            assert!(matches!(detach, ClientMessage::Detach));
        });

        let (output_tx, _) = tokio::sync::broadcast::channel(8);
        let mut output_rx = output_tx.subscribe();
        let attach = open_terminal_attach(
            socket_path.clone(),
            "term-graphics-test".to_string(),
            80,
            24,
            false,
            PROTOCOL_VERSION,
            output_tx,
        )
        .unwrap();

        let receive_output = |output_rx: &mut tokio::sync::broadcast::Receiver<TerminalOutput>| {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_time()
                .build()
                .unwrap();
            runtime.block_on(async {
                tokio::time::timeout(Duration::from_secs(2), output_rx.recv())
                    .await
                    .unwrap()
                    .unwrap()
            })
        };
        let TerminalOutput::Bytes(bell) = receive_output(&mut output_rx) else {
            panic!("direct graphics should not close the terminal stream");
        };
        assert_eq!(&bell[..], b"\x07\x07\x07");
        let TerminalOutput::Bytes(after_graphics) = receive_output(&mut output_rx) else {
            panic!("terminal output after direct graphics was not forwarded");
        };
        assert_eq!(&after_graphics[..], b"after-graphics");

        attach.write_tx.send(ClientMessage::Detach).unwrap();
        assert!(attach.connection_closed.wait_closed(Duration::from_secs(2)));
        daemon.join().unwrap();
        let _ = std::fs::remove_file(&socket_path);
    }

    #[test]
    fn rejects_oversized_terminal_input_frame_atomically() {
        let (tx, rx) = test_terminal_writer();
        let data = vec![b'x'; MAX_QUEUED_TERMINAL_INPUT_BYTES + 1];

        // The frame exceeds the whole budget: no chunk may reach the pty.
        assert!(send_terminal_input_chunks(&tx, &data).is_err());
        assert_eq!(rx.try_iter().count(), 0);
    }

    #[test]
    fn rejects_terminal_input_frame_exceeding_remaining_budget_atomically() {
        let (tx, rx) = test_terminal_writer();
        let first = vec![b'x'; MAX_QUEUED_TERMINAL_INPUT_BYTES - 1024];
        let second = vec![b'y'; 4096];

        // Nothing drains the queue, so the second frame must be refused
        // whole even though part of it would still fit.
        assert!(send_terminal_input_chunks(&tx, &first).is_ok());
        assert!(send_terminal_input_chunks(&tx, &second).is_err());
        let queued: usize = rx
            .try_iter()
            .map(|message| match message {
                ClientMessage::Input { data } => data.len(),
                other => panic!("unexpected terminal message: {other:?}"),
            })
            .sum();
        assert_eq!(queued, first.len());
    }

    #[test]
    fn parses_resize_frame_with_default_cell_size() {
        assert_eq!(
            parse_terminal_client_frame(r#"{"type":"resize","cols":100,"rows":40}"#).unwrap(),
            TerminalClientFrame::Resize {
                cols: 100,
                rows: 40,
                cell_width_px: 0,
                cell_height_px: 0
            }
        );
    }

    #[test]
    fn rejects_unknown_frame_type() {
        assert!(parse_terminal_client_frame(r#"{"type":"zoom"}"#).is_err());
    }

    #[test]
    fn parses_scroll_frame() {
        assert_eq!(
            parse_terminal_client_frame(r#"{"type":"scroll","direction":"up","lines":5}"#).unwrap(),
            TerminalClientFrame::Scroll {
                direction: ScrollDirection::Up,
                lines: 5
            }
        );
    }

    #[test]
    fn scroll_frame_defaults_lines() {
        assert_eq!(
            parse_terminal_client_frame(r#"{"type":"scroll","direction":"down"}"#).unwrap(),
            TerminalClientFrame::Scroll {
                direction: ScrollDirection::Down,
                lines: 3
            }
        );
    }

    #[test]
    fn command_allow_list_excludes_dangerous_methods() {
        assert!(ALLOWED_COMMANDS.contains(&"workspace.create"));
        assert!(ALLOWED_COMMANDS.contains(&"tab.close"));
        assert!(ALLOWED_COMMANDS.contains(&"pane.rename"));
        assert!(!ALLOWED_COMMANDS.contains(&"server.stop"));
        assert!(!ALLOWED_COMMANDS.contains(&"pane.send_keys"));
        assert!(!ALLOWED_COMMANDS.contains(&"pane.send_input"));
        assert!(ALLOWED_COMMANDS.contains(&"workspace.move_block"));
        // pane.split is intentionally allowed so the web client can create splits.
        assert!(ALLOWED_COMMANDS.contains(&"pane.split"));
        assert!(ALLOWED_COMMANDS.contains(&"pane.focus_direction"));
        assert!(ALLOWED_COMMANDS.contains(&"pane.move"));
        assert!(!ALLOWED_COMMANDS.contains(&"agent.start"));
    }

    #[test]
    fn activity_subscriptions_include_only_deduped_pane_activity() {
        let subscriptions = activity_subscriptions(&[
            "pane-2".to_string(),
            "pane-1".to_string(),
            "pane-2".to_string(),
        ]);

        let pane_subscriptions = subscriptions
            .iter()
            .filter_map(|subscription| match subscription {
                Subscription::PaneAgentStatusChanged {
                    pane_id,
                    agent_status,
                } => {
                    assert_eq!(*agent_status, None);
                    Some(pane_id.as_str())
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(pane_subscriptions, vec!["pane-1", "pane-2"]);
        assert_eq!(subscriptions.len(), pane_subscriptions.len());
    }

    #[test]
    fn activity_resubscribe_needed_compares_sorted_pane_sets() {
        let current = vec!["pane-1".to_string(), "pane-2".to_string()];

        assert!(!activity_resubscribe_needed(
            &current,
            &[test_pane("pane-2"), test_pane("pane-1")]
        ));
        assert!(activity_resubscribe_needed(
            &current,
            &[test_pane("pane-1"), test_pane("pane-3")]
        ));
        assert!(activity_resubscribe_needed(&current, &[]));
    }

    #[test]
    fn web_snapshot_adapter_preserves_web_shape_and_clear_name_flags() {
        let mut session_snapshot = test_session_snapshot();
        session_snapshot.panes[1].tokens.insert(
            crate::task_summary::TASK_SUMMARY_TOKEN.to_string(),
            "Reviewing the release checks".to_string(),
        );
        let snapshot =
            web_snapshot_from_session_snapshot(session_snapshot, Some("pane-2".to_string()));

        assert_eq!(snapshot.selected_pane_id.as_deref(), Some("pane-2"));
        assert_eq!(snapshot.workspaces.len(), 2);
        assert_eq!(snapshot.tabs.len(), 3);
        assert_eq!(snapshot.panes.len(), 4);
        assert_eq!(snapshot.layouts.len(), 3);
        let summarized_pane = snapshot
            .panes
            .iter()
            .find(|pane| pane.info.pane_id == "pane-2")
            .unwrap();
        assert_eq!(
            summarized_pane.task_summary.as_deref(),
            Some("Reviewing the release checks")
        );
        assert_eq!(
            serde_json::to_value(summarized_pane).unwrap()["task_summary"],
            "Reviewing the release checks"
        );

        let default_workspace = snapshot
            .workspaces
            .iter()
            .find(|workspace| workspace.info.workspace_id == "workspace-1")
            .unwrap();
        assert!(!default_workspace.can_clear_name);

        let renamed_workspace = snapshot
            .workspaces
            .iter()
            .find(|workspace| workspace.info.workspace_id == "workspace-2")
            .unwrap();
        assert!(renamed_workspace.can_clear_name);

        let default_tab = snapshot
            .tabs
            .iter()
            .find(|tab| tab.info.tab_id == "tab-1")
            .unwrap();
        assert!(!default_tab.can_clear_name);

        let renamed_tab = snapshot
            .tabs
            .iter()
            .find(|tab| tab.info.tab_id == "tab-2")
            .unwrap();
        assert!(renamed_tab.can_clear_name);

        let non_focused_split_layout = snapshot
            .layouts
            .iter()
            .find(|layout| layout.tab_id == "tab-2")
            .unwrap();
        assert_eq!(non_focused_split_layout.panes.len(), 2);
        assert_eq!(non_focused_split_layout.splits.len(), 1);
    }

    #[test]
    fn web_snapshot_adapter_falls_back_to_focused_pane_for_stale_selection() {
        let snapshot = web_snapshot_from_session_snapshot(
            test_session_snapshot(),
            Some("missing".to_string()),
        );

        assert_eq!(snapshot.selected_pane_id.as_deref(), Some("pane-1"));
    }

    #[test]
    fn web_snapshot_adapter_uses_focused_pane_before_shared_selection_exists() {
        let snapshot = web_snapshot_from_session_snapshot(test_session_snapshot(), None);

        assert_eq!(snapshot.selected_pane_id.as_deref(), Some("pane-1"));
    }

    #[test]
    fn structural_subscriptions_are_separate_from_activity_subscriptions() {
        let subscriptions = structural_event_subscriptions();

        assert!(subscriptions
            .iter()
            .any(|subscription| matches!(subscription, Subscription::WorkspaceCreated {})));
        assert!(subscriptions
            .iter()
            .any(|subscription| matches!(subscription, Subscription::PaneMoved {})));
        assert!(subscriptions
            .iter()
            .any(|subscription| matches!(subscription, Subscription::PaneUpdated {})));
        assert!(subscriptions
            .iter()
            .any(|subscription| matches!(subscription, Subscription::LayoutUpdated {})));
        assert!(subscriptions
            .iter()
            .any(|subscription| matches!(subscription, Subscription::WorkspaceMoved {})));
        assert!(subscriptions
            .iter()
            .any(|subscription| matches!(subscription, Subscription::WorkspaceReordered {})));
        assert!(subscriptions
            .iter()
            .any(|subscription| matches!(subscription, Subscription::TabMoved {})));
        assert!(!subscriptions.iter().any(|subscription| matches!(
            subscription,
            Subscription::PaneAgentStatusChanged { .. }
        )));
    }

    #[test]
    fn activity_message_decodes_and_serializes_explicit_nulls() {
        let message = activity_message_from_subscription_value(serde_json::json!({
            "event": "pane.agent_status_changed",
            "data": {
                "pane_id": "pane-1",
                "workspace_id": "workspace-1",
                "agent_status": "working",
                "agent": "codex",
                "state_labels": {}
            }
        }))
        .unwrap();

        assert_eq!(
            message,
            ActivityMessage::PaneAgentStatusChanged {
                pane_id: "pane-1".to_string(),
                workspace_id: "workspace-1".to_string(),
                agent_status: AgentStatus::Working,
                agent: Some("codex".to_string()),
                title: None,
                display_agent: None,
                state_labels: HashMap::new(),
            }
        );

        let json = serde_json::to_value(&message).unwrap();
        assert_eq!(json["title"], serde_json::Value::Null);
        assert_eq!(json["display_agent"], serde_json::Value::Null);
        assert_eq!(json["state_labels"], serde_json::json!({}));
        assert!(json.get("custom_status").is_none());
    }

    #[test]
    fn structural_event_values_trigger_activity_resubscribe() {
        assert!(is_structural_event_value(&serde_json::json!({
            "event": "pane.created",
            "data": { "pane_id": "pane-1" }
        })));
        assert!(is_structural_event_value(&serde_json::json!({
            "event": "pane.updated",
            "data": { "pane_id": "pane-1" }
        })));
        assert!(!is_structural_event_value(&serde_json::json!({
            "event": "pane.agent_status_changed",
            "data": { "pane_id": "pane-1" }
        })));
    }

    fn test_session_snapshot() -> SessionSnapshot {
        SessionSnapshot {
            version: "0.8.2".to_string(),
            protocol: PROTOCOL_VERSION,
            focused_workspace_id: Some("workspace-1".to_string()),
            focused_tab_id: Some("tab-1".to_string()),
            focused_pane_id: Some("pane-1".to_string()),
            workspaces: vec![
                test_workspace("workspace-1", 1, "repo", true, "tab-1", 3, 2),
                test_workspace("workspace-2", 2, "Custom", false, "tab-3", 1, 1),
            ],
            tabs: vec![
                test_tab("tab-1", "workspace-1", 1, "1", true, 1),
                test_tab("tab-2", "workspace-1", 2, "Review", false, 2),
                test_tab("tab-3", "workspace-2", 1, "1", false, 1),
            ],
            panes: vec![
                test_pane_in("pane-1", "workspace-1", "tab-1", "/tmp/repo", true),
                test_pane_in("pane-2", "workspace-1", "tab-2", "/tmp/repo", false),
                test_pane_in("pane-3", "workspace-2", "tab-3", "/tmp/space", false),
                test_pane_in("pane-4", "workspace-1", "tab-2", "/tmp/repo", false),
            ],
            layouts: vec![
                test_layout("workspace-1", "tab-1", &["pane-1"]),
                test_layout("workspace-1", "tab-2", &["pane-2", "pane-4"]),
                test_layout("workspace-2", "tab-3", &["pane-3"]),
            ],
            agents: Vec::new(),
        }
    }

    fn test_workspace(
        workspace_id: &str,
        number: usize,
        label: &str,
        focused: bool,
        active_tab_id: &str,
        pane_count: usize,
        tab_count: usize,
    ) -> WorkspaceInfo {
        WorkspaceInfo {
            workspace_id: workspace_id.to_string(),
            number,
            label: label.to_string(),
            focused,
            pane_count,
            tab_count,
            active_tab_id: active_tab_id.to_string(),
            agent_status: AgentStatus::Idle,
            tokens: HashMap::new(),
            worktree: None,
        }
    }

    fn test_tab(
        tab_id: &str,
        workspace_id: &str,
        number: usize,
        label: &str,
        focused: bool,
        pane_count: usize,
    ) -> TabInfo {
        TabInfo {
            tab_id: tab_id.to_string(),
            workspace_id: workspace_id.to_string(),
            number,
            label: label.to_string(),
            focused,
            pane_count,
            agent_status: AgentStatus::Idle,
        }
    }

    fn test_layout(workspace_id: &str, tab_id: &str, pane_ids: &[&str]) -> PaneLayoutSnapshot {
        let area = herdr_compat::api::schema::PaneLayoutRect {
            x: 0,
            y: 0,
            width: 120,
            height: 40,
        };
        PaneLayoutSnapshot {
            workspace_id: workspace_id.to_string(),
            tab_id: tab_id.to_string(),
            zoomed: false,
            area,
            focused_pane_id: pane_ids.first().unwrap_or(&"").to_string(),
            panes: pane_ids
                .iter()
                .enumerate()
                .map(
                    |(index, pane_id)| herdr_compat::api::schema::PaneLayoutPane {
                        pane_id: (*pane_id).to_string(),
                        focused: index == 0,
                        rect: herdr_compat::api::schema::PaneLayoutRect {
                            x: (index as u16) * 60,
                            y: 0,
                            width: 60,
                            height: 40,
                        },
                    },
                )
                .collect(),
            splits: if pane_ids.len() > 1 {
                vec![herdr_compat::api::schema::PaneLayoutSplit {
                    id: "root".to_string(),
                    direction: SplitDirection::Right,
                    ratio: 0.5,
                    rect: area,
                }]
            } else {
                Vec::new()
            },
        }
    }

    fn test_pane(pane_id: &str) -> PaneInfo {
        test_pane_in(pane_id, "workspace-1", "tab-1", "/tmp/repo", false)
    }

    fn test_pane_in(
        pane_id: &str,
        workspace_id: &str,
        tab_id: &str,
        cwd: &str,
        focused: bool,
    ) -> PaneInfo {
        PaneInfo {
            pane_id: pane_id.to_string(),
            terminal_id: format!("terminal-{pane_id}"),
            workspace_id: workspace_id.to_string(),
            tab_id: tab_id.to_string(),
            focused,
            cwd: Some(cwd.to_string()),
            foreground_cwd: Some(cwd.to_string()),
            label: None,
            agent: None,
            title: None,
            terminal_title: None,
            terminal_title_stripped: None,
            display_agent: None,
            agent_status: AgentStatus::Idle,
            state_labels: HashMap::new(),
            tokens: HashMap::new(),
            agent_session: None,
            scroll: None,
            revision: 1,
        }
    }

    #[test]
    fn request_gate_allows_same_origin_and_loopback_dev_proxy() {
        let policy = test_policy("127.0.0.1", 8787);
        assert!(request_allowed(
            &origin_headers("127.0.0.1:8787", None),
            &policy
        ));
        assert!(request_allowed(
            &origin_headers("127.0.0.1:8787", Some("http://127.0.0.1:8787")),
            &policy
        ));
        assert!(request_allowed(
            &origin_headers("127.0.0.1:5173", Some("http://127.0.0.1:5173")),
            &policy
        ));
    }

    #[test]
    fn access_candidates_keep_only_usable_machine_addresses() {
        let mut candidates = Vec::new();
        for value in [
            "127.0.0.1",
            "0.0.0.0",
            "fe80::1",
            "192.0.2.20",
            "192.0.2.20",
            "workstation.local.",
        ] {
            add_access_candidate(&mut candidates, value);
        }

        assert_eq!(candidates, ["192.0.2.20", "workstation.local"]);
    }

    #[test]
    fn request_gate_rejects_dns_rebinding_hosts() {
        let policy = RequestPolicy {
            bind_host: "0.0.0.0".to_string(),
            bind_port: 4000,
            allowed_hosts: vec!["192.0.2.10".to_string()],
            allowed_origins: vec!["http://192.0.2.10:4000".to_string()],
            allowed_connect_origins: Vec::new(),
            allowed_connect_sources: Vec::new(),
        };
        assert!(!request_allowed(
            &origin_headers("evil.example:4000", Some("http://evil.example:4000")),
            &policy
        ));
        assert!(request_allowed(
            &origin_headers("192.0.2.10:4000", Some("http://192.0.2.10:4000")),
            &policy
        ));
        assert!(!request_allowed(
            &origin_headers("192.0.2.10:8787", Some("http://192.0.2.10:8787")),
            &policy
        ));
    }

    #[test]
    fn remote_peer_cannot_turn_a_lan_request_into_local_access() {
        let policy = RequestPolicy {
            bind_host: "0.0.0.0".to_string(),
            bind_port: 4000,
            allowed_hosts: vec!["192.0.2.10".to_string()],
            allowed_origins: vec!["http://192.0.2.10:4000".to_string()],
            allowed_connect_origins: Vec::new(),
            allowed_connect_sources: Vec::new(),
        };
        let remote_peer = "192.0.2.55:51234".parse().unwrap();
        let localhost = origin_headers("localhost:4000", None);
        assert!(!request_allowed(&localhost, &policy));
        assert!(!request_allowed_from_peer(
            &localhost,
            &policy,
            Some(remote_peer)
        ));
        assert!(local_management_allowed(&localhost, &policy, remote_peer).is_err());
        let loopback_peer = "127.0.0.1:51234".parse().unwrap();
        assert!(request_allowed_from_peer(
            &localhost,
            &policy,
            Some(loopback_peer)
        ));
        assert!(local_management_allowed(&localhost, &policy, loopback_peer).is_ok());

        let mut forwarded = localhost.clone();
        forwarded.insert("x-forwarded-for", "127.0.0.1".parse().unwrap());
        assert!(!request_allowed_from_peer(
            &forwarded,
            &policy,
            Some(remote_peer)
        ));

        let accepted_host = origin_headers("192.0.2.10:4000", None);
        assert!(request_allowed(&accepted_host, &policy));
        assert!(local_management_allowed(&accepted_host, &policy, remote_peer).is_err());
        assert!(local_management_allowed(&accepted_host, &policy, loopback_peer).is_ok());

        let auth = BridgeAuth::new(Some("not-a-valid-password-hash".to_string()));
        assert!(!auth.request_is_authorized(&accepted_host, Some(remote_peer)));
        assert!(
            auth.request_is_authorized(&accepted_host, Some("127.0.0.1:51234".parse().unwrap()))
        );
    }

    #[tokio::test]
    async fn password_sessions_are_bounded_delayed_and_expire() {
        let auth = BridgeAuth::new(Some("not-a-valid-password-hash".to_string()));
        let peer = Some("192.0.2.55:51234".parse().unwrap());
        let oversized = "x".repeat(MAX_PASSWORD_BYTES + 1);
        assert_eq!(
            auth.issue_session(peer, &oversized).await,
            Err(AuthFailure::InvalidInput)
        );

        let started = std::time::Instant::now();
        assert_eq!(
            auth.issue_session(peer, "wrong").await,
            Err(AuthFailure::Rejected)
        );
        assert!(started.elapsed() >= AUTH_FAILURE_DELAY);
        for _ in 1..AUTH_FAILURE_LIMIT {
            assert_eq!(
                auth.issue_session(peer, "wrong").await,
                Err(AuthFailure::Rejected)
            );
        }
        assert_eq!(
            auth.issue_session(peer, "wrong").await,
            Err(AuthFailure::RateLimited)
        );

        let expired = "expired-token".to_string();
        auth.sessions
            .lock()
            .unwrap()
            .tokens
            .insert(expired.clone(), Instant::now() - Duration::from_secs(1));
        assert!(!auth.token_is_valid(&expired));
    }

    #[tokio::test]
    async fn cancelling_password_verification_cleans_pending_state_and_releases_capacity() {
        AUTH_TEST_VERIFICATION_STARTED.store(false, Ordering::Release);
        AUTH_TEST_VERIFICATION_PAUSE.store(true, Ordering::Release);
        let auth = Arc::new(BridgeAuth::new(Some(
            hash_password("synthetic-password").unwrap(),
        )));
        let peer = "192.0.2.56:51234".parse().unwrap();
        let task_auth = auth.clone();
        let task =
            tokio::spawn(
                async move { task_auth.issue_session(Some(peer), "wrong-password").await },
            );

        let mut verification_started = false;
        for _ in 0..100 {
            verification_started = AUTH_TEST_VERIFICATION_STARTED.load(Ordering::Acquire);
            if verification_started {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(
            verification_started,
            "password verification did not become in-flight"
        );
        task.abort();
        AUTH_TEST_VERIFICATION_PAUSE.store(false, Ordering::Release);
        let _ = task.await;

        for _ in 0..100 {
            let pending = auth.sessions.lock().unwrap().pending.len();
            if pending == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(auth.sessions.lock().unwrap().pending.is_empty());
        assert_eq!(
            auth.verification_slots.available_permits(),
            MAX_PASSWORD_VERIFICATIONS
        );
    }

    #[tokio::test]
    async fn password_session_transport_rejects_oversized_streams_before_body_extraction() {
        let handler_called = Arc::new(AtomicBool::new(false));
        let handler_called_for_route = handler_called.clone();
        let app = Router::new().route(
            "/api/auth/session",
            post(move |_: Bytes| async move {
                handler_called_for_route.store(true, Ordering::Release);
                StatusCode::OK
            })
            .layer(DefaultBodyLimit::max(MAX_PASSWORD_REQUEST_BYTES)),
        );
        let request = HttpRequest::builder()
            .method("POST")
            .uri("/api/auth/session")
            .header("content-type", "application/json")
            .body(Body::from(vec![b'x'; MAX_PASSWORD_REQUEST_BYTES + 1]))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();

        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert!(!handler_called.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn authentication_errors_keep_the_allowed_cross_origin_headers() {
        let policy = RequestPolicy {
            bind_host: "0.0.0.0".into(),
            bind_port: 4000,
            allowed_hosts: vec!["192.0.2.10".into()],
            allowed_origins: vec!["https://world.example.test".into()],
            allowed_connect_origins: Vec::new(),
            allowed_connect_sources: Vec::new(),
        };
        let app = Router::new()
            .route("/api/protected", get(|| async { unauthorized_response() }))
            .layer(middleware::from_fn_with_state(policy, add_security_headers));
        let request = HttpRequest::builder()
            .uri("/api/protected")
            .header(HOST, "192.0.2.10:4000")
            .header(ORIGIN, "https://world.example.test")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response
                .headers()
                .get(ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|value| value.to_str().ok()),
            Some("https://world.example.test")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn running_bridge_management_endpoint_hands_off_to_an_independent_controller() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "herdr-world-management-http-test-{}",
            CONTROLLER_TEMP_COUNTER.fetch_add(1, Ordering::AcqRel)
        ));
        let config_dir = root.join("config");
        let state_dir = root.join("state");
        let notes_dir = root.join("notes");
        let pins_dir = root.join("pins");
        let upload_dir = root.join("uploads");
        let controller = root.join("controller.sh");
        let marker = root.join("controller.marker");
        std::fs::create_dir_all(&config_dir).unwrap();
        std::fs::create_dir_all(&state_dir).unwrap();
        std::fs::write(
            &controller,
            format!("#!/bin/sh\nprintf '%s' \"$2\" > '{}'\n", marker.display()),
        )
        .unwrap();
        std::fs::set_permissions(&controller, std::fs::Permissions::from_mode(0o700)).unwrap();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let policy = RequestPolicy {
            bind_host: "127.0.0.1".into(),
            bind_port: address.port(),
            allowed_hosts: Vec::new(),
            allowed_origins: Vec::new(),
            allowed_connect_origins: Vec::new(),
            allowed_connect_sources: Vec::new(),
        };
        let (ui_event_tx, _) = tokio::sync::broadcast::channel(8);
        let (activity_tx, _) = tokio::sync::broadcast::channel(8);
        let state = BridgeState {
            api: ApiClient::for_socket_path(root.join("unused-herdr.sock")),
            client_socket_path: root.join("unused-client.sock"),
            request_policy: policy,
            auth: Arc::new(BridgeAuth::new(None)),
            management: ManagementState {
                config_path: Some(config_dir.join("config.json")),
                state_dir: Some(state_dir.clone()),
                controller_node: Some(PathBuf::from("/bin/sh")),
                controller_script: Some(controller),
                controller_mode: Some("fallback".into()),
                controller_launcher: None,
                mutation_reason: None,
            },
            terminal_sessions: Arc::new(Mutex::new(TerminalSessions::default())),
            selected_pane_id: Arc::new(Mutex::new(None)),
            agent_activity: Arc::new(AgentActivityManager::new()),
            agent_pins: Arc::new(AgentPinsManager::for_test(pins_dir, "session:test").unwrap()),
            launcher_presets: Arc::new(LauncherPresetStore::load(None).unwrap()),
            notes: Arc::new(NotesManager::for_test(notes_dir, "session:test").unwrap()),
            observability: ObservabilityState::unavailable(),
            ui_event_tx,
            activity_tx,
            upload_dir,
            herdr_version: "0.8.2".into(),
            terminal_protocol: PROTOCOL_VERSION,
            configured_label: None,
        };
        let server = tokio::spawn(
            axum::serve(
                listener,
                bridge_router(
                    state,
                    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../web"),
                )
                .into_make_service_with_connect_info::<SocketAddr>(),
            )
            .into_future(),
        );

        let response = reqwest::Client::new()
            .post(format!(
                "http://127.0.0.1:{}/api/local/remote-access",
                address.port()
            ))
            .header(HOST, format!("127.0.0.1:{}", address.port()))
            .json(&serde_json::json!({
                "remote_access": {
                    "enabled": true,
                    "accepted_hosts": ["198.51.100.20"],
                    "allowed_page_origins": ["https://world.example.test"],
                    "allowed_bridge_origins": []
                },
                "password_action": "keep"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);

        for _ in 0..40 {
            if marker.is_file() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert!(marker.is_file(), "controller did not receive the handoff");
        let request_path = std::fs::read_to_string(&marker).unwrap();
        let request = serde_json::from_str::<serde_json::Value>(
            &std::fs::read_to_string(request_path).unwrap(),
        )
        .unwrap();
        assert_eq!(request["remote_access"]["enabled"], true);

        server.abort();
        let _ = server.await;
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn fallback_management_controller_has_an_independent_process_group() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "herdr-world-controller-test-{}",
            CONTROLLER_TEMP_COUNTER.fetch_add(1, Ordering::AcqRel)
        ));
        std::fs::create_dir_all(&root).unwrap();
        let controller = root.join("controller.sh");
        let marker = root.join("process-group");
        let request = root.join("request.json");
        std::fs::write(
            &controller,
            format!(
                "#!/bin/sh\nps -o pgid= -p $$ | tr -d ' ' > {}\nprintf '%s' \"$2\" > {}\n",
                marker.display(),
                request.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&controller, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(&request, "{}").unwrap();
        let management = ManagementState {
            config_path: None,
            state_dir: None,
            controller_node: Some(PathBuf::from("/bin/sh")),
            controller_script: Some(controller),
            controller_mode: Some("fallback".into()),
            controller_launcher: None,
            mutation_reason: None,
        };

        spawn_management_controller(&management, &request).unwrap();
        let mut process_group = String::new();
        for _ in 0..200 {
            process_group = std::fs::read_to_string(&marker).unwrap_or_default();
            if !process_group.trim().is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let parent_group = unsafe { libc::getpgrp() }.to_string();
        assert!(!process_group.trim().is_empty());
        assert_ne!(process_group.trim(), parent_group);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn protected_route_inventory_keeps_only_negotiation_bootstrap_public() {
        assert!(is_public_bootstrap_path("/api/capabilities"));
        assert!(is_public_bootstrap_path("/api/auth/status"));
        assert!(is_public_bootstrap_path("/api/auth/session"));
        assert!(is_public_bootstrap_path("/api/local/remote-access"));
        for path in [
            "/api/snapshot",
            "/api/command",
            "/api/uploads",
            "/api/observability/health",
            "/ws/events",
            "/ws/activity",
            "/ws/ui-events",
            "/ws/terminal",
            "/ws/extensions/observability",
        ] {
            assert!(
                !is_public_bootstrap_path(path),
                "{path} must require authentication"
            );
        }
    }

    #[test]
    fn request_gate_rejects_cross_site_browser_origins() {
        let policy = test_policy("127.0.0.1", 8787);
        assert!(!request_allowed(
            &origin_headers("127.0.0.1:8787", Some("https://example.com")),
            &policy
        ));
        assert!(!request_allowed(
            &origin_headers("192.0.2.10:8787", Some("http://127.0.0.1:5173")),
            &policy
        ));
        assert!(!request_allowed(
            &origin_headers("127.0.0.1:8787", Some("null")),
            &policy
        ));
    }

    #[test]
    fn request_gate_allows_same_origin_and_configured_android_origin() {
        let policy = RequestPolicy {
            bind_host: "0.0.0.0".to_string(),
            bind_port: 4000,
            allowed_hosts: vec!["192.0.2.10".to_string()],
            allowed_origins: vec!["http://localhost".to_string()],
            allowed_connect_origins: Vec::new(),
            allowed_connect_sources: Vec::new(),
        };
        assert!(request_allowed(
            &origin_headers("192.0.2.10:4000", Some("http://localhost")),
            &policy
        ));
        assert!(request_allowed(
            &origin_headers("192.0.2.10:4000", Some("http://192.0.2.10:4000")),
            &policy
        ));
        assert!(!request_allowed(
            &origin_headers("192.0.2.10:4000", Some("https://example.com")),
            &policy
        ));
    }

    #[test]
    fn origin_gate_allows_same_origin_and_loopback_dev_proxy() {
        let policy = test_policy("127.0.0.1", 8787);
        assert!(request_origin_allowed(
            &origin_headers("127.0.0.1:8787", None),
            &policy
        ));
        assert!(request_origin_allowed(
            &origin_headers("127.0.0.1:8787", Some("http://127.0.0.1:8787")),
            &policy
        ));
        assert!(request_origin_allowed(
            &origin_headers("127.0.0.1:8787", Some("http://127.0.0.1:5173")),
            &policy
        ));
    }

    #[test]
    fn origin_gate_rejects_cross_site_browser_origins() {
        let policy = test_policy("127.0.0.1", 8787);
        assert!(!request_origin_allowed(
            &origin_headers("127.0.0.1:8787", Some("https://example.com")),
            &policy
        ));
        assert!(!request_origin_allowed(
            &origin_headers("192.0.2.10:8787", Some("http://127.0.0.1:5173")),
            &policy
        ));
        assert!(!request_origin_allowed(
            &origin_headers("127.0.0.1:8787", Some("null")),
            &policy
        ));
    }

    #[test]
    fn host_gate_accepts_exact_loopback_and_ip_literal_binds() {
        let loopback = test_policy("127.0.0.1", 8787);
        assert!(host_authority_allowed("localhost:5173", &loopback));
        assert!(host_authority_allowed("127.0.0.1:8787", &loopback));
        assert!(!host_authority_allowed("127.0.0.2:8787", &loopback));

        let lan = RequestPolicy {
            bind_host: "0.0.0.0".to_string(),
            bind_port: 4000,
            allowed_hosts: vec!["192.0.2.10".to_string()],
            allowed_origins: vec!["http://192.0.2.10:4000".to_string()],
            allowed_connect_origins: Vec::new(),
            allowed_connect_sources: Vec::new(),
        };
        assert!(host_authority_allowed("192.0.2.10:4000", &lan));
        assert!(!host_authority_allowed("[::1]:5173", &lan));
        assert!(!host_authority_allowed("evil.example:4000", &lan));
    }

    #[test]
    fn host_gate_accepts_configured_hostname_only_on_bridge_port() {
        let policy = RequestPolicy {
            bind_host: "0.0.0.0".to_string(),
            bind_port: 4000,
            allowed_hosts: vec!["herdr-host.local".to_string()],
            allowed_origins: Vec::new(),
            allowed_connect_origins: Vec::new(),
            allowed_connect_sources: Vec::new(),
        };
        assert!(host_authority_allowed("herdr-host.local:4000", &policy));
        assert!(host_authority_allowed("HERDR-HOST.LOCAL:4000", &policy));
        assert!(!host_authority_allowed("herdr-host.local:8787", &policy));
        assert!(!host_authority_allowed("evil.example:4000", &policy));
    }

    #[test]
    fn cors_headers_reflect_only_allowed_origins() {
        let policy = RequestPolicy {
            bind_host: "0.0.0.0".to_string(),
            bind_port: 4000,
            allowed_hosts: vec!["192.0.2.10".to_string()],
            allowed_origins: vec!["http://localhost".to_string()],
            allowed_connect_origins: Vec::new(),
            allowed_connect_sources: Vec::new(),
        };
        assert_eq!(
            cors_origin_header(
                &origin_headers("192.0.2.10:4000", Some("http://localhost")),
                &policy
            )
            .and_then(|value| value.to_str().ok().map(str::to_string)),
            Some("http://localhost".to_string())
        );
        assert!(cors_origin_header(
            &origin_headers("192.0.2.10:4000", Some("https://example.com")),
            &policy
        )
        .is_none());
    }

    #[test]
    fn cors_headers_preserve_preflight_requested_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(
            ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("content-type, authorization"),
        );

        insert_cors_headers(&mut headers, HeaderValue::from_static("http://localhost"));

        assert_eq!(
            headers
                .get(ACCESS_CONTROL_ALLOW_HEADERS)
                .and_then(|value| value.to_str().ok()),
            Some("content-type, authorization")
        );
    }

    #[test]
    fn connect_origins_expand_to_http_and_websocket_csp_sources() {
        assert_eq!(
            connect_sources_for_origin("HTTP://SRV:8787").unwrap(),
            vec!["http://srv:8787".to_string(), "ws://srv:8787".to_string()]
        );
        assert_eq!(
            connect_sources_for_origin("https://srv.example:9443").unwrap(),
            vec![
                "https://srv.example:9443".to_string(),
                "wss://srv.example:9443".to_string()
            ]
        );
        assert!(connect_sources_for_origin("ws://srv:8787").is_err());
        assert!(connect_sources_for_origin("http://srv:8787/path").is_err());
    }

    #[test]
    fn content_security_policy_includes_configured_connect_sources() {
        let mut policy = test_policy("0.0.0.0", 8787);
        policy.allowed_connect_sources = connect_sources_for_origin("http://srv:8787").unwrap();

        let header = content_security_policy(&policy);
        let value = header.to_str().unwrap();

        assert!(value.contains("connect-src 'self' data: http://srv:8787 ws://srv:8787;"));
        assert!(value.contains("img-src 'self' data: blob:;"));
        assert!(value.contains("frame-ancestors 'none'"));
    }

    #[test]
    fn validates_narrow_workspace_and_tab_create_commands() {
        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "workspace.create",
            "params": {
                "focus": true
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "workspace.create",
            "params": {
                "focus": true,
                "cwd": "/tmp",
                "env": { "X": "1" }
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "tab.create",
            "params": {
                "workspace_id": "w1",
                "focus": true,
                "label": "Codex"
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "tab.create",
            "params": {
                "workspace_id": "w1",
                "focus": true,
                "cwd": "/tmp",
                "env": { "X": "1" }
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());
    }

    #[test]
    fn validates_atomic_workspace_reorder_commands() {
        let valid: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "workspace.move_block",
            "params": {
                "workspace_ids": ["w1", "w1-child"],
                "before_workspace_id": "w3"
            }
        }))
        .unwrap();
        assert!(validate_web_command(&valid.method).is_ok());

        for params in [
            serde_json::json!({ "workspace_ids": [] }),
            serde_json::json!({ "workspace_ids": ["w1", "w1"] }),
            serde_json::json!({ "workspace_ids": [""] }),
            serde_json::json!({
                "workspace_ids": ["w1"],
                "before_workspace_id": "w1"
            }),
        ] {
            let invalid: Request = serde_json::from_value(serde_json::json!({
                "id": "test",
                "method": "workspace.move_block",
                "params": params
            }))
            .unwrap();
            assert!(validate_web_command(&invalid.method).is_err());
        }
    }

    #[test]
    fn validates_narrow_workspace_and_tab_rename_commands() {
        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "workspace.rename",
            "params": {
                "workspace_id": "w1",
                "label": null
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "tab.rename",
            "params": {
                "tab_id": "w1:t1",
                "label": "Review"
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "tab.rename",
            "params": {
                "tab_id": "w1:t1",
                "label": "   "
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());
    }

    #[test]
    fn clear_name_rename_substitution_uses_default_labels() {
        let panes = [test_pane_in(
            "pane-1",
            "workspace-1",
            "tab-1",
            "/tmp/herdr",
            true,
        )];
        let tabs = [test_tab("tab-2", "workspace-1", 2, "Review", false, 1)];

        let mut workspace_method =
            Method::WorkspaceRename(herdr_compat::api::schema::WorkspaceRenameParams {
                workspace_id: "workspace-1".to_string(),
                label: None,
            });
        fill_clear_rename_labels_with(
            &mut workspace_method,
            |workspace_id| {
                Ok(default_workspace_label_from_panes(
                    workspace_id,
                    panes.iter(),
                ))
            },
            |tab_id| default_tab_label_from_tabs(tab_id, tabs.iter()),
        )
        .unwrap();
        let Method::WorkspaceRename(workspace_params) = workspace_method else {
            panic!("expected workspace rename");
        };
        assert_eq!(workspace_params.label.as_deref(), Some("herdr"));

        let mut tab_method = Method::TabRename(herdr_compat::api::schema::TabRenameParams {
            tab_id: "tab-2".to_string(),
            label: None,
        });
        fill_clear_rename_labels_with(
            &mut tab_method,
            |workspace_id| {
                Ok(default_workspace_label_from_panes(
                    workspace_id,
                    panes.iter(),
                ))
            },
            |tab_id| default_tab_label_from_tabs(tab_id, tabs.iter()),
        )
        .unwrap();
        let Method::TabRename(tab_params) = tab_method else {
            panic!("expected tab rename");
        };
        assert_eq!(tab_params.label.as_deref(), Some("2"));

        let mut named_method = Method::TabRename(herdr_compat::api::schema::TabRenameParams {
            tab_id: "tab-2".to_string(),
            label: Some("Keep".to_string()),
        });
        fill_clear_rename_labels_with(
            &mut named_method,
            |_| panic!("workspace default should not be requested"),
            |_| panic!("tab default should not be requested"),
        )
        .unwrap();
        let Method::TabRename(named_params) = named_method else {
            panic!("expected tab rename");
        };
        assert_eq!(named_params.label.as_deref(), Some("Keep"));
    }

    #[test]
    fn validates_narrow_pane_splits() {
        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.split",
            "params": {
                "target_pane_id": "1-1",
                "direction": "down",
                "focus": true
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.split",
            "params": {
                "target_pane_id": "1-1",
                "direction": "down",
                "cwd": "/tmp",
                "env": { "X": "1" }
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());
    }

    #[test]
    fn validates_narrow_pane_moves() {
        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.move",
            "params": {
                "pane_id": "w1:p1",
                "destination": {
                    "type": "new_tab",
                    "workspace_id": "w1",
                    "label": "Moved"
                },
                "focus": true
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.move",
            "params": {
                "pane_id": "w1:p1",
                "destination": {
                    "type": "new_workspace",
                    "label": "Moved",
                    "tab_label": "Pane"
                },
                "focus": true
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.move",
            "params": {
                "pane_id": "w1:p1",
                "destination": {
                    "type": "tab",
                    "tab_id": "w1:t2",
                    "target_pane_id": "w1:p2",
                    "split": "right"
                },
                "focus": true
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.move",
            "params": {
                "pane_id": "w1:p1",
                "destination": {
                    "type": "new_tab",
                    "workspace_id": "w1"
                },
                "focus": false
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());
    }

    #[test]
    fn command_request_parses_into_wire_request() {
        let body: CommandRequest = serde_json::from_str(
            r#"{"method":"workspace.rename","params":{"workspace_id":"w1","label":"api"}}"#,
        )
        .unwrap();
        let request_value = serde_json::json!({
            "id": "test",
            "method": body.method,
            "params": body.params,
        });
        let request: Request = serde_json::from_value(request_value).unwrap();
        assert!(matches!(request.method, Method::WorkspaceRename(_)));
    }

    #[test]
    fn loopback_host_detection_warns_for_network_binds() {
        assert!(is_loopback_bind_host("127.0.0.1"));
        assert!(is_loopback_bind_host("localhost"));
        assert!(!is_loopback_bind_host("0.0.0.0"));
        assert!(!is_loopback_bind_host("192.0.2.10"));
    }

    #[test]
    fn ipv6_listener_bind_address_uses_a_real_ipv6_socket_authority() {
        assert_eq!(listener_bind_address("::", 8787), "[::]:8787");
        assert_eq!(listener_bind_address("[::1]", 8787), "[::1]:8787");
        assert_eq!(listener_bind_address("192.0.2.10", 8787), "192.0.2.10:8787");

        if let Ok(listener) = std::net::TcpListener::bind(listener_bind_address("::1", 0)) {
            assert!(listener
                .local_addr()
                .expect("IPv6 listener address")
                .is_ipv6());
        }
    }

    #[tokio::test]
    async fn mixed_ip_profiles_request_dual_family_listeners_and_map_loopback_peers() {
        assert!(dual_family_listener_required(
            "0.0.0.0",
            &["2001:db8::20".to_string()]
        ));
        assert!(dual_family_listener_required(
            "::",
            &["192.0.2.20".to_string()]
        ));
        assert!(!dual_family_listener_required(
            "0.0.0.0",
            &["192.0.2.20".to_string()]
        ));
        assert!(peer_is_loopback(
            "[::ffff:127.0.0.1]:51234".parse().unwrap()
        ));
        if let Ok(ipv4_listener) = std::net::TcpListener::bind("0.0.0.0:0") {
            let port = ipv4_listener.local_addr().unwrap().port();
            if let Ok(ipv6_listener) = bind_ipv6_only_listener(port) {
                assert_eq!(ipv6_listener.local_addr().unwrap().port(), port);
                assert!(ipv6_listener.local_addr().unwrap().is_ipv6());
            }
        }
    }

    #[test]
    fn daemon_status_accepts_minimum_version_and_exact_protocol() {
        assert_eq!(
            validated_daemon_protocol(runtime_status("0.8.2", PROTOCOL_VERSION)).unwrap(),
            PROTOCOL_VERSION
        );
        assert_eq!(
            validated_daemon_protocol(runtime_status("1.0.0", PROTOCOL_VERSION)).unwrap(),
            PROTOCOL_VERSION
        );
    }

    #[test]
    fn daemon_status_rejects_missing_or_invalid_version() {
        let missing = herdr_compat::api::RuntimeStatus {
            version: None,
            protocol: Some(PROTOCOL_VERSION),
            capabilities: None,
        };
        assert!(validated_daemon_protocol(missing)
            .unwrap_err()
            .to_string()
            .contains("did not include a version"));

        let invalid = runtime_status("not-a-version", PROTOCOL_VERSION);
        assert!(validated_daemon_protocol(invalid)
            .unwrap_err()
            .to_string()
            .contains("invalid version"));

        for version in [
            "0.8.2-preview",
            "0.8.2.1",
            "0.8.2+",
            "0.8.2+bad_meta",
            "0.08.2",
        ] {
            let error = validated_daemon_protocol(runtime_status(version, PROTOCOL_VERSION))
                .unwrap_err()
                .to_string();
            assert!(
                error.contains("invalid version"),
                "{version:?} should be rejected as invalid: {error}"
            );
        }
    }

    #[test]
    fn daemon_status_accepts_version_prefix_and_build_metadata() {
        for version in ["v0.8.2", "0.8.2+linux-x86-64"] {
            assert_eq!(
                validated_daemon_protocol(runtime_status(version, PROTOCOL_VERSION)).unwrap(),
                PROTOCOL_VERSION
            );
        }
    }

    #[test]
    fn daemon_status_rejects_version_before_0_8_2() {
        let error = validated_daemon_protocol(runtime_status("0.8.1", PROTOCOL_VERSION))
            .unwrap_err()
            .to_string();
        assert!(error.contains("too old"));
        assert!(error.contains(MIN_HERDR_VERSION_LABEL));
    }

    #[test]
    fn daemon_status_rejects_missing_protocol() {
        let missing = herdr_compat::api::RuntimeStatus {
            version: Some(MIN_HERDR_VERSION_LABEL.to_string()),
            protocol: None,
            capabilities: None,
        };
        assert!(validated_daemon_protocol(missing)
            .unwrap_err()
            .to_string()
            .contains("did not include a protocol"));
    }

    #[test]
    fn daemon_status_rejects_any_other_protocol() {
        let older = validated_daemon_protocol(runtime_status("0.8.2", 19))
            .unwrap_err()
            .to_string();
        assert!(older.contains("incompatible"));
        assert!(older.contains(&PROTOCOL_VERSION.to_string()));

        assert!(validated_daemon_protocol(runtime_status("0.8.2", 21))
            .unwrap_err()
            .to_string()
            .contains("incompatible"));
    }

    #[test]
    fn daemon_admission_diagnostics_are_bounded_and_name_the_supported_baseline() {
        let invalid_version = "v".to_string() + &"9".repeat(10_000);
        let error = validated_daemon_protocol(runtime_status(&invalid_version, 20))
            .unwrap_err()
            .to_string();
        assert!(error.len() < 256);
        assert!(error.contains("Herdr 0.8.2 or newer"));
        assert!(error.contains("protocol 20"));
        assert!(!error.contains(&invalid_version));

        let missing_protocol = herdr_compat::api::RuntimeStatus {
            version: Some("0.8.2".into()),
            protocol: None,
            capabilities: None,
        };
        let error = validated_daemon_protocol(missing_protocol)
            .unwrap_err()
            .to_string();
        assert!(error.contains("Herdr 0.8.2 or newer"));
        assert!(error.contains("protocol 20"));
    }

    #[test]
    fn validates_launcher_preset_titles() {
        assert_eq!(
            resolve_launch_title(Some("  Custom  "), "Fallback").unwrap(),
            "Custom"
        );
        assert_eq!(
            resolve_launch_title(Some("   "), "Fallback").unwrap(),
            "Fallback"
        );
        assert!(resolve_launch_title(Some("bad\0title"), "Fallback").is_err());
        assert!(resolve_launch_title(Some(&"x".repeat(MAX_LABEL_BYTES + 1)), "Fallback").is_err());
    }

    #[test]
    fn malformed_launcher_preset_launch_payloads_are_invalid_preset_launch() {
        let err = parse_launcher_preset_launch_request(
            br#"{"preset_id":"remote","target":{"mode":"unknown"}}"#,
        )
        .unwrap_err();
        assert_eq!(err.status, StatusCode::BAD_REQUEST);
        assert_eq!(err.code, "invalid_preset_launch");
    }

    #[test]
    fn managed_agent_launch_calls_create_rename_then_start() {
        let pane = launcher_test_pane("pane-new", "workspace-1", "tab-new");
        let tab = launcher_test_tab("tab-new", "workspace-1");
        let name = managed_agent_name(ManagedAgentKind::Codex, "pane-new");
        let mut pending = launcher_test_agent("pane-new", "workspace-1", "tab-new");
        pending.name = Some(name.clone());
        pending.agent = None;
        let mut ready = pending.clone();
        ready.agent = Some("codex".into());
        ready.launch_pending = false;
        ready.interactive_ready = true;
        let mut api = MockLauncherApi::new([
            Ok(ResponseResult::TabCreated {
                tab,
                root_pane: pane,
            }),
            Ok(ResponseResult::Ok {}),
            Ok(ResponseResult::AgentStarted {
                agent: pending,
                argv: vec!["codex".into()],
            }),
            Ok(ResponseResult::AgentInfo { agent: ready }),
        ]);
        let preset = launcher_test_managed_preset(ManagedAgentKind::Codex);

        let response = launch_preset_with(
            &mut api,
            &preset,
            "Review",
            LauncherPresetLaunchTarget::Tab {
                workspace_id: "workspace-1".into(),
            },
        )
        .unwrap();

        assert_eq!(response.pane_id, "pane-new");
        assert!(matches!(api.requests[0], Method::TabCreate(_)));
        assert!(matches!(api.requests[1], Method::PaneRename(_)));
        let Method::AgentStart(params) = &api.requests[2] else {
            panic!("expected agent.start");
        };
        assert_eq!(params.kind, "codex");
        assert_eq!(params.pane_id, "pane-new");
        assert!(params.args.is_empty());
        assert_eq!(params.timeout_ms, None);
        assert!(valid_managed_agent_name(&params.name));
        let Method::AgentGet(params) = &api.requests[3] else {
            panic!("expected readiness poll");
        };
        assert_eq!(params.target, name);
        assert_eq!(api.requests.len(), 4);
        assert_eq!(api.waits, vec![MANAGED_AGENT_SHELL_SETTLE_DELAY]);
    }

    #[test]
    fn managed_agent_launch_waits_for_new_shell_before_retrying_start() {
        let pane = launcher_test_pane("pane-new", "workspace-1", "tab-new");
        let tab = launcher_test_tab("tab-new", "workspace-1");
        let name = managed_agent_name(ManagedAgentKind::Claude, "pane-new");
        let mut pending = launcher_test_agent("pane-new", "workspace-1", "tab-new");
        pending.name = Some(name);
        pending.agent = None;
        let mut ready = pending.clone();
        ready.agent = Some("claude".into());
        ready.launch_pending = false;
        ready.interactive_ready = true;
        let mut api = MockLauncherApi::new([
            Ok(ResponseResult::TabCreated {
                tab,
                root_pane: pane,
            }),
            Ok(ResponseResult::Ok {}),
            Err(LauncherPresetError::from_herdr_error(
                "agent_pane_busy".into(),
                "agent target pane pane-new is not an available shell".into(),
            )),
            Err(LauncherPresetError::from_herdr_error(
                "agent_pane_busy".into(),
                "agent target pane pane-new is not an available shell".into(),
            )),
            Err(LauncherPresetError::from_herdr_error(
                "agent_pane_busy".into(),
                "agent target pane pane-new is not an available shell".into(),
            )),
            Ok(ResponseResult::AgentStarted {
                agent: pending,
                argv: vec!["claude".into()],
            }),
            Ok(ResponseResult::AgentInfo { agent: ready }),
        ]);
        let preset = launcher_test_managed_preset(ManagedAgentKind::Claude);

        let response = launch_preset_with(
            &mut api,
            &preset,
            "Claude",
            LauncherPresetLaunchTarget::Tab {
                workspace_id: "workspace-1".into(),
            },
        )
        .unwrap();

        assert_eq!(response.pane_id, "pane-new");
        assert_eq!(
            api.requests
                .iter()
                .filter(|request| matches!(request, Method::AgentStart(_)))
                .count(),
            4
        );
        assert_eq!(
            api.waits,
            vec![
                MANAGED_AGENT_SHELL_SETTLE_DELAY,
                MANAGED_AGENT_SHELL_RETRY_INITIAL_DELAY,
                Duration::from_millis(900),
                Duration::from_millis(1700),
            ]
        );
    }

    #[test]
    fn generated_managed_agent_names_are_safe_bounded_and_pane_specific() {
        let first = managed_agent_name(ManagedAgentKind::OpenCode, "pane/ONE:🔥");
        let second = managed_agent_name(ManagedAgentKind::OpenCode, "pane/TWO:🔥");

        assert!(valid_managed_agent_name(&first));
        assert!(valid_managed_agent_name(&second));
        assert_ne!(first, second);
        assert!(first.starts_with("web-opencode-"));
    }

    #[test]
    fn failed_rename_rolls_back_the_created_tab() {
        let pane = launcher_test_pane("pane-new", "workspace-1", "tab-new");
        let tab = launcher_test_tab("tab-new", "workspace-1");
        let mut api = MockLauncherApi::new([
            Ok(ResponseResult::TabCreated {
                tab,
                root_pane: pane,
            }),
            Err(LauncherPresetError::launch_failed("rename failed")),
            Ok(ResponseResult::Ok {}),
        ]);
        let preset = launcher_test_managed_preset(ManagedAgentKind::Claude);

        let error = launch_preset_with(
            &mut api,
            &preset,
            "Claude",
            LauncherPresetLaunchTarget::Tab {
                workspace_id: "workspace-1".into(),
            },
        )
        .unwrap_err();

        assert_eq!(error.message, "rename failed");
        assert!(matches!(api.requests[0], Method::TabCreate(_)));
        assert!(matches!(api.requests[1], Method::PaneRename(_)));
        let Method::TabClose(params) = &api.requests[2] else {
            panic!("expected tab.close rollback");
        };
        assert_eq!(params.tab_id, "tab-new");
    }

    #[test]
    fn failed_agent_start_rolls_back_split_and_preserves_error_if_cleanup_fails() {
        let pane = launcher_test_pane("pane-new", "workspace-1", "tab-1");
        let mut api = MockLauncherApi::new([
            Ok(ResponseResult::PaneInfo { pane }),
            Ok(ResponseResult::Ok {}),
            Err(LauncherPresetError::launch_failed("agent start failed")),
            Err(LauncherPresetError::launch_failed("cleanup failed")),
        ]);
        let preset = launcher_test_managed_preset(ManagedAgentKind::Pi);

        let error = launch_preset_with(
            &mut api,
            &preset,
            "pi",
            LauncherPresetLaunchTarget::Split {
                tab_id: "tab-1".into(),
                target_pane_id: "pane-old".into(),
                direction: SplitDirection::Right,
            },
        )
        .unwrap_err();

        assert_eq!(error.message, "agent start failed");
        assert!(matches!(api.requests[0], Method::PaneSplit(_)));
        assert!(matches!(api.requests[1], Method::PaneRename(_)));
        assert!(matches!(api.requests[2], Method::AgentStart(_)));
        let Method::PaneClose(params) = &api.requests[3] else {
            panic!("expected pane.close rollback");
        };
        assert_eq!(params.pane_id, "pane-new");
    }

    #[test]
    fn managed_agent_process_exit_rolls_back_after_start_acknowledgement() {
        let pane = launcher_test_pane("pane-new", "workspace-1", "tab-new");
        let tab = launcher_test_tab("tab-new", "workspace-1");
        let name = managed_agent_name(ManagedAgentKind::Claude, "pane-new");
        let mut pending = launcher_test_agent("pane-new", "workspace-1", "tab-new");
        pending.name = Some(name);
        pending.agent = None;
        let mut failed = pending.clone();
        failed.launch_pending = false;
        let mut api = MockLauncherApi::new([
            Ok(ResponseResult::TabCreated {
                tab,
                root_pane: pane,
            }),
            Ok(ResponseResult::Ok {}),
            Ok(ResponseResult::AgentStarted {
                agent: pending,
                argv: vec!["claude".into()],
            }),
            Ok(ResponseResult::AgentInfo { agent: failed }),
            Ok(ResponseResult::Ok {}),
        ]);
        let preset = launcher_test_managed_preset(ManagedAgentKind::Claude);

        let error = launch_preset_with(
            &mut api,
            &preset,
            "Claude",
            LauncherPresetLaunchTarget::Tab {
                workspace_id: "workspace-1".into(),
            },
        )
        .unwrap_err();

        assert!(error.message.contains("exited before becoming interactive"));
        assert!(matches!(api.requests[3], Method::AgentGet(_)));
        let Method::TabClose(params) = &api.requests[4] else {
            panic!("expected tab.close rollback");
        };
        assert_eq!(params.tab_id, "tab-new");
    }

    struct MockLauncherApi {
        results: std::collections::VecDeque<Result<ResponseResult, LauncherPresetError>>,
        requests: Vec<Method>,
        waits: Vec<Duration>,
        clock: std::time::Instant,
    }

    impl MockLauncherApi {
        fn new(
            results: impl IntoIterator<Item = Result<ResponseResult, LauncherPresetError>>,
        ) -> Self {
            Self {
                results: results.into_iter().collect(),
                requests: Vec::new(),
                waits: Vec::new(),
                clock: std::time::Instant::now(),
            }
        }
    }

    impl LauncherApiRequest for MockLauncherApi {
        fn request(
            &mut self,
            _id: &str,
            method: Method,
        ) -> Result<ResponseResult, LauncherPresetError> {
            self.requests.push(method);
            self.results
                .pop_front()
                .expect("mock launcher response missing")
        }

        fn now(&self) -> std::time::Instant {
            self.clock
        }

        fn wait(&mut self, duration: Duration) {
            self.waits.push(duration);
            self.clock += duration;
        }
    }

    fn launcher_test_managed_preset(kind: ManagedAgentKind) -> ResolvedLauncherPreset {
        ResolvedLauncherPreset {
            id: format!("builtin:{}", kind.as_str()),
            label: kind.as_str().to_string(),
            launch: LauncherPresetLaunch::ManagedAgent {
                kind,
                args: Vec::new(),
            },
            built_in: true,
        }
    }

    fn launcher_test_tab(tab_id: &str, workspace_id: &str) -> TabInfo {
        TabInfo {
            tab_id: tab_id.into(),
            workspace_id: workspace_id.into(),
            number: 1,
            label: "Tab".into(),
            focused: true,
            pane_count: 1,
            agent_status: AgentStatus::Idle,
        }
    }

    fn launcher_test_pane(pane_id: &str, workspace_id: &str, tab_id: &str) -> PaneInfo {
        PaneInfo {
            pane_id: pane_id.into(),
            terminal_id: format!("terminal-{pane_id}"),
            workspace_id: workspace_id.into(),
            tab_id: tab_id.into(),
            focused: true,
            cwd: None,
            foreground_cwd: None,
            label: None,
            agent: None,
            title: None,
            terminal_title: None,
            terminal_title_stripped: None,
            display_agent: None,
            agent_status: AgentStatus::Idle,
            state_labels: HashMap::new(),
            tokens: HashMap::new(),
            agent_session: None,
            scroll: None,
            revision: 1,
        }
    }

    fn launcher_test_agent(
        pane_id: &str,
        workspace_id: &str,
        tab_id: &str,
    ) -> herdr_compat::api::schema::AgentInfo {
        herdr_compat::api::schema::AgentInfo {
            terminal_id: format!("terminal-{pane_id}"),
            name: None,
            agent: Some("codex".into()),
            title: None,
            terminal_title: None,
            terminal_title_stripped: None,
            display_agent: None,
            agent_status: AgentStatus::Working,
            screen_detection_skipped: false,
            state_labels: HashMap::new(),
            tokens: HashMap::new(),
            agent_session: None,
            workspace_id: workspace_id.into(),
            tab_id: tab_id.into(),
            pane_id: pane_id.into(),
            focused: true,
            launch_pending: true,
            interactive_ready: false,
            state_change_seq: 1,
            cwd: None,
            foreground_cwd: None,
            revision: 1,
        }
    }

    fn valid_managed_agent_name(name: &str) -> bool {
        let mut chars = name.chars();
        matches!(chars.next(), Some('a'..='z'))
            && name.len() <= 32
            && chars
                .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '-' | '_'))
    }

    #[test]
    fn startup_daemon_error_maps_reachable_status_failures_to_actionable_io_error() {
        let err = BridgeError::from(ApiClientError::UnexpectedResult(
            "WorkspaceList".to_string(),
        ));
        let io_err = startup_daemon_error(err);

        assert_eq!(io_err.kind(), ErrorKind::ConnectionRefused);
        let message = io_err.to_string();
        assert!(message.contains("unable to start Herdr World bridge"));
        assert!(message.contains("unexpected api result"));
        assert!(message.contains("Install, update, or start Herdr v0.8.2 or newer"));
        assert!(message.contains("consent-based setup"));
        assert!(message.contains("--session NAME or HERDR_SOCKET_PATH"));
    }

    #[test]
    fn help_text_is_bridge_specific() {
        let help = help_text();

        assert!(help.contains("herdr-world-bridge"));
        assert!(help.contains("Usage: herdr-world-bridge"));
        assert!(help.contains("--session NAME"));
        assert!(help.contains("terminal-equivalent access"));
        assert!(help.contains("not authentication"));
        assert!(!help.contains("herdr web-bridge"));
    }

    #[test]
    fn non_loopback_options_require_explicit_host_but_allow_same_origin_by_default() {
        let host_only = vec!["--host".to_string(), "0.0.0.0".to_string()];
        assert!(parse_options(&host_only)
            .unwrap_err()
            .contains("--allow-host"));

        let without_origin = vec![
            "--host".to_string(),
            "0.0.0.0".to_string(),
            "--allow-host".to_string(),
            "192.0.2.10".to_string(),
        ];
        let same_origin_only = parse_options(&without_origin).unwrap().unwrap();
        assert_eq!(same_origin_only.allowed_hosts, vec!["192.0.2.10"]);
        assert!(same_origin_only.allowed_origins.is_empty());

        let explicit = vec![
            "--host".to_string(),
            "0.0.0.0".to_string(),
            "--allow-host".to_string(),
            "192.0.2.10".to_string(),
            "--allow-origin".to_string(),
            "http://192.0.2.10:4000".to_string(),
            "--bridge-label".to_string(),
            "Build host".to_string(),
        ];
        let options = parse_options(&explicit).unwrap().unwrap();
        assert_eq!(options.allowed_hosts, vec!["192.0.2.10"]);
        assert_eq!(options.configured_label.as_deref(), Some("Build host"));
    }

    #[test]
    fn parse_options_configures_explicit_session() {
        let _guard = crate::session::TEST_ENV_LOCK.lock().unwrap();
        let previous_session = std::env::var(crate::session::SESSION_ENV_VAR).ok();
        let previous_socket = std::env::var(herdr_compat::api::SOCKET_PATH_ENV_VAR).ok();

        std::env::set_var(
            herdr_compat::api::SOCKET_PATH_ENV_VAR,
            "/tmp/ignored-herdr.sock",
        );
        let args = vec!["--session".to_string(), "work".to_string()];
        let options = parse_options(&args).unwrap().unwrap();

        assert_eq!(options.port, DEFAULT_PORT);
        assert!(crate::session::explicit_session_requested());
        assert!(crate::session::active_api_socket_path().ends_with("sessions/work/herdr.sock"));

        restore_env(crate::session::SESSION_ENV_VAR, previous_session);
        restore_env(herdr_compat::api::SOCKET_PATH_ENV_VAR, previous_socket);
        crate::session::clear_explicit_session_for_test();
    }

    fn restore_env(name: &str, value: Option<String>) {
        match value {
            Some(value) => std::env::set_var(name, value),
            None => std::env::remove_var(name),
        }
    }

    fn runtime_status(version: &str, protocol: u32) -> herdr_compat::api::RuntimeStatus {
        herdr_compat::api::RuntimeStatus {
            version: Some(version.to_string()),
            protocol: Some(protocol),
            capabilities: None,
        }
    }

    #[test]
    fn upload_file_name_sanitization_uses_basename() {
        assert_eq!(
            sanitize_upload_file_name("../../screen shot.png").as_deref(),
            Some("screen shot.png")
        );
        assert_eq!(
            sanitize_upload_file_name(r"..\notes.txt").as_deref(),
            Some("notes.txt")
        );
        assert_eq!(sanitize_upload_file_name(".."), None);
        assert_eq!(sanitize_upload_file_name(""), None);
    }

    #[test]
    fn upload_file_name_sanitization_rechecks_truncated_name() {
        let name = format!("{}.", "a".repeat(180));
        let expected = "a".repeat(180);
        assert_eq!(
            sanitize_upload_file_name(&name).as_deref(),
            Some(expected.as_str())
        );
        let dots = ".".repeat(181);
        assert_eq!(sanitize_upload_file_name(&dots), None);
    }

    #[test]
    fn upload_extension_comes_from_mime() {
        assert_eq!(upload_extension_for_mime(Some("image/png")), Some("png"));
        assert_eq!(
            upload_extension_for_mime(Some("image/jpeg; charset=binary")),
            Some("jpg")
        );
        assert_eq!(
            upload_extension_for_mime(Some("application/octet-stream")),
            None
        );
    }

    #[test]
    fn upload_child_check_rejects_nested_paths() {
        let parent = PathBuf::from("/tmp/herdr-web/uploads");
        assert!(is_direct_child(&parent, &parent.join("file.png")));
        assert!(!is_direct_child(&parent, &parent.join("nested/file.png")));
    }

    fn origin_headers(host: &str, origin: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(HOST, host.parse().unwrap());
        if let Some(origin) = origin {
            headers.insert(ORIGIN, origin.parse().unwrap());
        }
        headers
    }

    fn test_policy(bind_host: &str, bind_port: u16) -> RequestPolicy {
        RequestPolicy {
            bind_host: bind_host.to_string(),
            bind_port,
            allowed_hosts: Vec::new(),
            allowed_origins: Vec::new(),
            allowed_connect_origins: Vec::new(),
            allowed_connect_sources: Vec::new(),
        }
    }
}
