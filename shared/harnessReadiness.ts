/** Safe evidence from World's bounded executable/auth probe, never account output. */
export type HarnessProbeReason =
  | "complete"
  | "missing-section"
  | "malformed-output"
  | "unreadable-status"
  | "auth-unsupported"
  | "probe-failed"
  | "timeout"
  | "windows-unsupported";

export type HarnessReadiness = {
  kind: string;
  installed: boolean | null;
  logged_in: boolean | null;
  method?: string;
  can_log_in: boolean;
  probe: {
    source: "world-harness-probe";
    state: "ok" | "unknown" | "unsupported";
    reason: HarnessProbeReason;
    /** Completion time on the World service; null for an unreadable/older reply. */
    observed_at: number | null;
  };
};

export function unknownHarnessReadiness(
  kind: string,
  reason: HarnessProbeReason,
  observedAt: number | null = null,
): HarnessReadiness {
  return {
    kind,
    installed: null,
    logged_in: null,
    can_log_in: false,
    probe: {
      source: "world-harness-probe",
      state: reason === "windows-unsupported" ? "unsupported" : "unknown",
      reason,
      observed_at: observedAt,
    },
  };
}

// Allowlisted labels only: a syntactically safe word could still be an account.
export function harnessAuthMethod(value: unknown): string | undefined {
  return typeof value === "string" &&
    [
      "claude.ai",
      "api_key",
      "bedrock",
      "vertex",
      "foundry",
      "ChatGPT",
      "API-key",
      "access-token",
      "personal-access-token",
      "workload-identity",
      "bedrock-api-key",
      "bedrock-access-keys",
    ].includes(value)
    ? value
    : undefined;
}

/** Missing/older/malformed evidence is unknown, never confirmed absence. */
export function parseHarnessReadiness(
  kind: string,
  value: unknown,
): HarnessReadiness {
  const unknown = () => unknownHarnessReadiness(kind, "malformed-output");
  if (!value || typeof value !== "object") return unknown();
  const row = value as Record<string, unknown>;
  const probe = row.probe as Record<string, unknown> | null;
  if (
    row.kind !== kind ||
    !probe ||
    typeof probe !== "object" ||
    probe.source !== "world-harness-probe" ||
    !["ok", "unknown", "unsupported"].includes(String(probe.state)) ||
    ![
      "complete",
      "missing-section",
      "malformed-output",
      "unreadable-status",
      "auth-unsupported",
      "probe-failed",
      "timeout",
      "windows-unsupported",
    ].includes(String(probe.reason)) ||
    !(
      typeof probe.observed_at === "number" &&
      Number.isSafeInteger(probe.observed_at) &&
      probe.observed_at >= 0 &&
      probe.observed_at <= 8_640_000_000_000_000
    )
  )
    return unknown();
  const result = unknownHarnessReadiness(
    kind,
    probe.reason as HarnessProbeReason,
    probe.observed_at as number | null,
  );
  if (probe.state !== result.probe.state && probe.state !== "ok")
    return unknown();
  if (probe.state === "ok") {
    if (
      probe.reason !== "complete" ||
      typeof row.installed !== "boolean" ||
      (row.installed && typeof row.logged_in !== "boolean")
    )
      return unknown();
    result.installed = row.installed;
    result.logged_in = row.installed ? (row.logged_in as boolean) : null;
    result.probe.state = "ok";
  } else if (probe.reason === "complete") return unknown();
  else if (
    row.installed === true &&
    ["unreadable-status", "auth-unsupported"].includes(String(probe.reason))
  )
    result.installed = true;
  result.can_log_in = result.installed === true && row.can_log_in === true;
  if (result.logged_in === true) {
    const method = harnessAuthMethod(row.method);
    if (method) result.method = method;
  }
  return result;
}
