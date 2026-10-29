export const MINIMUM_HERDR_PROTOCOL = 14;
export const MAXIMUM_HERDR_PROTOCOL = 22;
export const HERDR_IDENTITY_TTL_MS = 60_000;

// Retain legacy codecs 14-20 and current 22; never echo 21 or future protocols.
export function isSupportedHerdrProtocol(
  protocol: unknown,
): protocol is number {
  return (
    typeof protocol === "number" &&
    Number.isSafeInteger(protocol) &&
    ((protocol >= MINIMUM_HERDR_PROTOCOL && protocol <= 20) || protocol === 22)
  );
}

export function herdrCompatibility(protocol: number) {
  if (isSupportedHerdrProtocol(protocol)) return "supported";
  if (protocol < MINIMUM_HERDR_PROTOCOL) return "too-old";
  if (protocol > MAXIMUM_HERDR_PROTOCOL) return "too-new";
  return "incompatible";
}

/** A ping identifies a running server only, never its executable on disk. */
export type HerdrServerIdentity = {
  source: "running-server";
  version: string;
  protocol: number;
  readAt: number;
  expiresAt: number;
  installedBinary: null;
};

export function observeHerdrIdentity(
  raw: unknown,
  readAt: number,
): HerdrServerIdentity | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Number.isSafeInteger(readAt) ||
    readAt < 0
  )
    return null;
  const { version, protocol } = raw as Record<string, unknown>;
  if (
    typeof version !== "string" ||
    version.length > 100 ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version) ||
    typeof protocol !== "number" ||
    !Number.isSafeInteger(protocol) ||
    protocol < 1 ||
    !Number.isSafeInteger(readAt + HERDR_IDENTITY_TTL_MS)
  )
    return null;
  return {
    source: "running-server",
    version,
    protocol,
    readAt,
    expiresAt: readAt + HERDR_IDENTITY_TTL_MS,
    installedBinary: null,
  };
}

/** Expired, future-dated and malformed evidence never establishes compatibility. */
export function freshHerdrIdentity(
  raw: unknown,
  now: number,
): HerdrServerIdentity | null {
  if (!raw || typeof raw !== "object" || !Number.isFinite(now)) return null;
  const value = raw as Record<string, unknown>;
  const observed = observeHerdrIdentity(value, value.readAt as number);
  if (
    !observed ||
    value.source !== observed.source ||
    value.installedBinary !== null ||
    value.expiresAt !== observed.expiresAt ||
    now < observed.readAt ||
    now >= observed.expiresAt
  )
    return null;
  return observed;
}
