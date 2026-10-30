import { expect, test } from "bun:test";
import type { ConnectionStatus } from "../connections/types";
import { WorldSnapshotService } from "./snapshot";

for (const mode of ["complete", "dirty", "malformed", "retired"])
  test(`terminal settings admission uses only a complete clean current pane list: ${mode}`, async () => {
    const panes = Array.from({ length: 4100 }, (_, i) => ({
      pane_id: `w1:p${i}`,
      terminal_id: `term_${i}`,
      workspace_id: "w1",
      tab_id: "w1:t1",
    }));
    let current = true;
    const runtime = {
      herdr: {
        call: async (method: string): Promise<unknown> => {
          if (method === "workspace.list")
            return { workspaces: [{ workspace_id: "w1" }] };
          if (method === "tab.list")
            return { tabs: [{ tab_id: "w1:t1", workspace_id: "w1" }] };
          if (method === "agent.list") return { agents: [] };
          if (mode === "dirty") service.invalidate("alpha");
          if (mode === "retired") current = false;
          return mode === "malformed" ? {} : { panes };
        },
      },
    };
    const observed: number[] = [];
    const status: ConnectionStatus = {
      id: "alpha",
      label: "Alpha",
      source: "saved-profile",
      is_default: true,
      state: "ready",
      generation: 1,
    };
    const service = new WorldSnapshotService(
      {
        list: () => [status],
        readyRuntimeLease: () => ({
          connectionId: "alpha",
          generation: 1,
          isCurrent: () => current,
          runtime,
        }),
      },
      () => 1,
      undefined,
      undefined,
      undefined,
      undefined,
      (_id, _generation, completePanes) => {
        observed.push(completePanes.length);
      },
    );
    const result = await service.snapshot();
    if (mode === "complete") {
      expect(observed).toEqual([4100]);
      expect(result.connections[0]!.snapshot!.panes.length).toBeLessThan(4100);
    } else expect(observed).toEqual([]);
  });
