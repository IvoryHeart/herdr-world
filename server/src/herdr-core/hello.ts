import { CoreIncompatibleError } from "./errors";

/**
 * Core's `hello`: the protocol generation World speaks and what a core must
 * offer before World observes it. Optional methods and features are each
 * checked where they are used.
 */

/** The protocol generation World speaks; core refuses any other in `hello`. */
export const CORE_PROTOCOL_GENERATION = 1;
/** Methods observation needs, built from typed verbs. */
export const OBSERVATION_METHODS = [
  "server.status",
  "terminal.list",
  "terminal.get",
  "terminal.read",
  "events.subscribe",
] as const;
export type ObservationMethod = (typeof OBSERVATION_METHODS)[number];
/** Required for observation; absence is an unsupported operation, not a pin. */
export const REQUIRED_CORE_METHODS: readonly string[] = OBSERVATION_METHODS;
export const REQUIRED_CORE_FEATURES = ["framed", "events"] as const;

export type CoreHello = {
  generation: number;
  version: string;
  core: { id: string; name: string };
  methods: string[];
  features: string[];
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseHello(value: unknown): CoreHello {
  if (!isRecord(value))
    throw new CoreIncompatibleError("hello reply is invalid");
  const core = value.core;
  if (
    value.generation !== CORE_PROTOCOL_GENERATION ||
    value.framed !== true ||
    typeof value.version !== "string" ||
    !isRecord(core) ||
    typeof core.id !== "string" ||
    !core.id ||
    typeof core.name !== "string" ||
    !Array.isArray(value.methods) ||
    !Array.isArray(value.features)
  )
    throw new CoreIncompatibleError("hello reply is not framed generation 1");
  const methods = value.methods.filter(
    (m): m is string => typeof m === "string",
  );
  const features = value.features.filter(
    (f): f is string => typeof f === "string",
  );
  const missing = [
    ...REQUIRED_CORE_METHODS.filter((m) => !methods.includes(m)),
    ...REQUIRED_CORE_FEATURES.filter((f) => !features.includes(f)),
  ];
  if (missing.length > 0)
    throw new CoreIncompatibleError(
      `core ${value.version} lacks ${missing.join(", ")}`,
    );
  return {
    generation: value.generation,
    version: value.version,
    core: { id: core.id, name: core.name },
    methods,
    features,
  };
}
