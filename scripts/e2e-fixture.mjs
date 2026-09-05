#!/usr/bin/env node

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const root = fileURLToPath(new URL("..", import.meta.url));
const staticDir = join(root, "web", "dist");
const logs = new Map();
const fixtureStates = new Map();
const fixtureSockets = new Map();
const servers = [];
const FIXTURE_PASSWORD = "fixture-only-password";
const FIXTURE_SESSION_TOKEN = "fixture-session-token";
let remoteAccessApplySequence = 0;

const fixtures = [
  {
    id: "host-a",
    port: 4173,
    label: "Fixture A",
    variant: "compatible",
    serveStatic: true,
  },
  { id: "host-b", port: 4174, label: "Fixture B", variant: "compatible" },
  {
    id: "host-c",
    port: 4175,
    label: "Incompatible C",
    variant: "incompatible",
  },
  { id: "host-d", port: 4176, label: "Malformed D", variant: "malformed" },
];

for (const fixture of fixtures) {
  logs.set(fixture.id, emptyLog());
  fixtureStates.set(fixture.id, defaultFixtureState());
  fixtureSockets.set(fixture.id, new Set());
  servers.push(await startFixture(fixture));
}

process.stdout.write("Herdr World browser fixtures listening on 4173-4176\n");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(resolve))),
    ).finally(() => process.exit(0));
  });
}

async function startFixture(fixture) {
  const webSockets = new WebSocketServer({ noServer: true });
  const server = createServer(async (request, response) => {
    setCorsHeaders(fixture, request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${fixture.port}`);
    const state = fixtureStates.get(fixture.id);
    if (url.pathname === "/__fixture/requests") {
      json(response, 200, Object.fromEntries(logs));
      return;
    }
    if (url.pathname === "/__fixture/reset" && request.method === "POST") {
      for (const [id] of logs) {
        logs.set(id, emptyLog());
        fixtureStates.set(id, defaultFixtureState());
      }
      json(response, 200, { ok: true });
      return;
    }
    if (url.pathname === "/__fixture/state" && request.method === "POST") {
      const body = await readJson(request);
      const target = fixtures.find((candidate) => candidate.id === body.hostId);
      if (!target || !setFixtureState(target.id, body)) {
        json(response, 400, { error: "invalid fixture state" });
        return;
      }
      json(response, 200, { ok: true });
      return;
    }
    if (url.pathname === "/__fixture/ws-event" && request.method === "POST") {
      const body = await readJson(request);
      const clients = fixtureSockets.get(body.hostId);
      if (!clients || typeof body.path !== "string" || typeof body.event !== "object") {
        json(response, 400, { error: "invalid fixture WebSocket event" });
        return;
      }
      let sent = 0;
      for (const client of clients) {
        if (client.path === body.path && client.socket.readyState === 1) {
          client.socket.send(JSON.stringify(body.event));
          sent += 1;
        }
      }
      json(response, 200, { sent });
      return;
    }
    if (url.pathname === "/api/local/remote-access") {
      if (!state?.remoteAccess) {
        json(response, 404, { error: "not found" });
        return;
      }
      if (request.method === "POST") {
        const body = await readJson(request);
        if (!body || typeof body.remote_access !== "object") {
          json(response, 400, { error: "invalid remote access draft" });
          return;
        }
        const remoteAccess = {
          ...state.remoteAccess,
          ...body.remote_access,
          password_configured: body.password_action === "set"
            ? true
            : body.password_action === "remove"
              ? false
              : state.remoteAccess.password_configured,
        };
        const applyId = `fixture-${remoteAccessApplySequence += 1}`;
        fixtureStates.set(fixture.id, {
          ...state,
          remoteAccess,
          remoteAccessApply: { id: applyId, state: "ready", reason: null, restored: false },
        });
        json(response, 202, { id: applyId, state: "applying", reason: "settings saved; restarting", restored: null });
        return;
      }
      json(response, 200, {
        remote_access: state.remoteAccess,
        port: fixture.port,
        suggestions: ["bridge.example.test"],
        mutation_allowed: true,
        apply: state.remoteAccessApply,
      });
      return;
    }
    if (url.pathname === "/api/auth/status") {
      json(response, 200, {
        required: state?.remoteAccess?.password_configured === true,
        authenticated:
          request.headers.authorization === `Bearer ${FIXTURE_SESSION_TOKEN.padEnd(32, "x")}`,
        local_peer_bypass: fixture.serveStatic,
      });
      return;
    }
    if (url.pathname === "/api/auth/session" && request.method === "POST") {
      const body = await readJson(request);
      if (body?.password !== FIXTURE_PASSWORD) {
        json(response, 401, { error: "password required or rejected" });
        return;
      }
      json(response, 200, { token: FIXTURE_SESSION_TOKEN.padEnd(32, "x") });
      return;
    }
    if (
      state?.remoteAccess?.password_configured === true &&
      !fixture.serveStatic &&
      url.pathname !== "/api/capabilities" &&
      request.headers.authorization !== `Bearer ${FIXTURE_SESSION_TOKEN.padEnd(32, "x")}`
    ) {
      json(response, 401, { error: "password required or rejected" });
      return;
    }
    if (url.pathname === "/api/capabilities") {
      logs.get(fixture.id).capabilityRequests += 1;
      if (fixture.variant === "malformed") {
        json(response, 200, { bridge_api_version: "invalid", commands: "all" });
        return;
      }
      json(response, 200, capabilities(fixture, fixtureStates.get(fixture.id)));
      return;
    }
    if (url.pathname === "/api/snapshot") {
      logs.get(fixture.id).snapshotRequests += 1;
      const state = fixtureStates.get(fixture.id);
      if (state.snapshotMode === "offline") {
        json(response, 503, { error: "fixture offline" });
        return;
      }
      if (state.snapshotMode === "malformed") {
        json(response, 200, {});
        return;
      }
      json(response, 200, snapshot(fixture, state));
      return;
    }
    if (url.pathname === "/api/launcher-presets" && request.method === "GET") {
      json(response, 200, {
        version: 1,
        presets: [
          {
            id: "shell",
            label: "Shell",
            agent_hint: null,
            built_in: true,
          },
        ],
        warnings: [],
      });
      return;
    }
    if (url.pathname === "/api/launcher-presets/launch" && request.method === "POST") {
      const body = await readJson(request);
      logs.get(fixture.id).launches.push(body);
      const state = fixtureStates.get(fixture.id);
      if (state.launchCreatesSeat) {
        fixtureStates.set(fixture.id, { ...state, launchedSeat: true });
      }
      json(response, 200, { pane_id: `${fixture.id}-launched`, preset_id: body.preset_id });
      return;
    }
    if (url.pathname === "/api/command" && request.method === "POST") {
      const body = await readJson(request);
      logs.get(fixture.id).commands.push(body);
      json(response, 200, { pane_id: `${fixture.id}-created` });
      return;
    }
    if (url.pathname === "/api/selection" && request.method === "POST") {
      const body = await readJson(request);
      logs.get(fixture.id).selections.push(body);
      json(response, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/uploads" && request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const name = url.searchParams.get("name") || "upload";
      const size = Buffer.concat(chunks).length;
      logs.get(fixture.id).uploads.push({ name, size });
      json(response, 200, {
        file: { name, path: `/fixture/uploads/${name}`, size },
      });
      return;
    }
    if (fixture.serveStatic) {
      serveStaticFile(url.pathname, response);
      return;
    }
    json(response, 404, { error: "not found" });
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${fixture.port}`);
    if (!url.pathname.startsWith("/ws/")) {
      socket.destroy();
      return;
    }
    const state = fixtureStates.get(fixture.id);
    if (
      state?.remoteAccess?.password_configured === true &&
      !fixture.serveStatic &&
      request.headers["sec-websocket-protocol"] !== `herdr-world-auth.${FIXTURE_SESSION_TOKEN.padEnd(32, "x")}`
    ) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.fixtureUrl = url;
      webSockets.emit("connection", webSocket, request);
    });
  });

  webSockets.on("connection", (webSocket) => {
    const url = webSocket.fixtureUrl;
    const client = { socket: webSocket, path: url.pathname };
    fixtureSockets.get(fixture.id).add(client);
    webSocket.on("close", () => fixtureSockets.get(fixture.id).delete(client));
    if (url.pathname !== "/ws/terminal") {
      return;
    }
    const log = logs.get(fixture.id);
    log.connections += 1;
    const state = fixtureStates.get(fixture.id);
    const terminalId = url.searchParams.get("terminal_id") || "terminal";
    if (url.searchParams.get("probe") === "true") {
      webSocket.send(JSON.stringify({ type: "attach_ready" }));
      return;
    }
    webSocket.send(
      Buffer.from(
        state?.snapshotVariant === "showcase"
          ? showcaseTerminalOutput(terminalId)
          : `\u001b[32m${fixture.label} terminal ready — λ🙂\u001b[0m\r\n`,
      ),
    );
    webSocket.on("message", (data, isBinary) => {
      if (isBinary) {
        log.terminalInput.push({ type: "binary", bytes: [...data] });
        return;
      }
      try {
        const frame = JSON.parse(String(data));
        if (frame.type === "input") {
          log.terminalInput.push(frame);
          webSocket.send(Buffer.from(frame.data));
        } else if (frame.type === "resize") {
          log.terminalResize.push(frame);
        } else if (frame.type === "scroll") {
          log.terminalScroll.push(frame);
        }
      } catch {
        webSocket.close(1003, "invalid fixture frame");
      }
    });
  });

  await new Promise((resolve) =>
    server.listen(fixture.port, "127.0.0.1", resolve),
  );
  return server;
}

function capabilities(fixture, state) {
  return {
    bridge_api_version: 1,
    bridge_version: "0.1.0",
    herdr_version: "0.8.2",
    terminal_protocol:
      state.terminalProtocol ?? (fixture.variant === "incompatible" ? 19 : 20),
    configured_label: fixture.label,
    features:
      state.features ?? [
        "snapshot",
        "structural_events",
        "shared_selection",
        "launcher_presets",
        "terminal_attach",
        "terminal_input",
        "terminal_resize",
        "terminal_scroll",
        "terminal_shared_fanout",
        "uploads",
      ],
    commands: state.commands ?? [
      "workspace.create",
      "workspace.rename",
      "workspace.close",
      "workspace.focus",
      "tab.create",
      "tab.rename",
      "tab.close",
      "tab.focus",
      "pane.rename",
      "pane.close",
      "pane.split",
      "pane.focus_direction",
      "pane.move",
    ],
    web_compat: 1,
    launcher_presets: { version: 1 },
  };
}

function emptyLog() {
  return {
    commands: [],
    launches: [],
    selections: [],
    terminalInput: [],
    terminalResize: [],
    terminalScroll: [],
    uploads: [],
    connections: 0,
    capabilityRequests: 0,
    snapshotRequests: 0,
  };
}

function defaultFixtureState() {
  return {
    snapshotMode: "ready",
    snapshotVariant: "default",
    terminalProtocol: null,
    features: null,
    commands: null,
    launchCreatesSeat: false,
    launchedSeat: false,
    remoteAccess: {
      enabled: false,
      accepted_hosts: [],
      allowed_page_origins: ["http://127.0.0.1:4173"],
      allowed_bridge_origins: [],
      password_configured: false,
    },
    remoteAccessApply: { id: null, state: "ready", reason: null, restored: null },
  };
}

function setFixtureState(hostId, value) {
  const current = fixtureStates.get(hostId);
  if (!current) {
    return false;
  }
  const snapshotMode = value.snapshotMode ?? current.snapshotMode;
  const snapshotVariant = value.snapshotVariant ?? current.snapshotVariant;
  const terminalProtocol = value.terminalProtocol ?? current.terminalProtocol;
  const features = value.features ?? current.features;
  const commands = value.commands ?? current.commands;
  const launchCreatesSeat = value.launchCreatesSeat ?? current.launchCreatesSeat;
  const passwordConfigured = value.passwordConfigured ?? current.remoteAccess.password_configured;
  if (
    !["ready", "offline", "malformed"].includes(snapshotMode) ||
    !["default", "empty", "empty-shell", "large", "idle-desk", "long-title", "showcase"].includes(snapshotVariant) ||
    (terminalProtocol !== null && ![19, 20, 21].includes(terminalProtocol)) ||
    (features !== null &&
      (!Array.isArray(features) || features.some((feature) => typeof feature !== "string"))) ||
    (commands !== null &&
      (!Array.isArray(commands) || commands.some((command) => typeof command !== "string"))) ||
    typeof launchCreatesSeat !== "boolean" ||
    typeof passwordConfigured !== "boolean"
  ) {
    return false;
  }
  fixtureStates.set(hostId, {
    snapshotMode,
    snapshotVariant,
    terminalProtocol,
    features,
    commands,
    launchCreatesSeat,
    launchedSeat: current.launchedSeat,
    remoteAccess: { ...current.remoteAccess, password_configured: passwordConfigured },
    remoteAccessApply: current.remoteAccessApply,
  });
  return true;
}

function snapshot(fixture, stateOrVariant = "default") {
  const state = typeof stateOrVariant === "string" ? null : stateOrVariant;
  const variant = typeof stateOrVariant === "string" ? stateOrVariant : stateOrVariant.snapshotVariant;
  if (variant === "empty") {
    return { workspaces: [], tabs: [], panes: [], layouts: [] };
  }
  if (variant === "empty-shell") {
    const result = snapshot(fixture, "default");
    result.workspaces[0].agent_status = "unknown";
    result.tabs[0].label = "Shell";
    result.tabs[0].agent_status = "unknown";
    result.panes[0] = {
      ...result.panes[0],
      label: "Shell",
      agent: null,
      display_agent: null,
      agent_status: "unknown",
      state_labels: {},
    };
    return result;
  }
  if (variant === "large") {
    return largeSnapshot(fixture);
  }
  if (variant === "idle-desk") {
    return idleDeskSnapshot(fixture);
  }
  if (variant === "long-title") {
    return longTitleSnapshot(fixture);
  }
  if (variant === "showcase") {
    return showcaseSnapshot(fixture);
  }
  const suffix = fixture.id.at(-1).toUpperCase();
  const result = {
    workspaces: [
      {
        workspace_id: "main",
        number: 1,
        label: "main",
        focused: true,
        pane_count: 1,
        tab_count: 1,
        active_tab_id: "tab-1",
        agent_status: fixture.id === "host-b" ? "blocked" : "working",
      },
    ],
    tabs: [
      {
        tab_id: "tab-1",
        workspace_id: "main",
        number: 1,
        label: `Agent ${suffix}`,
        focused: true,
        pane_count: 1,
        agent_status: fixture.id === "host-b" ? "blocked" : "working",
      },
    ],
    panes: [
      {
        pane_id: "p1",
        terminal_id: "t1",
        workspace_id: "main",
        tab_id: "tab-1",
        focused: true,
        cwd: `/fixture/${fixture.id}`,
        label: `Codex ${suffix}`,
        agent: "codex",
        display_agent: `Codex ${suffix}`,
        agent_status: fixture.id === "host-b" ? "blocked" : "working",
        state_labels:
          fixture.id === "host-b"
            ? { blocked: "Needs review" }
            : { working: "Running" },
        revision: 1,
      },
    ],
    layouts: [],
    selected_pane_id: "p1",
  };
  if (state?.launchedSeat) {
    result.workspaces[0] = {
      ...result.workspaces[0],
      pane_count: 2,
      tab_count: 2,
      active_tab_id: "tab-launched",
    };
    result.tabs.push({
      tab_id: "tab-launched",
      workspace_id: "main",
      number: 2,
      label: "New seat",
      focused: true,
      pane_count: 1,
      agent_status: "unknown",
    });
    result.panes.push({
      pane_id: "p-launched",
      terminal_id: "t-launched",
      workspace_id: "main",
      tab_id: "tab-launched",
      focused: true,
      cwd: `/fixture/${fixture.id}/new-seat`,
      label: "Shell",
      agent: null,
      display_agent: null,
      agent_status: "unknown",
      revision: 1,
    });
    result.selected_pane_id = "p-launched";
  }
  return result;
}

function longTitleSnapshot(fixture) {
  const result = snapshot(fixture, "default");
  const title = "Research Workspace — " + "An Exceptionally Long Office Title ".repeat(24) + "🚀";
  result.workspaces[0].label = title;
  result.tabs[0].label = `Agents for ${title}`;
  result.panes[0].label = `Codex A — ${title}`;
  result.panes[0].display_agent = `Codex A — ${title}`;
  return result;
}

function showcaseSnapshot(fixture) {
  const spaces = fixture.id === "host-a"
    ? [
        ["launch-control", "Launch Control", [
          ["Codex Build", "codex", "working", "Building release"],
          ["Claude Review", "claude", "blocked", "Needs approval"],
          ["Shell", null, "unknown", "Ready"],
        ]],
        ["design-lab", "Design Lab", [
          ["Claude Design", "claude", "working", "Refining flows"],
          ["Codex UI", "codex", "done", "Ready for review"],
          ["Aider", "aider", "idle", "Available"],
        ]],
        ["api-workshop", "API Workshop", [
          ["Codex API", "codex", "working", "Implementing contract"],
          ["Claude API", "claude", "working", "Reviewing edge cases"],
          ["OpenCode", "opencode", "done", "Checks complete"],
        ]],
        ["quality-gate", "Quality Gate", [
          ["Codex QA", "codex", "blocked", "Awaiting fixture"],
          ["Claude QA", "claude", "done", "All checks passed"],
        ]],
      ]
    : fixture.id === "host-b"
      ? [
          ["docs-studio", "Docs Studio", [
            ["Codex Docs", "codex", "working", "Updating guide"],
            ["Claude Docs", "claude", "idle", "Available"],
          ]],
          ["release-room", "Release Room", [
            ["Codex Release", "codex", "done", "Artifact verified"],
            ["Claude Release", "claude", "working", "Checking notes"],
          ]],
        ]
      : [];
  const workspaces = spaces.map(([id, label, agents], index) => ({
    workspace_id: id,
    number: index + 1,
    label,
    focused: index === 0,
    pane_count: agents.length,
    tab_count: 1,
    active_tab_id: `tab-${id}`,
    agent_status: aggregateShowcaseStatus(agents.map(([, , status]) => status)),
  }));
  const tabs = spaces.map(([id, , agents], index) => ({
    tab_id: `tab-${id}`,
    workspace_id: id,
    number: 1,
    label: "Agents",
    focused: index === 0,
    pane_count: agents.length,
    agent_status: aggregateShowcaseStatus(agents.map(([, , status]) => status)),
  }));
  const panes = spaces.flatMap(([workspaceId, , agents], workspaceIndex) =>
    agents.map(([label, agent, status, stateLabel], agentIndex) => {
      const id = `${fixture.id}-${workspaceId}-${agentIndex + 1}`;
      return {
        pane_id: `pane-${id}`,
        terminal_id: `terminal-${id}`,
        workspace_id: workspaceId,
        tab_id: `tab-${workspaceId}`,
        focused: workspaceIndex === 0 && agentIndex === 0,
        cwd: `/demo/${workspaceId}`,
        label,
        agent,
        display_agent: agent ? label : null,
        agent_status: status,
        state_labels: { [status]: stateLabel },
        revision: 1,
      };
    })
  );
  return { workspaces, tabs, panes, layouts: [], selected_pane_id: panes[0]?.pane_id };
}

function aggregateShowcaseStatus(statuses) {
  return ["blocked", "working", "done", "idle", "unknown"]
    .find((status) => statuses.includes(status)) ?? "unknown";
}

function showcaseTerminalOutput(terminalId) {
  if (terminalId.includes("release") || terminalId.includes("quality-gate")) {
    return [
      "\u001b[36mHERDR WORLD / DEMO SESSION\u001b[0m",
      "\u001b[90m/demo/release-room\u001b[0m",
      "",
      "$ npm run test:e2e -- graph",
      "\u001b[32m✓ navigation   ✓ terminal handoff   ✓ accessibility\u001b[0m",
      "\u001b[32mAll checks passed. Ready for review.\u001b[0m",
      "",
    ].join("\r\n");
  }
  return [
    "\u001b[36mHERDR WORLD / DEMO SESSION\u001b[0m",
    "\u001b[90m/demo/launch-control\u001b[0m",
    "",
    "$ npm run check",
    "\u001b[32m✓ lint   ✓ unit tests   ✓ production build\u001b[0m",
    "\u001b[33mRelease candidate prepared from fixture data.\u001b[0m",
    "",
  ].join("\r\n");
}

function largeSnapshot(fixture) {
  const workspaceCount = fixture.id === "host-a" ? 128 : 1;
  const workspaces = Array.from({ length: workspaceCount }, (_, index) => ({
    workspace_id: `workspace-${index + 1}`,
    number: index + 1,
    label: `Workspace ${String(index + 1).padStart(3, "0")}`,
    focused: index === 0,
    pane_count: index === 0 && fixture.id === "host-a" ? 16 : 0,
    tab_count: index === 0 && fixture.id === "host-a" ? 10 : 1,
    active_tab_id: `tab-${index + 1}`,
    agent_status: "unknown",
  }));
  const tabs = workspaces.map((workspace, index) => ({
    tab_id: workspace.active_tab_id,
    workspace_id: workspace.workspace_id,
    number: 1,
    label: `Agents ${index + 1}`,
    focused: index === 0,
    pane_count: workspace.pane_count,
    agent_status: "unknown",
  }));
  if (fixture.id === "host-a") {
    for (let index = 2; index <= 10; index += 1) {
      tabs.push({
        tab_id: `workspace-1-tab-${index}`,
        workspace_id: "workspace-1",
        number: index,
        label: index === 2 ? "Agents 1" : `Desk ${index}`,
        focused: false,
        pane_count: 1,
        agent_status: "unknown",
      });
    }
  }
  const panes = fixture.id === "host-a"
    ? [
        largePane(0, "working", "tab-1", true),
        largePane(1, "unknown", "tab-1"),
        ...Array.from({ length: 7 }, (_, index) =>
          largePane(index + 2, "working", `workspace-1-tab-${index + 2}`)),
        largePane(9, "working", "workspace-1-tab-9"),
        largePane(10, "blocked", "tab-1"),
        largePane(11, "blocked", "workspace-1-tab-2"),
        largePane(12, "idle", "workspace-1-tab-3"),
        largePane(13, "done", "workspace-1-tab-4"),
        largePane(14, "idle", "workspace-1-tab-5"),
        largePane(15, "done", "workspace-1-tab-6"),
      ]
    : [];
  return { workspaces, tabs, panes, layouts: [], selected_pane_id: panes[0]?.pane_id };
}

function idleDeskSnapshot(fixture) {
  const snapshot = largeSnapshot(fixture);
  return {
    ...snapshot,
    panes: snapshot.panes.map((pane) =>
      pane.pane_id === "large-pane-8"
        ? {
            ...pane,
            agent_status: "idle",
            state_labels: { idle: "Taking a break" },
          }
        : pane,
    ),
  };
}

function largePane(index, status, tabId, focused = false) {
  return {
    pane_id: `large-pane-${index + 1}`,
    terminal_id: `large-terminal-${index + 1}`,
    workspace_id: "workspace-1",
    tab_id: tabId,
    focused,
    agent: "codex",
    display_agent: `Agent ${String(index + 1).padStart(2, "0")}`,
    agent_status: status,
    state_labels: {
      [status]: status === "done"
        ? "Ready for review"
        : status === "blocked"
          ? "Needs input"
          : status === "idle"
            ? "Taking a break"
            : "Running",
    },
    revision: 1,
  };
}

function setCorsHeaders(fixture, request, response) {
  const origin = request.headers.origin;
  const state = fixtureStates.get(fixture.id);
  if (origin && state?.remoteAccess?.allowed_page_origins.includes(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type, authorization");
}

function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function serveStaticFile(requestPath, response) {
  const relative =
    requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const candidate = normalize(join(staticDir, relative));
  const file =
    candidate.startsWith(staticDir) &&
    existsSync(candidate) &&
    statSync(candidate).isFile()
      ? candidate
      : join(staticDir, "index.html");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' data: http://127.0.0.1:4174 ws://127.0.0.1:4174 http://127.0.0.1:4175 ws://127.0.0.1:4175 http://127.0.0.1:4176 ws://127.0.0.1:4176 http://127.0.0.1:4199 ws://127.0.0.1:4199; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("content-type", mimeType(file));
  createReadStream(file).pipe(response);
}

function mimeType(file) {
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
    }[extname(file)] ?? "application/octet-stream"
  );
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
