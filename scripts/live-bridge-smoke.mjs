#!/usr/bin/env node

import assert from "node:assert/strict";
import WebSocket from "ws";
import { createTerminalScreen } from "./terminal-screen.mjs";

const bridgeA = process.env.HERDR_WEB_LIVE_BRIDGE_A;
const bridgeB = process.env.HERDR_WEB_LIVE_BRIDGE_B;

if (!bridgeA || !bridgeB) {
  throw new Error(
    "set HERDR_WEB_LIVE_BRIDGE_A and HERDR_WEB_LIVE_BRIDGE_B to two disposable Herdr bridges",
  );
}

const requiredFeatures = [
  "snapshot",
  "terminal_attach",
  "terminal_input",
  "terminal_resize",
  "terminal_scroll",
  "terminal_shared_fanout",
];

async function json(origin, path) {
  const response = await fetch(new URL(path, origin));
  assert.equal(
    response.status,
    200,
    `${origin}${path} returned ${response.status}`,
  );
  return response.json();
}

async function postJson(origin, path, body) {
  const response = await fetch(new URL(path, origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await response.text();
  assert.equal(
    response.status,
    200,
    `${origin}${path} returned ${response.status}: ${responseBody}`,
  );
  return JSON.parse(responseBody);
}

async function openEvents(origin) {
  const url = new URL("/ws/events", origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  const events = [];
  const waiters = new Set();
  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      return;
    }
    const event = JSON.parse(String(data));
    events.push(event);
    for (const waiter of waiters) {
      if (waiter.predicate(event)) {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve(event);
      }
    }
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return {
    waitFor(predicate, timeoutMs = 10_000) {
      const existing = events.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`event stream did not contain an expected event; received=${JSON.stringify(events.slice(-5))}`));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    close() {
      socket.close();
    },
  };
}

async function bridgeState(origin) {
  const capabilities = await json(origin, "/api/capabilities");
  assert.equal(capabilities.bridge_api_version, 1);
  assert.equal(capabilities.herdr_version, "0.8.2");
  assert.equal(capabilities.terminal_protocol, 20);
  for (const feature of requiredFeatures) {
    assert.ok(
      capabilities.features.includes(feature),
      `${origin} is missing ${feature}`,
    );
  }
  const snapshot = await json(origin, "/api/snapshot");
  assert.ok(snapshot.workspaces.length > 0, `${origin} has no Herdr workspace`);
  assert.ok(snapshot.panes.length > 0, `${origin} has no Herdr pane`);
  return { capabilities, snapshot };
}

function socketUrl(origin, terminalId, cols, rows) {
  const url = new URL("/ws/terminal", origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("terminal_id", terminalId);
  url.searchParams.set("cols", String(cols));
  url.searchParams.set("rows", String(rows));
  url.searchParams.set("takeover", "false");
  url.searchParams.set("coalesce_ms", "0");
  return url;
}

function waitForTerminalSizeCommand(rows, cols, evidence) {
  const rowParts = String(rows).split("");
  const colParts = String(cols).split("");
  const targetParts = [...rowParts, ...colParts]
    .map((part) => `'${part}'`)
    .join(" ");
  return (
    `target="$(printf '%s' ${targetParts})"; i=0; ` +
    'while [ "$i" -lt 100 ]; do current="$(stty size | tr -d \'[:space:]\')"; ' +
    '[ "$current" = "$target" ] && break; i=$((i+1)); sleep 0.05; done; ' +
    `printf '\\033[32m${evidence}_UNICODE_λ\\033[0m\\n'; ` +
    `printf '${evidence}_SIZE_%s\\n' "$current"\n`
  );
}

let attachSequence = 0;
const terminalConnections = new Map();

function connectionKey(origin, terminalId) {
  return `${origin}\u0000${terminalId}`;
}

function resizeTerminalScreens(key, cols, rows) {
  for (const connection of terminalConnections.get(key) ?? []) {
    connection.screen.resize(cols, rows);
  }
}

async function attach(origin, terminalId, cols, rows) {
  const screen = await createTerminalScreen(cols, rows);
  const socket = new WebSocket(socketUrl(origin, terminalId, cols, rows));
  const key = connectionKey(origin, terminalId);
  const waiters = new Set();
  let closed = false;
  const terminalText = () => screen.text();
  socket.on("message", (data, isBinary) => {
    if (closed || !isBinary) {
      return;
    }
    const bytes = Buffer.from(data);
    screen.write(bytes);
    const textOutput = terminalText();
    for (const waiter of waiters) {
      if (textOutput.includes(waiter.marker)) {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve();
      }
    }
  });
  try {
    await new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        clearTimeout(timer);
        socket.off("open", onOpen);
        socket.off("error", onError);
        socket.off("close", onClose);
        callback(value);
      };
      const onOpen = () => finish(resolve);
      const onError = (error) => finish(reject, error);
      const onClose = () =>
        finish(
          reject,
          new Error(`terminal socket closed before opening for ${origin}`),
        );
      const timer = setTimeout(
        () =>
          finish(
            reject,
            new Error(`terminal socket did not open for ${origin}`),
          ),
        10_000,
      );
      socket.once("open", onOpen);
      socket.once("error", onError);
      socket.once("close", onClose);
    });
  } catch (error) {
    screen.close();
    socket.on("error", () => {});
    socket.terminate();
    throw error;
  }
  const connection = {
    socket,
    screen,
    send(data) {
      socket.send(JSON.stringify({ type: "input", data }));
    },
    resize(colsValue, rowsValue) {
      resizeTerminalScreens(key, colsValue, rowsValue);
      socket.send(
        JSON.stringify({ type: "resize", cols: colsValue, rows: rowsValue }),
      );
    },
    scroll(direction, lines) {
      socket.send(JSON.stringify({ type: "scroll", direction, lines }));
    },
    waitFor(marker, timeoutMs = 10_000) {
      if (terminalText().includes(marker)) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          marker,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(
              new Error(
                `terminal output did not contain ${JSON.stringify(marker)}; tail=${JSON.stringify(
                  terminalText().slice(-1_000),
                )}`,
              ),
            );
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      terminalConnections.get(key)?.delete(connection);
      screen.close();
      socket.close();
    },
  };
  const connections = terminalConnections.get(key) ?? new Set();
  connections.add(connection);
  terminalConnections.set(key, connections);
  resizeTerminalScreens(key, cols, rows);
  const readyMarker = `SPEC010_ATTACH_${++attachSequence}`;
  connection.send(waitForTerminalSizeCommand(rows, cols, readyMarker));
  await connection.waitFor(`${readyMarker}_SIZE_${rows}${cols}`);
  return connection;
}

const stateA = await bridgeState(bridgeA);
const stateB = await bridgeState(bridgeB);
assert.notEqual(
  stateA.capabilities.configured_label,
  stateB.capabilities.configured_label,
);

const terminalA = stateA.snapshot.panes[0].terminal_id;
const terminalB = stateB.snapshot.panes[0].terminal_id;
const eventsA = await openEvents(bridgeA);
const firstA = await attach(bridgeA, terminalA, 80, 24);
const secondA = await attach(bridgeA, terminalA, 72, 20);
const firstB = await attach(bridgeB, terminalB, 80, 24);

try {
  secondA.resize(91, 28);
  secondA.scroll("up", 3);
  secondA.scroll("down", 3);
  const focusEvent = eventsA.waitFor(
    (event) => event.event === "workspace_renamed" && event.data?.workspace_id === stateA.snapshot.workspaces[0].workspace_id,
  );
  const commandResult = await postJson(bridgeA, "/api/command", {
    method: "workspace.rename",
    params: {
      workspace_id: stateA.snapshot.workspaces[0].workspace_id,
      label: `Live A checked ${Date.now()}`,
    },
  });
  assert.ok(commandResult, "workspace.rename returned no result");
  await focusEvent;
  const markerA = `SPEC010_A_${Date.now()}`;
  secondA.send(waitForTerminalSizeCommand(28, 91, markerA));
  await Promise.all([
    firstA.waitFor(`${markerA}_SIZE_2891`),
    secondA.waitFor(`${markerA}_SIZE_2891`),
  ]);

  firstA.resize(101, 31);
  const refitMarker = `${markerA}_REFIT`;
  firstA.send(waitForTerminalSizeCommand(31, 101, refitMarker));
  await Promise.all([
    firstA.waitFor(`${refitMarker}_SIZE_31101`),
    secondA.waitFor(`${refitMarker}_SIZE_31101`),
  ]);

  const interruptMarker = `${markerA}_INTERRUPTED`;
  firstA.send(`sleep 30\n`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  secondA.send("\u0003");
  secondA.send(`printf '${interruptMarker}\\n'\n`);
  await Promise.all([
    firstA.waitFor(interruptMarker),
    secondA.waitFor(interruptMarker),
  ]);

  const keyMarker = `${markerA}_RAW_KEYS`;
  firstA.send(
    `python3 -c 'import os,termios,tty;a=termios.tcgetattr(0);tty.setraw(0);m="${keyMarker}"+"_READY";os.write(1,(m+"\\n").encode());d=os.read(0,7);termios.tcsetattr(0,termios.TCSADRAIN,a);print("${keyMarker}_"+d.hex())'\n`,
  );
  await Promise.all([
    firstA.waitFor(`${keyMarker}_READY`),
    secondA.waitFor(`${keyMarker}_READY`),
  ]);
  secondA.send("\u001b[A\u001bOP\u0001");
  const keyEvidence = `${keyMarker}_1b5b411b4f5001`;
  await Promise.all([firstA.waitFor(keyEvidence), secondA.waitFor(keyEvidence)]);

  secondA.close();
  const reconnectedA = await attach(bridgeA, terminalA, 101, 31);
  try {
    const reconnectMarker = `${markerA}_RECONNECTED`;
    reconnectedA.send(`printf '${reconnectMarker}\\n'\n`);
    await Promise.all([
      firstA.waitFor(reconnectMarker),
      reconnectedA.waitFor(reconnectMarker),
    ]);
  } finally {
    reconnectedA.close();
  }

  const markerB = `SPEC010_B_${Date.now()}`;
  firstB.send(`printf '${markerB}\\n'\n`);
  await firstB.waitFor(markerB);
  assert.ok(
    !stateA.snapshot.panes.some((pane) => pane.terminal_id === terminalB),
  );
  assert.ok(
    !stateB.snapshot.panes.some((pane) => pane.terminal_id === terminalA),
  );

  firstA.send("python3 -c 'import os;os.write(1,b\"\\x07\\x07\")'; printf 'BELL_DONE\\n'\n");
  await firstA.waitFor("BELL_DONE");

  process.stdout.write(
    `${JSON.stringify(
      {
        bridgeA: stateA.capabilities.configured_label,
        bridgeB: stateB.capabilities.configured_label,
        protocol: stateA.capabilities.terminal_protocol,
        fanout: "two clients received A output",
        capabilitiesSnapshot: "capabilities and snapshot accepted",
        commandEvent: "workspace.rename command produced workspace.renamed event",
        bell: "stock v0.8.2 direct terminal attach kept the stream open; TerminalBell is foreground-client-only",
        input: "shared paste, ArrowUp, F1, Ctrl+A, and Ctrl+C passed",
        resize: "last resize 28x91; explicit refit 31x101 (stock ANSI stream rendered without separator spaces)",
        reconnect: "passed without replacing the Herdr process",
        directRouting: "independent A and B terminal markers passed",
      },
      null,
      2,
    )}\n`,
  );
} finally {
  firstA.close();
  secondA.close();
  firstB.close();
  eventsA.close();
}
