/**
 * Whether a Board string's Herdr target still exists, asked on the current
 * runtime. Only Herdr's own "not found" answer counts as absent; any other
 * failure is unknown, so a string is never detached on a guess.
 */

export type HerdrCall = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export type AnchorCheck = {
  kind: "workspace" | "tab" | "pane";
  native_id: string;
  isCurrent: () => boolean;
};

export type AnchorState = { state: "present" | "absent" | "unknown" };

const METHOD = {
  workspace: ["workspace.get", "workspace_id"],
  tab: ["tab.get", "tab_id"],
  pane: ["pane.get", "pane_id"],
} as const;

export async function checkAnchor(
  call: HerdrCall,
  check: AnchorCheck,
): Promise<AnchorState> {
  const entry = METHOD[check.kind];
  if (!entry || !check.native_id || !check.isCurrent())
    return { state: "unknown" };
  const [method, param] = entry;
  try {
    await call(method, { [param]: check.native_id });
    return { state: check.isCurrent() ? "present" : "unknown" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const absent = new RegExp(`\\b${check.kind}_not_found\\b`).test(message);
    // An answer from a runtime that has since retired proves nothing.
    return { state: absent && check.isCurrent() ? "absent" : "unknown" };
  }
}
