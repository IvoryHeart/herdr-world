import type { WorldSnapshotPriority } from "./snapshot";

const MAX_NATIVE_ID_LENGTH = 512;

export function nativeId(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NATIVE_ID_LENGTH
    ? value
    : null;
}

export function priorityKey(
  connectionId: string,
  priorities: readonly WorldSnapshotPriority[],
) {
  return JSON.stringify(
    priorities.filter(({ connection_id }) => connection_id === connectionId),
  );
}
