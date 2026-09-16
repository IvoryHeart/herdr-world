import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assessCliSurface, assessPublicSurface, isAgentSocket } from "./checkpoint1-live.mjs";

test("checkpoint 1 accepts only a real Unix SSH agent socket", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "checkpoint1-agent-test-"));
  const regularFile = path.join(root, "agent.sock");
  const socketPath = path.join(root, "real-agent.sock");
  writeFileSync(regularFile, "placeholder");
  const server = net.createServer();
  try {
    assert.equal(isAgentSocket(regularFile), false);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    assert.equal(isAgentSocket(socketPath), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkpoint 1 blocks an unqualified Herdr socket API", () => {
  const result = assessPublicSurface({
    protocol: 22,
    schema_version: 1,
    schemas: {
      request: {
        oneOf: [
          {
            properties: {
              method: { const: "session.snapshot" },
              params: { $ref: "#/schemas/request/$defs/EmptyParams" },
            },
          },
          {
            properties: {
              method: { const: "events.subscribe" },
              params: { $ref: "#/schemas/request/$defs/EventsSubscribeParams" },
            },
          },
        ],
        $defs: {
          EmptyParams: { type: "object", properties: {} },
          EventsSubscribeParams: { type: "object", properties: {} },
        },
      },
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.machineQualified, false);
  assert.match(result.reasons.join(" "), /machine-qualified/);
});

test("checkpoint 1 distinguishes Herdr's one-shot machine CLI from a stream", () => {
  const result = assessCliSurface(
    "--machine <label-or-id> <command>",
    "Commands:\n  snapshot  Print the live session snapshot",
  );

  assert.equal(result.machinePrefix, true);
  assert.equal(result.apiSnapshot, true);
  assert.equal(result.apiConnect, false);
  assert.equal(result.oneShotOnly, true);
});

test("checkpoint 1 recognizes a machine-qualified CLI stream entry point", () => {
  const result = assessCliSurface(
    "Usage: herdr --machine <label-or-id> <command>",
    "Commands:\n  connect  Keep a machine API stream open",
  );

  assert.equal(result.machinePrefix, true);
  assert.equal(result.apiConnect, true);
  assert.equal(result.machineQualifiedStream, true);
  assert.equal(result.oneShotOnly, false);
});

test("checkpoint 1 does not treat prose mentioning connect as a stream command", () => {
  const result = assessCliSurface(
    "Usage: herdr --machine <label-or-id> <command>",
    "Commands:\n  snapshot  Print a snapshot\nConnect to the selected machine before running a command.",
  );

  assert.equal(result.apiConnect, false);
  assert.equal(result.machineQualifiedStream, false);
});

test("checkpoint 1 accepts a future machine-qualified request only when its selector is required", () => {
  const result = assessPublicSurface({
    protocol: 22,
    schema_version: 1,
    schemas: {
      request: {
        oneOf: [
          "session.snapshot",
          "events.subscribe",
          "layout.export",
          "layout.apply",
          "pane.move",
          "agent.start",
        ].map((method) => ({
          properties: {
            method: { const: method },
            params: { $ref: "#/schemas/request/$defs/MachineSnapshotParams" },
          },
        })),
        $defs: {
          MachineSnapshotParams: {
            type: "object",
            properties: { machine_id: { type: "string" } },
            required: ["machine_id"],
          },
        },
      },
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.machineQualified, true);
  assert.deepEqual(result.machineQualifiedMethods, [
    "session.snapshot",
    "events.subscribe",
    "layout.export",
    "layout.apply",
    "pane.move",
    "agent.start",
  ]);
});

test("checkpoint 1 accepts a supported machine-qualified stream entry point", () => {
  const result = assessPublicSurface(
    {
      protocol: 22,
      schema_version: 1,
      schemas: {
        request: {
          oneOf: [
            "session.snapshot",
            "events.subscribe",
            "layout.export",
            "layout.apply",
            "pane.move",
            "agent.start",
          ].map((method) => ({
            properties: {
              method: { const: method },
              params: { $ref: "#/schemas/request/$defs/LocalParams" },
            },
          })),
          $defs: { LocalParams: { type: "object", properties: {} } },
        },
      },
    },
    { machineQualifiedStream: true, streamEntryPoint: "--machine <id> api connect" },
  );

  assert.equal(result.status, "ready");
  assert.equal(result.machineQualified, true);
  assert.equal(result.machineQualifiedMethods.length, 0);
  assert.equal(result.machineQualifiedStream, true);
  assert.equal(result.streamEntryPoint, "--machine <id> api connect");
});
