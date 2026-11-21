import { CoreProtocolError } from "./wire";

// The typed parameters of World's core writes (`terminal.run`, labels),
// checked before anything is sent.

/**
 * What World asks core to start. Every native parameter is set explicitly,
 * so a core whose defaults change (parent death, notes) behaves the same:
 * no `caller` (it would make World's terminal the parent), no parent, no
 * notes, and `keep` exactly as the launch chose it. `argv` is empty (the
 * host's configured shell) or starts with an absolute executable: a bare
 * program name would first load a core template of that name.
 */
export type CoreRunRequest = {
  argv: string[];
  /** Absent: the core's own folder. */
  cwd?: string;
  env?: Record<string, string>;
  labels?: Record<string, string>;
  keep: boolean;
  /** Unique among live terminals; core refuses a taken one (`name_taken`). */
  name?: string;
  size?: { cols: number; rows: number };
};

/**
 * Labels World may write: Herdr's shared ones, the app's `where` caption
 * (written once at launch) and World's own namespace.
 */
const WRITABLE_LABEL =
  /^(?:herdr\.(?:seen|pinned|space|tab)|where|herdr-world\.[a-z][a-z0-9-]{0,31})$/;
const MAX_LABEL_VALUE = 1024;
const MAX_ARG = 16 * 1024;

export function checkLabels(labels: Record<string, string>) {
  const entries = Object.entries(labels);
  if (entries.length > 16) throw new CoreProtocolError("too many labels");
  for (const [key, value] of entries) {
    if (!WRITABLE_LABEL.test(key))
      throw new CoreProtocolError(`World does not write label ${key}`);
    if (typeof value !== "string" || value.length > MAX_LABEL_VALUE)
      throw new CoreProtocolError(`label ${key} is too long`);
  }
  return Object.fromEntries(entries);
}

/** An absolute path on a Unix host (`/…`) or a Windows one (`C:\\…`). */
const ABSOLUTE = /^(?:\/|[A-Za-z]:\\)[^\0]*$/;

/** Fresh native `terminal.run` parameters from a typed request. */
export function coreRunParams(request: CoreRunRequest) {
  const argv = request.argv.map(String);
  if (argv.length > 0 && !ABSOLUTE.test(argv[0]!))
    throw new CoreProtocolError("a program must be an absolute executable");
  if (argv.some((arg) => arg.length > MAX_ARG || arg.includes("\0")))
    throw new CoreProtocolError("a program argument is invalid");
  if (request.cwd !== undefined && !ABSOLUTE.test(request.cwd))
    throw new CoreProtocolError("the working folder must be absolute");
  const env = Object.fromEntries(
    Object.entries(request.env ?? {}).map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || /^HC_/.test(key))
        throw new CoreProtocolError(`World does not set ${key}`);
      return [key, String(value)];
    }),
  );
  if (request.name !== undefined && !/^[a-z0-9_.-]{1,32}$/.test(request.name))
    throw new CoreProtocolError("a terminal name is invalid");
  const size = request.size;
  if (
    size &&
    !(
      Number.isSafeInteger(size.cols) &&
      Number.isSafeInteger(size.rows) &&
      size.cols > 0 &&
      size.rows > 0 &&
      size.cols <= 1000 &&
      size.rows <= 1000
    )
  )
    throw new CoreProtocolError("a terminal size is invalid");
  return {
    argv,
    ...(request.cwd !== undefined ? { cwd: request.cwd } : {}),
    env,
    labels: checkLabels(request.labels ?? {}),
    keep: request.keep === true,
    ...(request.name !== undefined ? { name: request.name } : {}),
    no_parent: true,
    no_notify: true,
    outlive_parent: false,
    ...(size ? { size: { cols: size.cols, rows: size.rows } } : {}),
  };
}
