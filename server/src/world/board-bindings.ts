import type { BoardDocument } from "./board-store";
import type { LegacyBindingCapture } from "../storage/legacy-bindings";
import { interestKeyPrefix } from "../../../shared/interest";

/** Layout, Desk marks, watchlists and seen state deliberately produce no captures. */
export function boardBindingCaptures(
  document: BoardDocument,
): LegacyBindingCapture[] {
  const captures: LegacyBindingCapture[] = [];
  for (const string of document.strings) {
    for (const slot of ["from", "to"] as const) {
      const end = string[slot];
      if (!("anchor" in end)) continue;
      captures.push({
        key: JSON.stringify(["string", string.id, slot]),
        ended: string.detached,
        input: {
          record_id: string.id,
          slot,
          policy: "board-string",
          adapter: "herdr",
          instance: end.anchor.connection_id,
          kind: end.anchor.kind,
          native_id: end.anchor.native_id,
          evidence: { terminals: [...end.anchor.witness] },
        },
      });
    }
  }
  for (const [key, appearance] of Object.entries(document.appearance ?? {})) {
    for (const policy of appearance.kind === "tab" &&
    appearance.color_key &&
    document.layout.colors[appearance.color_key]
      ? (["appearance", "tab-colour"] as const)
      : (["appearance"] as const)) {
      captures.push({
        key: JSON.stringify([policy, key]),
        input: {
          slot: policy,
          policy,
          adapter: "herdr",
          instance: appearance.connection_id,
          kind: appearance.kind,
          native_id: appearance.native_id,
          evidence: { terminals: [...appearance.witness] },
        },
      });
    }
  }
  for (const key of Object.keys(document.layout.interest)) {
    // Interest keys encode their owning connection and terminal, without a runtime generation.
    const separator = key.indexOf(":terminal:");
    if (separator < 1) continue;
    const instance = key.slice(0, separator);
    const terminal = key.slice(interestKeyPrefix(instance).length);
    if (terminal)
      captures.push({
        key: JSON.stringify(["interest", key]),
        input: {
          slot: "interest",
          policy: "interest",
          adapter: "herdr",
          instance,
          kind: "terminal",
          native_id: terminal,
          evidence: { terminals: [terminal] },
        },
      });
  }
  return captures;
}
