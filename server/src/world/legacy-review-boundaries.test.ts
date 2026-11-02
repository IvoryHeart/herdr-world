import { afterEach, expect, test } from "bun:test";
import {
  legacyReviewFixture,
  legacyPane,
} from "../storage/testing/legacy-review-fixture";
import { reviewStopFixture } from "./testing/review-stop-fixture";
import { LEGACY_REVIEW_TTL_MS } from "../storage/legacy-review-archive";
import {
  buildWorldObject,
  type WorldLeafObject,
} from "../../../web/src/world/worldObject";
import { isReviewedStop } from "../../../web/src/world/useReviewedWork";
import type { WorldRuntimeConnection } from "../../../web/src/world/runtimeStore";

const fixtures: Awaited<ReturnType<typeof reviewStopFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});
async function fixture(panes: Record<string, unknown>[] = [legacyPane()]) {
  const old = legacyReviewFixture();
  const f = await reviewStopFixture({ root: old.root, panes, time: 2000 });
  fixtures.push(f);
  return f;
}
function worldLeaf(
  pane: Record<string, unknown>,
  agents: Record<string, unknown>[],
  generation = 1,
): WorldLeafObject {
  return buildWorldObject([
    {
      connectionId: "alpha",
      label: "Synthetic",
      source: "saved-profile",
      isDefault: true,
      state: "ready",
      generation,
      snapshotGeneration: generation,
      stale: false,
      actionable: true,
      snapshot: {
        workspaces: [
          {
            workspace_id: "workspace",
            number: 1,
            label: "Synthetic",
            focused: true,
            pane_count: 1,
            tab_count: 1,
            agent_status: "done",
          },
        ],
        tabs: [
          {
            tab_id: "tab",
            workspace_id: "workspace",
            number: 1,
            label: "Synthetic",
            focused: true,
            pane_count: 1,
            agent_status: "done",
          },
        ],
        panes: [pane],
        agents,
      },
    } as unknown as WorldRuntimeConnection,
  ]).leaves[0]!;
}

for (const restart of [false, true])
  for (const offset of [-1, 0, 1])
    test(`resolving Desk savepoint enforces original archive deadline at offset ${offset} after restart ${restart}`, async () => {
      const f = await fixture();
      if (restart) await f.restart();
      f.advance(LEGACY_REVIEW_TTL_MS - 2 - Number(restart));
      const observe = f.storage.terminalMarks.observeLegacy;
      f.storage.terminalMarks.observeLegacy = async (...args) => {
        const proof = await observe(...args);
        expect(proof.has("terminal-0")).toBe(true);
        f.advance(1 + offset);
        return proof;
      };
      await f.observe();
      expect(f.failures).toEqual([]);
      const record = f.browsers[0]!.get().records[0];
      if (offset < 0) expect(isReviewedStop(f.leaf(), record)).toBe(true);
      else expect(record?.reviewed_stop).toBeNull();
      expect(f.storage.terminalMarks.archiveStatus().count).toBe(0);
      await f.restart();
      await f.observe();
      expect(f.browsers[0]!.get().records[0]?.reviewed_stop !== null).toBe(
        offset < 0,
      );
    });

for (const metadata of [
  "sparse session",
  "duplicate rows",
  "missing terminal",
  "other session",
] as const)
  test(`activity admission preserves the receipt until ${metadata} agrees with the actual World leaf`, async () => {
    const pane = {
      ...legacyPane(),
      last_activity_at: undefined,
      workspace_id: "workspace",
      tab_id: "tab",
    };
    const f = await fixture([pane]);
    const agent = {
      ...legacyPane(),
      ...(metadata === "sparse session" ? { agent_session: undefined } : {}),
      ...(metadata === "missing terminal" ? { terminal_id: undefined } : {}),
      ...(metadata === "other session"
        ? { agent_session: legacyPane(1).agent_session }
        : {}),
    };
    const agents =
      metadata === "duplicate rows" ? [agent, { ...agent }] : [agent];
    const leaf = worldLeaf(pane, agents);
    expect(leaf.lastActivityAt).toBe(1000);
    await f.marks.observe("alpha", 1, [pane], 2001, agents);
    await f.refresh();
    expect(f.failures).toEqual([]);
    expect(f.storage.terminalMarks.archiveStatus().count).toBe(1);
    for (const browser of f.browsers)
      expect(browser.get().records[0]?.reviewed_stop).toBeNull();
    // A later unique matching metadata row can transfer the retained receipt.
    const qualified = [legacyPane()];
    await f.marks.observe("alpha", 1, [pane], 2002, qualified);
    await f.refresh();
    expect(f.storage.terminalMarks.archiveStatus().count).toBe(0);
    for (const browser of f.browsers)
      expect(
        isReviewedStop(worldLeaf(pane, qualified), browser.get().records[0]),
      ).toBe(true);
  });

test("native pane activity permits exact transfer without trusting duplicate metadata progress", async () => {
  const pane = { ...legacyPane(), workspace_id: "workspace", tab_id: "tab" },
    f = await fixture([pane]);
  const agent = { ...legacyPane(), state_change_seq: 900 },
    agents = [agent, { ...agent }];
  await f.marks.observe("alpha", 1, [pane], 2001, agents);
  await f.refresh();
  expect(f.storage.terminalMarks.archiveStatus().count).toBe(0);
  for (const browser of f.browsers)
    expect(
      isReviewedStop(worldLeaf(pane, agents), browser.get().records[0]),
    ).toBe(true);
  expect(f.failures).toEqual([]);
});
