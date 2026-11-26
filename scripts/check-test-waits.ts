/**
 * Fixed sleeps in test files (#1419): a test reacts to the thing it checks
 * (an event, a promise, a message, a DOM change, a counted read) instead of
 * pausing. This check fails on a new pause in a test file; the allowlist in
 * `scripts/test-waits-allowlist.json` only shrinks.
 *
 * A pause is `Bun.sleep(ms)`, `Bun.sleepSync(ms)`, a `setTimeout` that only
 * resolves a promise, `setTimeout(ms)` from `node:timers/promises`, or a call
 * of a helper that pauses (`settle()`, `sleep(80)`), in the same file or
 * imported from another test file. Not pauses: a 0 ms yield, a deadline
 * timer that rejects, and a poll tick of at most `POLL_TICK_MS` inside a loop
 * (the last resort when nothing signals).
 *
 * `bun scripts/check-test-waits.ts --update` lowers the allowlist to the
 * current counts; it never raises one.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { parse } from "@babel/parser";

const ALLOWLIST = "scripts/test-waits-allowlist.json";
const POLL_TICK_MS = 10;
/** @internal */
export const TEST_FILE =
  /(?:\.(?:test|browser)\.[cm]?[jt]sx?|\.(?:fixture|cases|browserMock)\.[cm]?[jt]sx?|\/testing\/[^/]+\.[cm]?[jt]sx?)$/;
const RESOLVER = /^(?:resolve\w*|res|r|done|wake\w*|next|ok)$/;
const LOOPS = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);
const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
]);

type Node = {
  type: string;
  loc?: { start: { line: number } };
  [key: string]: unknown;
};
type Delay = number | "unknown" | "none";
type Site = { line: number; delay: Delay; loop: boolean; helper?: string };
type FileScan = {
  /** Pause lines counted against the allowlist. */
  pauses: number[];
  /** Helpers that pause once per call, by name, for importing files. */
  exported: Set<string>;
};

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "extra" ||
      key.endsWith("Comments")
    )
      continue;
    if (Array.isArray(value)) {
      for (const item of value)
        if (item && typeof item === "object" && "type" in item)
          out.push(item as Node);
    } else if (value && typeof value === "object" && "type" in value)
      out.push(value as Node);
  }
  return out;
}

function delayOf(argument: Node | undefined): Delay {
  if (!argument) return "none";
  if (argument.type === "NumericLiteral") return argument.value as number;
  return "unknown";
}

const isIdentifier = (node: unknown, name?: string | RegExp): boolean =>
  !!node &&
  (node as Node).type === "Identifier" &&
  (name === undefined ||
    (typeof name === "string"
      ? (node as Node).name === name
      : name.test((node as Node).name as string)));

/** `resolve` or `() => resolve(...)`: a callback that only settles a promise. */
function onlyResolves(callback: Node | undefined, executorParam?: string) {
  const resolver = (node: unknown) =>
    isIdentifier(node, RESOLVER) ||
    (executorParam !== undefined && isIdentifier(node, executorParam));
  if (!callback) return false;
  if (resolver(callback)) return true;
  if (
    callback.type !== "ArrowFunctionExpression" &&
    callback.type !== "FunctionExpression"
  )
    return false;
  let body = callback.body as Node;
  if (body.type === "BlockStatement") {
    const statements = body.body as Node[];
    if (
      statements.length !== 1 ||
      statements[0]!.type !== "ExpressionStatement"
    )
      return false;
    body = statements[0]!.expression as Node;
  }
  return body.type === "CallExpression" && resolver(body.callee);
}

/** The name a function node is bound to, when it is a named helper. */
function helperName(node: Node, parent: Node | undefined): string | null {
  if (node.type === "FunctionDeclaration" && isIdentifier(node.id))
    return (node.id as Node).name as string;
  if (
    (node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression") &&
    parent?.type === "VariableDeclarator" &&
    isIdentifier(parent.id)
  )
    return (parent.id as Node).name as string;
  return null;
}

type Call = {
  name: string;
  line: number;
  delay: Delay;
  loop: boolean;
  helper?: string;
};
/** One file's pause facts, parsed once. */
type Parsed = {
  sites: Site[];
  calls: Call[];
  /** Local import name → `source#exported name`, for relative imports. */
  imports: Map<string, string>;
  exportedNames: Set<string>;
  /** Lines importing `setTimingsForTests`. */
  timingSwitches: number[];
};

function isCall(node: Node, object: string, property: string | RegExp) {
  const callee = node.callee as Node;
  return (
    callee?.type === "MemberExpression" &&
    isIdentifier(callee.object, object) &&
    isIdentifier(callee.property, property)
  );
}

function parseSource(path: string, text: string): Parsed {
  const ast = parse(text, {
    sourceType: "module",
    errorRecovery: true,
    plugins: /x$/.test(path) ? ["typescript", "jsx"] : ["typescript"],
  }) as unknown as Node;
  const timersPromises = new Set<string>();
  const imports = new Map<string, string>();
  const exportedNames = new Set<string>();
  const timingSwitches: number[] = [];
  for (const statement of (ast.program as Node).body as Node[]) {
    if (statement.type === "ImportDeclaration") {
      const source = (statement.source as Node).value as string;
      for (const specifier of statement.specifiers as Node[]) {
        const local = (specifier.local as Node).name as string;
        const name =
          specifier.type === "ImportSpecifier"
            ? (((specifier.imported as Node).name ??
                (specifier.imported as Node).value) as string)
            : null;
        if (name === "setTimingsForTests")
          timingSwitches.push(statement.loc?.start.line ?? 0);
        if (
          /^(?:node:)?timers\/promises$/.test(source) &&
          name === "setTimeout"
        )
          timersPromises.add(local);
        else if (source.startsWith(".") && name)
          imports.set(local, `${source}#${name}`);
      }
    }
    if (statement.type === "ExportNamedDeclaration") {
      const declaration = statement.declaration as Node | null;
      if (declaration?.type === "FunctionDeclaration" && declaration.id)
        exportedNames.add((declaration.id as Node).name as string);
      if (declaration?.type === "VariableDeclaration")
        for (const item of declaration.declarations as Node[])
          if (isIdentifier(item.id))
            exportedNames.add((item.id as Node).name as string);
      for (const specifier of (statement.specifiers as Node[]) ?? [])
        exportedNames.add((specifier.local as Node).name as string);
    }
  }

  // Primitive pauses and identifier calls, each with its nearest named
  // helper and whether a loop lies between them and that helper.
  const sites: Site[] = [];
  const calls: Call[] = [];
  const walk = (
    node: Node,
    parent: Node | undefined,
    helper: string | undefined,
    loop: boolean,
    executorParam: string | undefined,
  ) => {
    let nextHelper = helper;
    let nextLoop = loop;
    let nextExecutor = executorParam;
    if (FUNCTIONS.has(node.type)) {
      // A named helper starts a fresh loop context; an inline callback
      // inside a loop still runs once per iteration.
      const name = helperName(node, parent);
      if (name) {
        nextHelper = name;
        nextLoop = false;
      }
      if (
        parent?.type === "NewExpression" &&
        isIdentifier(parent.callee, "Promise")
      ) {
        const first = (node.params as Node[])[0];
        nextExecutor = isIdentifier(first)
          ? ((first as Node).name as string)
          : undefined;
      }
    }
    if (LOOPS.has(node.type)) nextLoop = true;
    if (node.type === "CallExpression") {
      // A timer raced against real work bounds a failure; it is no pause.
      if (isCall(node, "Promise", /^(?:race|any)$/)) return;
      const callee = node.callee as Node;
      const args = node.arguments as Node[];
      const line = node.loc?.start.line ?? 0;
      let delay: Delay | null = null;
      if (isCall(node, "Bun", /^sleep(?:Sync)?$/)) delay = delayOf(args[0]);
      else if (
        (isIdentifier(callee, "setTimeout") ||
          (callee.type === "MemberExpression" &&
            isIdentifier(callee.property, "setTimeout"))) &&
        onlyResolves(args[0], executorParam)
      )
        delay = delayOf(args[1]);
      else if (
        isIdentifier(callee) &&
        timersPromises.has(callee.name as string)
      )
        delay = delayOf(args[0]);
      if (delay !== null) sites.push({ line, delay, loop, helper });
      else if (isIdentifier(callee))
        calls.push({
          name: callee.name as string,
          line,
          delay: delayOf(args[0]),
          loop,
          helper,
        });
    }
    for (const child of children(node))
      walk(child, node, nextHelper, nextLoop, nextExecutor);
  };
  walk(ast.program as Node, undefined, undefined, false, undefined);
  return { sites, calls, imports, exportedNames, timingSwitches };
}

const counts = (site: { delay: Delay; loop: boolean }) =>
  !(site.delay === "none" || site.delay === 0) &&
  !(site.loop && typeof site.delay === "number" && site.delay <= POLL_TICK_MS);

/**
 * Pause lines of one parsed file. `importedPausing` holds the local names of
 * imported helpers that pause once per call.
 */
function resolvePauses(
  parsed: Parsed,
  importedPausing: ReadonlySet<string> = new Set(),
): FileScan {
  const { sites, calls } = parsed;
  // A helper pauses once per call when it pauses outside a loop; so does a
  // helper calling one outside a loop.
  const pausing = new Set(importedPausing);
  const helpers = new Set(
    [...sites, ...calls].flatMap((entry) =>
      entry.helper ? [entry.helper] : [],
    ),
  );
  for (const site of sites)
    if (site.helper && !site.loop && counts(site)) pausing.add(site.helper);
  for (let changed = true; changed; ) {
    changed = false;
    for (const call of calls)
      if (
        pausing.has(call.name) &&
        call.helper &&
        !call.loop &&
        !pausing.has(call.helper) &&
        helpers.has(call.helper)
      ) {
        pausing.add(call.helper);
        changed = true;
      }
  }
  // Count each pause once: at the call sites of a pausing helper, not inside.
  // A helper only handed on as a value (`{ settle }`) keeps its own count.
  const called = new Set([
    ...calls.map((call) => call.name),
    ...parsed.exportedNames,
  ]);
  const inPausingHelper = (entry: { helper?: string; loop: boolean }) =>
    !!entry.helper &&
    !entry.loop &&
    pausing.has(entry.helper) &&
    called.has(entry.helper);
  const pauses = [
    ...sites
      .filter((site) => counts(site) && !inPausingHelper(site))
      .map((site) => site.line),
    ...calls
      .filter(
        (call) =>
          pausing.has(call.name) &&
          !inPausingHelper(call) &&
          // `settle()` pauses; `sleep(0)` yields; `sleep(5)` in a loop polls.
          counts({
            delay: call.delay === "none" ? "unknown" : call.delay,
            loop: call.loop,
          }),
      )
      .map((call) => call.line),
  ].sort((a, b) => a - b);
  return {
    pauses,
    exported: new Set(
      [...parsed.exportedNames].filter((name) => pausing.has(name)),
    ),
  };
}

/** @internal Convenience for one file without cross-file helpers. */
export function scanSource(path: string, text: string): FileScan {
  return resolvePauses(parseSource(path, text));
}

const EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  "/index.ts",
  "/index.tsx",
];

/** @internal Pause lines per test file, following pausing helpers across test files. */
export function scanFiles(files: Map<string, string>): Map<string, number[]> {
  const resolveImport = (from: string, source: string) => {
    for (const extension of EXTENSIONS) {
      const candidate = normalize(join(dirname(from), source + extension));
      if (files.has(candidate)) return candidate;
    }
    return null;
  };
  // Parsing is the cost: parse only files that can pause, by a timer of
  // their own or through a helper imported from one that can.
  const canPause = new Set(
    [...files]
      .filter(([, text]) => /sleep|setTimeout/i.test(text))
      .map(([path]) => path),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const [path, text] of files)
      if (
        !canPause.has(path) &&
        [...text.matchAll(/from\s+["'](\.[^"']+)["']/g)].some((match) => {
          const target = resolveImport(path, match[1]!);
          return target !== null && canPause.has(target);
        })
      ) {
        canPause.add(path);
        grew = true;
      }
  }
  const parsed = new Map(
    [...canPause].map(
      (path) => [path, parseSource(path, files.get(path)!)] as const,
    ),
  );
  const targets = new Map<string, { local: string; ref: string }[]>();
  for (const [path, file] of parsed) {
    const list: { local: string; ref: string }[] = [];
    for (const [local, ref] of file.imports) {
      const [source, name] = ref.split("#") as [string, string];
      const target = resolveImport(path, source);
      if (target) list.push({ local, ref: `${target}#${name}` });
    }
    targets.set(path, list);
  }
  // Exported pausing helpers settle once no new one appears.
  let exported = new Set<string>();
  let result = new Map<string, number[]>();
  for (;;) {
    const next = new Set<string>();
    result = new Map([...files.keys()].map((path) => [path, []]));
    for (const [path, file] of parsed) {
      const importedPausing = new Set(
        targets
          .get(path)!
          .filter((target) => exported.has(target.ref))
          .map((target) => target.local),
      );
      const scan = resolvePauses(file, importedPausing);
      result.set(path, scan.pauses);
      for (const name of scan.exported) next.add(`${path}#${name}`);
    }
    if (next.size === exported.size) break;
    exported = next;
  }
  return result;
}

/** @internal Files outside test code that import the test-timing switch. */
export function timingSwitchesOutsideTests(
  files: Map<string, string>,
): string[] {
  const problems: string[] = [];
  for (const [path, text] of files) {
    if (TEST_FILE.test(path) || !text.includes("setTimingsForTests")) continue;
    for (const line of parseSource(path, text).timingSwitches)
      problems.push(
        `${path}:${line}: only test code and the test service launcher may switch product timings (setTimingsForTests).`,
      );
  }
  return problems;
}

type Entry = { pauses: number; reason: string };
type Allowlist = Record<string, Entry>;

/** @internal */
export function parseAllowlist(text: string): Allowlist {
  const value = JSON.parse(text) as { version?: number; files?: Allowlist };
  if (value.version !== 1 || !value.files || typeof value.files !== "object")
    throw new Error(`${ALLOWLIST}: expected version 1 and files`);
  for (const [path, entry] of Object.entries(value.files))
    if (
      !Number.isSafeInteger(entry?.pauses) ||
      entry.pauses < 1 ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim() ||
      entry.reason.includes("\n")
    )
      throw new Error(
        `${ALLOWLIST}: ${path} needs a positive pause count and a one-line reason`,
      );
  return value.files;
}

/** @internal Problems with the current counts against the allowlist and its base. */
export function compare(
  current: Map<string, number[]>,
  allowed: Allowlist,
  base?: Allowlist,
): string[] {
  const problems: string[] = [];
  for (const [path, lines] of current) {
    const limit = allowed[path]?.pauses ?? 0;
    if (lines.length > limit)
      problems.push(
        `${path}: ${lines.length} fixed sleep(s) (lines ${lines.join(", ")}), allowlist ${limit}. Wait for the event, promise, message or DOM change instead, or count the cycles that prove nothing happened.`,
      );
    else if (lines.length < limit)
      problems.push(
        `${path}: ${lines.length} fixed sleep(s), allowlist ${limit}: lower it (bun scripts/check-test-waits.ts --update).`,
      );
  }
  for (const path of Object.keys(allowed))
    if (!current.has(path))
      problems.push(
        `${path}: no longer a test file; remove its allowlist entry.`,
      );
  if (base)
    for (const [path, entry] of Object.entries(allowed))
      if (entry.pauses > (base[path]?.pauses ?? 0))
        problems.push(
          `${path}: the allowlist may only shrink (base ${base[path]?.pauses ?? 0}, now ${entry.pauses}).`,
        );
  return problems;
}

/** @internal The allowlist lowered to the current counts; never raised. */
export function lowered(
  current: Map<string, number[]>,
  allowed: Allowlist,
): Allowlist {
  const out: Allowlist = {};
  for (const [path, entry] of Object.entries(allowed).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const count = current.get(path)?.length ?? 0;
    if (count > 0)
      out[path] = { ...entry, pauses: Math.min(entry.pauses, count) };
  }
  return out;
}

/** @internal */
export function formatAllowlist(files: Allowlist) {
  return `${JSON.stringify(
    {
      version: 1,
      description:
        "Fixed sleeps a test file may still hold (#1419). Counts only go down: fix a file, then run bun scripts/check-test-waits.ts --update.",
      files,
    },
    null,
    2,
  )}\n`;
}

/** Tracked and new source files, by path. */
function sourceFiles(root: string) {
  const listed = Bun.spawnSync(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root },
  );
  if (listed.exitCode !== 0) throw new Error("git ls-files failed");
  const files = new Map<string, string>();
  for (const path of listed.stdout.toString().split("\0"))
    if (
      path &&
      /\.[cm]?[jt]sx?$/.test(path) &&
      !path.includes("node_modules/") &&
      existsSync(join(root, path))
    )
      files.set(path, readFileSync(join(root, path), "utf8"));
  return files;
}

/** The allowlist at the PR base, so raising it cannot bless a new sleep. */
function allowlistAtBase(root: string): Allowlist | undefined {
  const git = (args: string[]) =>
    Bun.spawnSync(["git", ...args], { cwd: root });
  const merge = git(["merge-base", "HEAD", "origin/main"]);
  const ref =
    process.env.HERDR_WORLD_RATCHET_TARGET ||
    (merge.exitCode === 0 ? merge.stdout.toString().trim() : undefined);
  if (!ref) return;
  if (git(["rev-parse", "--verify", `${ref}^{commit}`]).exitCode !== 0)
    throw new Error(`Cannot resolve the test-waits allowlist base ${ref}`);
  const entry = `${ref}:${ALLOWLIST}`;
  // A base predating this check is its adoption.
  if (git(["cat-file", "-e", entry]).exitCode !== 0) return;
  return parseAllowlist(git(["show", entry]).stdout.toString());
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const sources = sourceFiles(root);
  const current = scanFiles(
    new Map([...sources].filter(([path]) => TEST_FILE.test(path))),
  );
  const allowed = parseAllowlist(readFileSync(join(root, ALLOWLIST), "utf8"));
  if (process.argv.includes("--update")) {
    writeFileSync(
      join(root, ALLOWLIST),
      formatAllowlist(lowered(current, allowed)),
    );
    console.info(`${ALLOWLIST}: lowered to the current counts`);
  } else {
    const problems = [
      ...compare(current, allowed, allowlistAtBase(root)),
      ...timingSwitchesOutsideTests(sources),
    ];
    const total = [...current.values()].reduce(
      (sum, lines) => sum + lines.length,
      0,
    );
    if (problems.length) {
      for (const problem of problems) console.error(problem);
      process.exit(1);
    }
    console.info(
      `test waits: ${total} allowlisted fixed sleep(s) in ${Object.keys(allowed).length} file(s); no new ones`,
    );
  }
}
