import { expect, test } from "bun:test";
import { WorldDeskRegistry } from "../../../server/src/world/desk-state";
import { WorldDeskStore } from "./deskStateStore";
import { deskIdentity, deskMetadata } from "./useDeskState";
import { partitionDesk } from "./DeskView";
import {
  pollingTargets,
  receiptStateOf,
  receiptTrigger,
  type TurnReceipt,
} from "./handoffs";
import type { WorldLeafObject } from "./worldObject";

const now = Date.UTC(2026, 0, 1, 12);
for (const observed of [false, true])
  for (const writer of ["narrow", "wide"]) {
    test(`${writer} browser shares a stop with different receipt coverage (observed: ${observed})`, async () => {
      const agents = Array.from(
        { length: 41 },
        (_, n) =>
          ({
            id: `agent-${n}`,
            terminalId: `terminal-${n}`,
            connectionId: n < 20 ? "alpha" : "beta",
            generation: 1,
            agentSessionFingerprint: "a".repeat(64),
            kind: "agent",
            status: "done",
            lastActivityAt: now - 1000,
          }) as WorldLeafObject,
      );
      // The fair 40-receipt limit admits twenty done agents from each host.
      // Beta's twenty-first agent is polled only under the narrow Hosts filter.
      const target = agents[40]!;
      const narrow = agents.filter((agent) => agent.connectionId === "beta"),
        wide = agents;
      expect(pollingTargets(narrow)).toContain(target);
      expect(pollingTargets(wide)).not.toContain(target);
      const registry = new WorldDeskRegistry();
      if (observed) {
        registry.observeAgent(deskIdentity(target), "working", now - 2000);
        registry.observeAgent(deskIdentity(target), "done", now - 1000);
      }
      const client = {
        call: async (method: string, params?: Record<string, unknown>) => {
          if (method === "world.desk.review")
            registry.mark(
              deskIdentity(target),
              String(params?.stop_id),
              params?.reviewed === true,
              now,
            );
          return registry.list();
        },
        onControl: () => () => {},
        onStatus: () => () => {},
      };
      const a = new WorldDeskStore(client),
        b = new WorldDeskStore(client);
      await Promise.all([a.refresh(), b.refresh()]);
      const receipt = {
        turn_id: "turn-7",
        ended_at: new Date(now - 1000).toISOString(),
      } as TurnReceipt;
      const card = (
        store: WorldDeskStore,
        visible: WorldLeafObject[],
        leaf = target,
      ) => {
        const state = store.get(),
          polled = pollingTargets(visible).includes(target);
        const { handled, stops } = deskMetadata([leaf], state);
        return partitionDesk(
          [leaf],
          () =>
            receiptStateOf(
              { receipt, trigger: receiptTrigger(leaf) },
              leaf,
              polled,
            ),
          handled,
          now,
          stops,
        ).review[0]!;
      };
      const first = writer === "narrow" ? card(a, narrow) : card(b, wide);
      expect(
        await (writer === "narrow" ? a : b).mutate(
          "world.desk.review",
          deskIdentity(target),
          {
            stop_id: JSON.parse(first.handoffId)[1],
            reviewed: true,
          },
        ),
      ).toBe(true);
      await Promise.all([a.refresh(), b.refresh()]);
      expect(card(a, narrow).handled).toBe(true);
      expect(card(b, wide).handled).toBe(true);
      expect(card(a, wide).handled).toBe(true);
      // A new native activity observation also distinguishes a subsequent turn
      // when the short working interval fell between service snapshot reads.
      const later = { ...target, lastActivityAt: now + 1 };
      expect(card(a, narrow, later).handled).toBe(false);
      expect(card(b, wide, later).handled).toBe(false);
      registry.observeAgent(deskIdentity(target), "working", now + 1000);
      registry.observeAgent(deskIdentity(target), "done", now + 2000);
      await Promise.all([a.refresh(), b.refresh()]);
      expect(card(a, narrow).handled).toBe(false);
      expect(card(b, wide).handled).toBe(false);
    });
  }
