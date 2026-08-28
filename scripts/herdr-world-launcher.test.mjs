import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const launcher = resolve(root, "scripts/herdr-world-launcher.sh");

function runLauncher(body, input = "") {
  const result = spawnSync(
    "bash",
    [
      "-c",
      `source "$HERDR_WORLD_LAUNCHER_TEST_PATH"\n${body}`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        HERDR_WORLD_LAUNCHER_TEST_PATH: launcher,
        HERDR_CLIENT_SOCKET_PATH: "",
        HERDR_SESSION: "",
        HERDR_SOCKET_PATH: "",
        HERDR_WORLD_SETUP: "auto",
      },
      input,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test("an available default session starts the packaged bridge directly", () => {
  const result = runLauncher(`
herdr_world_default_socket() { printf '/tmp/herdr.sock\\n'; }
herdr_world_socket_ready() { return 0; }
herdr_world_find_binary() { printf '/fake/herdr\\n'; }
herdr_world_binary_is_supported() { return 0; }
herdr_world_server_is_supported() { return 0; }
herdr_world_exec_bridge() { printf 'bridge'; printf ' <%s>' "$@"; printf '\\n'; }
herdr_world_main --port 8791
`);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "bridge <--port> <8791>\n");
  assert.match(result.stderr, /starting Herdr World at http:\/\/127\.0\.0\.1:8791/);
});

test("help and explicit connection targets never trigger guided setup", () => {
  for (const args of ["--help", "--session work --port 8791"]) {
    const result = runLauncher(`
herdr_world_default_socket() { echo 'unexpected socket lookup' >&2; return 1; }
herdr_world_exec_bridge() { printf 'bridge'; printf ' <%s>' "$@"; printf '\\n'; }
herdr_world_main ${args}
`);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^bridge /);
    assert.doesNotMatch(result.stderr, /unexpected socket lookup/);
  }

  const customSocket = runLauncher(`
export HERDR_SOCKET_PATH=/tmp/custom-herdr.sock
herdr_world_default_socket() { echo 'unexpected socket lookup' >&2; return 1; }
herdr_world_exec_bridge() { printf 'bridge'; printf ' <%s>' "$@"; printf '\\n'; }
herdr_world_main --port 8792
`);
  assert.equal(customSocket.status, 0);
  assert.equal(customSocket.stdout, "bridge <--port> <8792>\n");
  assert.doesNotMatch(customSocket.stderr, /unexpected socket lookup/);

  const namedSession = runLauncher(`
export HERDR_SESSION=work
herdr_world_default_socket() { echo 'unexpected socket lookup' >&2; return 1; }
herdr_world_exec_bridge() { printf 'bridge'; printf ' <%s>' "$@"; printf '\\n'; }
herdr_world_main --port 8794
`);
  assert.equal(namedSession.status, 0);
  assert.equal(namedSession.stdout, "bridge <--port> <8794>\n");
  assert.doesNotMatch(namedSession.stderr, /unexpected socket lookup/);
});

test("a non-interactive launch fails safely with actionable instructions", () => {
  const result = runLauncher(`
herdr_world_default_socket() { printf '/tmp/missing-herdr.sock\\n'; }
herdr_world_socket_ready() { return 1; }
herdr_world_is_interactive() { return 1; }
herdr_world_exec_bridge() { echo 'unexpected bridge start'; }
herdr_world_main
`);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /No running default Herdr session/);
  assert.match(result.stderr, /https:\/\/herdr\.dev\/docs\/install\//);
  assert.match(result.stderr, /cd \/path\/to\/your\/project/);
  assert.doesNotMatch(result.stderr, /unexpected bridge start/);
});

test("installation and startup each require affirmative consent", () => {
  const declinedInstall = runLauncher(
    `
herdr_world_default_socket() { printf '/tmp/missing-herdr.sock\\n'; }
herdr_world_socket_ready() { return 1; }
herdr_world_is_interactive() { return 0; }
herdr_world_find_binary() { return 1; }
herdr_world_install() { echo 'unexpected install' >&2; }
herdr_world_main
`,
    "n\n",
  );
  assert.equal(declinedInstall.status, 1);
  assert.match(declinedInstall.stderr, /Download and run the official Herdr installer now\?/);
  assert.doesNotMatch(declinedInstall.stderr, /unexpected install/);

  const declinedStart = runLauncher(
    `
herdr_world_default_socket() { printf '/tmp/missing-herdr.sock\\n'; }
herdr_world_socket_ready() { return 1; }
herdr_world_is_interactive() { return 0; }
herdr_world_find_binary() { printf '/fake/herdr\\n'; }
herdr_world_binary_is_supported() { return 0; }
herdr_world_run_herdr() { echo 'unexpected Herdr start' >&2; }
herdr_world_main
`,
    "n\n",
  );
  assert.equal(declinedStart.status, 1);
  assert.match(declinedStart.stderr, /Start Herdr now\?/);
  assert.doesNotMatch(declinedStart.stderr, /unexpected Herdr start/);
});

test("consented installation and startup continue to the bridge", () => {
  const result = runLauncher(
    `
installed=0
socket_ready=0
herdr_world_default_socket() { printf '/tmp/herdr.sock\\n'; }
herdr_world_socket_ready() { [[ "$socket_ready" == 1 ]]; }
herdr_world_is_interactive() { return 0; }
herdr_world_find_binary() {
  [[ "$installed" == 1 ]] || return 1
  printf '/fake/herdr\\n'
}
herdr_world_find_installer_binary() { printf '/fake/herdr\\n'; }
herdr_world_binary_is_supported() { return 0; }
herdr_world_server_is_supported() { [[ "$socket_ready" == 1 ]]; }
herdr_world_install() { installed=1; echo 'installed' >&2; }
herdr_world_choose_workspace() { printf '/tmp/project\\n'; }
herdr_world_run_herdr() {
  printf 'started <%s> in <%s>\\n' "$1" "$2" >&2
  socket_ready=1
}
herdr_world_exec_bridge() { printf 'bridge'; printf ' <%s>' "$@"; printf '\\n'; }
herdr_world_main --port 8793
`,
    "y\ny\n",
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "bridge <--port> <8793>\n");
  assert.match(result.stderr, /installed/);
  assert.match(result.stderr, /started <\/fake\/herdr> in <\/tmp\/project>/);
  assert.match(result.stderr, /Herdr is running; starting Herdr World/);
});

test("an incompatible detached server is updated and restarted only with consent", () => {
  const result = runLauncher(
    `
socket_ready=1
server_reachable=1
server_supported=0
herdr_world_default_socket() { printf '/tmp/herdr.sock\\n'; }
herdr_world_socket_ready() { [[ "$socket_ready" == 1 ]]; }
herdr_world_is_interactive() { return 0; }
herdr_world_find_binary() { return 1; }
herdr_world_find_installer_binary() { printf '/fake/herdr\\n'; }
herdr_world_binary_is_supported() { return 0; }
herdr_world_server_is_supported() { [[ "$server_supported" == 1 ]]; }
herdr_world_server_is_reachable() { [[ "$server_reachable" == 1 ]]; }
herdr_world_install() { echo 'chatty official installer output'; }
herdr_world_stop_herdr() {
  printf 'stopped <%s>\\n' "$1" >&2
  socket_ready=0
  server_reachable=0
}
herdr_world_choose_workspace() { printf '/tmp/project\\n'; }
herdr_world_run_herdr() {
  printf 'started <%s> in <%s>\\n' "$1" "$2" >&2
  socket_ready=1
  server_reachable=1
  server_supported=1
}
herdr_world_exec_bridge() { printf 'bridge'; printf ' <%s>' "$@"; printf '\\n'; }
herdr_world_main --port 8795
`,
    "y\ny\ny\n",
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "bridge <--port> <8795>\n");
  assert.match(result.stderr, /Download and run the official Herdr installer now\?/);
  assert.match(result.stderr, /chatty official installer output/);
  assert.match(result.stderr, /Stop the incompatible Herdr server now\?/);
  assert.match(result.stderr, /Stopping it exits the/);
  assert.match(result.stderr, /stopped <\/fake\/herdr>/);
  assert.doesNotMatch(result.stderr, /stopped <chatty official installer output/);
  assert.match(result.stderr, /Start Herdr now\?/);
  assert.match(result.stderr, /started <\/fake\/herdr> in <\/tmp\/project>/);
});

test("declining an incompatible server stop leaves it untouched", () => {
  const result = runLauncher(
    `
herdr_world_default_socket() { printf '/tmp/herdr.sock\\n'; }
herdr_world_socket_ready() { return 0; }
herdr_world_is_interactive() { return 0; }
herdr_world_find_binary() { printf '/fake/herdr\\n'; }
herdr_world_binary_is_supported() { return 0; }
herdr_world_server_is_supported() { return 1; }
herdr_world_server_is_reachable() { return 0; }
herdr_world_stop_herdr() { echo 'unexpected stop' >&2; }
herdr_world_exec_bridge() { echo 'unexpected bridge start' >&2; }
herdr_world_main
`,
    "n\n",
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Stop the incompatible Herdr server now\?/);
  assert.doesNotMatch(result.stderr, /unexpected stop/);
  assert.doesNotMatch(result.stderr, /unexpected bridge start/);
});

test("a stale default socket starts Herdr without attempting to stop a server", () => {
  const result = runLauncher(
    `
socket_ready=1
server_supported=0
herdr_world_default_socket() { printf '/tmp/stale-herdr.sock\\n'; }
herdr_world_socket_ready() { [[ "$socket_ready" == 1 ]]; }
herdr_world_is_interactive() { return 0; }
herdr_world_find_binary() { return 1; }
herdr_world_find_installer_binary() { printf '/fake/herdr\\n'; }
herdr_world_binary_is_supported() { return 0; }
herdr_world_server_is_supported() { [[ "$server_supported" == 1 ]]; }
herdr_world_server_is_reachable() { return 1; }
herdr_world_install() { echo 'installed Herdr' >&2; }
herdr_world_stop_herdr() { echo 'unexpected stop' >&2; return 1; }
herdr_world_choose_workspace() { printf '/tmp/project\\n'; }
herdr_world_run_herdr() {
  printf 'started <%s> in <%s>\\n' "$1" "$2" >&2
  server_supported=1
}
herdr_world_exec_bridge() { printf 'bridge'; printf ' <%s>' "$@"; printf '\\n'; }
herdr_world_main --port 8796
`,
    "y\ny\n",
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "bridge <--port> <8796>\n");
  assert.doesNotMatch(result.stderr, /Stop the incompatible Herdr server/);
  assert.doesNotMatch(result.stderr, /unexpected stop/);
  assert.match(result.stderr, /installed Herdr/);
  assert.match(result.stderr, /stale Herdr socket/);
  assert.match(result.stderr, /Start Herdr now\?/);
  assert.match(result.stderr, /started <\/fake\/herdr> in <\/tmp\/project>/);
});

test("server reachability parses Herdr status instead of trusting its exit code", () => {
  const result = runLauncher(`
fake_herdr() {
  cat <<'EOF'
client:
  version: 0.8.2
server:
  status: not running
  socket: /tmp/stale.sock
EOF
}
if herdr_world_server_is_reachable fake_herdr; then exit 21; fi
fake_herdr() {
  cat <<'EOF'
client:
  version: 0.8.2
server:
  status: running
  version: 0.8.2
  protocol: 20
  compatible: yes
EOF
}
herdr_world_server_is_reachable fake_herdr
`);

  assert.equal(result.status, 0);
});

test("supported Herdr version parsing is bounded to v0.8.2 or newer", () => {
  const result = runLauncher(`
for version in 0.8.2 v0.8.2 0.8.3 0.9.0 1.0.0 0.8.2+build.1; do
  herdr_world_version_is_supported "$version" || exit 11
done
for version in 0.8.1 0.7.9 invalid 0.8; do
  if herdr_world_version_is_supported "$version"; then exit 12; fi
done
`);

  assert.equal(result.status, 0);
});

test("the launcher refuses to default Herdr's workspace to its own bundle", () => {
  const result = runLauncher(
    `
BUNDLE_ROOT="$PWD"
herdr_world_choose_workspace
`,
    "/tmp\n",
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "/tmp\n");
  assert.match(result.stderr, /bundle should not become your Herdr workspace/);
});
