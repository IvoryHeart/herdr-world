import { expect, test } from "bun:test";
import type { AssistantContext, RecoveryTarget } from "./context";
import { createTaskRecovery } from "./task-scope-recovery";

// Exhaust the identity/availability inputs in both host orders. Service tests
// additionally exercise permission revocation and interrupted-run admission.
test("fresh-run reidentification never refreshes a replaced endpoint or workspace", async () => {
  for (const restart of [false, true])
    for (const endpointChanged of [false, true])
      for (const workspaceChanged of [false, true])
        for (const missing of [false, true])
          for (const reverse of [false, true]) {
            const targets: RecoveryTarget[] = ["alpha", "beta"].map(
              (connection_id) => ({
                connection_id,
                workspace_id: "original",
                endpoint_fingerprint: "old-endpoint",
                herdr_boot_id: "old-boot",
                workspace_identity: "original-workspace",
              }),
            );
            if (reverse) targets.reverse();
            const context = {
              captureScope: async (refs: RecoveryTarget[]) => {
                if (missing) throw new Error("Missing");
                return refs.map((ref) => ({
                  ...ref,
                  connection_label: ref.connection_id,
                  label: "Original",
                  runtime_generation: 4,
                }));
              },
              recoveryScope: async (refs: RecoveryTarget[]) =>
                refs.map((ref) => ({
                  ...ref,
                  endpoint_fingerprint: endpointChanged
                    ? "replacement-endpoint"
                    : "old-endpoint",
                  herdr_boot_id: restart ? "new-boot" : "old-boot",
                  workspace_identity: workspaceChanged
                    ? "replacement-workspace"
                    : "original-workspace",
                })),
            } as unknown as AssistantContext;
            const recovery = createTaskRecovery(
              context,
              () => undefined,
              () => true,
              () => false,
            );
            const result = await recovery.reidentify(targets);
            const canRefresh =
              restart && !endpointChanged && !workspaceChanged && !missing;
            expect(result.refreshed.size).toBe(canRefresh ? 2 : 0);
            for (const { target } of result.refreshed.values()) {
              expect(target.endpoint_fingerprint).toBe("old-endpoint");
              expect(target.workspace_identity).toBe("original-workspace");
              expect(target.herdr_boot_id).toBe("new-boot");
            }
          }
});
