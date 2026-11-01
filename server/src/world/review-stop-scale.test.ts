import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildShape, shapes } from "../../../scripts/scale/fixture";
import { syntheticSources } from "../../../scripts/scale/source";
import { HerdrClient } from "../bridge/herdr-client";
import {
  DESK_METADATA_MAX_BYTES,
  deskMetadataBytes,
} from "../../../shared/deskState";
import { reviewStopFixture } from "./testing/review-stop-fixture";

test("scale sources-10: current stops, both browser consumers and SQLite retain frame headroom", async () => {
  const shape = shapes.find((shape) => shape.id === "sources-10")!;
  const hosts = buildShape(shape),
    f = await reviewStopFixture();
  try {
    for (const [i, host] of hosts.entries()) {
      const panes = host.panes.map((pane) => ({
        ...pane,
        agent_status: "done",
      }));
      await f.marks.observe(`source-${i}`, 1, panes, 1001);
    }
    await f.refresh();
    const wire = f.registries.desk.list(),
      rows = f.storage.terminalMarks.list();
    expect(f.failures).toEqual([]);
    expect(wire.records).toHaveLength(360);
    expect(rows).toHaveLength(360);
    for (const browser of f.browsers)
      expect(browser.get().records).toHaveLength(360);
    const wireBytes = deskMetadataBytes({
      id: "synthetic-scale",
      result: wire,
    });
    const sqliteBytes = deskMetadataBytes(rows);
    expect(wireBytes).toBeLessThan(DESK_METADATA_MAX_BYTES);
    expect(sqliteBytes).toBeLessThan(DESK_METADATA_MAX_BYTES);
    console.log(
      JSON.stringify({
        shape: shape.id,
        currentRows: rows.length,
        wireBytes,
        sqliteBytes,
        wireBytesPerRecord: wireBytes / rows.length,
        sqliteBytesPerRecord: sqliteBytes / rows.length,
        frameBytes: 1024 * 1024,
      }),
    );
  } finally {
    await f.close();
  }
}, 30_000);

test("scale dense-repair: existing 1 MiB native admission refuses oversize before any Desk capture", async () => {
  const root = mkdtempSync(join(tmpdir(), "desk-scale-"));
  const shape = shapes.find((shape) => shape.id === "dense-repair")!;
  const sources = await syntheticSources(shape, root);
  const native = new HerdrClient(sources.profiles[0]!.control_socket_path);
  const f = await reviewStopFixture();
  try {
    const nativePaneFrameBytes =
      deskMetadataBytes({
        id: "synthetic-scale",
        result: { panes: sources.hosts[0]!.panes },
      }) + 1;
    expect(nativePaneFrameBytes).toBeGreaterThan(1024 * 1024);
    await expect(native.call("pane.list")).rejects.toThrow(
      "Herdr response line is too large",
    );
    expect(f.registries.desk.list().records).toEqual([]);
    expect(f.storage.terminalMarks.list()).toEqual([]);
    console.log(
      JSON.stringify({
        shape: shape.id,
        totalNativePanes: shape.panes,
        sources: shape.sources,
        nativePanesPerSource: sources.hosts[0]!.panes.length,
        nativePaneFrameBytes,
        admission: "Herdr response line is too large",
        currentDeskRows: 0,
        deskWireBytes: deskMetadataBytes(f.registries.desk.list()),
        sqliteBytes: deskMetadataBytes(f.storage.terminalMarks.list()),
        frameBytes: 1024 * 1024,
        boundary:
          "native admission; no composed-service/browser dense success claim",
      }),
    );
  } finally {
    native.close();
    await sources.close();
    await f.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
