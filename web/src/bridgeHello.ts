import type { BridgeHello } from "./api";

export function isBridgeHello(value: unknown): value is BridgeHello {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (
    message.hello !== true ||
    !Number.isSafeInteger(message.bridge_protocol_version) ||
    typeof message.default_connection_id !== "string" ||
    message.default_connection_id.length === 0 ||
    !message.capabilities ||
    typeof message.capabilities !== "object" ||
    Array.isArray(message.capabilities)
  ) {
    return false;
  }
  for (const field of [
    "connection_id",
    "connection_generation",
    "id",
    "result",
    "error",
    "event",
    "control",
    "terminal",
    "terminal_clipboard",
    "assistant",
    "assistant_notification",
  ]) {
    if (Object.prototype.hasOwnProperty.call(message, field)) return false;
  }
  if (
    message.service_incarnation !== undefined &&
    (typeof message.service_incarnation !== "string" ||
      !message.service_incarnation ||
      message.service_incarnation.length > 128)
  )
    return false;
  const capabilities = message.capabilities as Record<string, unknown>;
  if (
    capabilities.world_observation_v1 === true &&
    !message.service_incarnation
  )
    return false;
  for (const capability of [
    "connection_id",
    "connection_scoped_http",
    "connection_runtime_generation",
    "herdr_task_notifications",
    "world_observation_v1",
    "world_snapshot_chunks",
    "world_snapshot_chunk_admission",
    "embedded_assistant",
    "file_reveal",
  ]) {
    const value = capabilities[capability];
    if (value !== undefined && typeof value !== "boolean") return false;
  }
  return true;
}
