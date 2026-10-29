import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

/**
 * What a change affects, for the scoped pre-push gate: the unit tests and
 * World browser suites that reach a changed file through their imports, and
 * whether behavioral verification must run. Anything the graph cannot place
 * (toolchain, lockfile, configuration, the gate itself, an unknown source)
 * asks for the full gate instead. CI's full gate stays the authority; this
 * only decides what runs locally before a push.
 */

const CODE = /\.(?:m?[jt]sx?)$/;
export const TEST = /\.test\.(?:m?[jt]sx?)$/;
/** Files whose references the always-run static lane (the build) exercises. */
const BUILT = new Set(["web/vite.config.ts"]);
/** A test that drives Chrome, as World's browser inventory recognises one. */
export const CHROME = /CHROME_BIN|--headless/;
const RESOLVE = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];

/** Changes that can alter any result: run the full gate. */
const FULL = [
  /^package\.json$/,
  /^(?:AGENTS|CONTRIBUTING)\.md$/,
  /^\.agents\//,
  /^(?:web|server)\/package\.json$/,
  /^bun\.lockb?$/,
  /^bunfig\.toml$/,
  /^\.github\/workflows\//,
  /^scripts\/(?:validation-scope|ci-tests|ci-verification|ci-reuse-full-check|ci-delivery-result|check-pr-body|file-size-ratchet)\.ts$/,
  /(?:^|\/)tsconfig[^/]*\.json$/,
  /^web\/vite\.config\.ts$/,
  /^web\/index\.html$/,
  /^biome\.json$/,
  /^\.oxlintrc\.json$/,
  /^\.githooks\//,
  /^scripts\/(?:affected|check-delivery|run-tests|run-world-tests|world-browser-suites)\.ts$/,
];

/** Inputs of behavioral verification besides the adapters' imports. */
const VERIFICATION = [
  /^verification\//,
  /^quint\//,
  /^tools\/quint\//,
  /^openspec\//,
];

/** Text that cannot change a test result. */
const INERT = [
  /\.md$/,
  /^docs\//,
  /^openspec\//,
  /^LICENSE/,
  /^\.github\/(?:ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)/,
];

export type Affected =
  | { full: true; reason: string }
  | {
      full: false;
      unit: string[];
      browser: string[];
      verification: boolean;
    };

export type Graph = {
  /** file → files it imports, bundles or names */
  deps: Map<string, Set<string>>;
  /** every tracked file, and every file the change deleted */
  files: Set<string>;
  /** files the change deleted: still resolvable, so their consumers are found */
  gone: Set<string>;
};

/** Every relative import, bundled fixture or named data file a file refers to. */
export function references(
  path: string,
  text: string,
  files: ReadonlySet<string>,
  byBasename: ReadonlyMap<string, readonly string[]>,
) {
  const dir = dirname(path);
  const out = new Set<string>();
  const add = (candidate: string) => {
    for (const suffix of RESOLVE) {
      const full = normalize(candidate + suffix);
      if (files.has(full)) {
        out.add(full);
        return true;
      }
    }
    return false;
  };
  // Imports, CSS @import, and new URL("./x", import.meta.url) (Vite aliases).
  for (const match of text.matchAll(
    /(?:from\s*|import\s*\(?\s*|require\s*\(\s*|@import\s+(?:url\(\s*)?|new URL\(\s*)["'`](\.{1,2}\/[^"'`]+)["'`]/g,
  ))
    add(join(dir, match[1]!));
  if (TEST.test(path) || path.includes("/testing/")) {
    // Tests bundle fixtures by name and read data files by path at run time.
    // A type that lists every name is not a use of any one of them.
    const values = text.replace(/^\s*(?:export\s+)?type\s[^;]*;/gm, "");
    for (const match of values.matchAll(/["'`]([\w./@-]+)["'`]/g)) {
      const literal = match[1]!;
      // A bare name ("HostsFilter", "terminalLinks") is a fixture to bundle,
      // never a module.
      const bare = /^[A-Za-z][\w.]*$/.test(literal);
      if (!bare && (add(join(dir, literal)) || add(literal))) continue;
      if (bare) {
        if (
          add(join(dir, `${literal}.browser.tsx`)) ||
          add(join("web/src/world", `${literal}.browser.tsx`))
        )
          continue;
      }
      // A file name only one tracked file has ("ci.yml"), however joined.
      const name = literal.split("/").pop()!;
      const named = byBasename.get(name);
      if (named?.length === 1 && /\.[a-z]{2,5}$/.test(name)) out.add(named[0]!);
    }
  }
  out.delete(path);
  return out;
}

export function buildGraph(
  root: string,
  tracked: readonly string[],
  deleted: readonly string[] = [],
): Graph {
  const gone = new Set(deleted.filter((path) => !tracked.includes(path)));
  const files = new Set([...tracked, ...gone]);
  const byBasename = new Map<string, string[]>();
  for (const file of files) {
    const name = file.split("/").pop()!;
    byBasename.set(name, [...(byBasename.get(name) ?? []), file]);
  }
  const deps = new Map<string, Set<string>>();
  for (const path of files) {
    if (!(CODE.test(path) || path.endsWith(".css")) || gone.has(path)) continue;
    deps.set(
      path,
      references(
        path,
        readFileSync(join(root, path), "utf8"),
        files,
        byBasename,
      ),
    );
  }
  return { deps, files, gone };
}

/** Who refers to each file. */
function reverseOf(graph: Graph) {
  const reverse = new Map<string, string[]>();
  for (const [file, targets] of graph.deps)
    for (const target of targets) {
      const list = reverse.get(target) ?? [];
      list.push(file);
      reverse.set(target, list);
    }
  return reverse;
}

/** Every file that reaches `from`, with its distance in references. */
export function distances(
  reverse: ReadonlyMap<string, readonly string[]>,
  from: string,
) {
  const seen = new Map([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const next = queue[i]!;
    for (const parent of reverse.get(next) ?? [])
      if (!seen.has(parent)) {
        seen.set(parent, seen.get(next)! + 1);
        queue.push(parent);
      }
  }
  return seen;
}

/**
 * Unit tests: every test that reaches a changed file (they are cheap).
 * Browser suites: for each changed file, the suites nearest to it, ties
 * included. A broad acceptance suite that mounts the whole app reaches almost
 * everything; it runs locally when nothing closer covers the change, and on
 * CI always.
 * Verification: when its inputs, or a contract owner it maps, change.
 */
export function affected(
  graph: Graph,
  changed: readonly string[],
  browserSuites: readonly string[],
  owns: (path: string) => boolean = () => false,
): Affected {
  let verification = false;
  for (const path of changed) {
    if (FULL.some((rule) => rule.test(path)))
      return { full: true, reason: `${path} affects every check` };
    if (VERIFICATION.some((rule) => rule.test(path)) || owns(path))
      verification = true;
  }
  const reverse = reverseOf(graph);
  const suites = new Set(browserSuites);
  const unit = new Set<string>();
  const browser = new Set<string>();
  for (const path of changed) {
    if (!graph.files.has(path))
      return { full: true, reason: `${path} is not a tracked file` };
    const reach = distances(reverse, path);
    let nearest = Infinity;
    let tested = false;
    for (const [file, distance] of reach) {
      if (!TEST.test(file) || graph.gone.has(file)) continue;
      tested = true;
      if (!suites.has(file)) unit.add(file);
      else nearest = Math.min(nearest, distance);
    }
    for (const [file, distance] of reach)
      if (suites.has(file) && distance === nearest) browser.add(file);
    if (tested) continue;
    // The build, which always runs, uses it (a release alias, say).
    if ([...reach.keys()].some((file) => BUILT.has(file))) continue;
    // Code no test reaches is covered only by verification, when its
    // adapters reach it or it is one of verification's own inputs.
    const modeled =
      owns(path) ||
      VERIFICATION.some((rule) => rule.test(path)) ||
      [...reach.keys()].some((file) => file.startsWith("quint/"));
    if (modeled) {
      verification = true;
      continue;
    }
    // A deleted file nothing still refers to cannot break anything left.
    if (graph.gone.has(path) && reach.size === 1) continue;
    if (INERT.some((rule) => rule.test(path))) continue;
    return { full: true, reason: `no check is known to cover ${path}` };
  }
  return {
    full: false,
    unit: [...unit].sort(),
    browser: [...browser].sort(),
    verification,
  };
}

/**
 * Whether verification/coverage.json names a path as a contract owner: a
 * file, or a directory written with a trailing slash.
 */
export function coverageOwners(root: string) {
  const coverage = JSON.parse(
    readFileSync(join(root, "verification/coverage.json"), "utf8"),
  ) as { areas: { owner?: string }[] };
  const owners = coverage.areas.flatMap((area) =>
    area.owner ? [area.owner] : [],
  );
  return (path: string) =>
    owners.some((owner) =>
      owner.endsWith("/") ? path.startsWith(owner) : path === owner,
    );
}

/** Tracked files, and the files changed since `base` (committed or not). */
export function gitChanges(root: string, base: string, head = "HEAD") {
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: root });
    if (result.exitCode !== 0)
      throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
    return result.stdout.toString().split("\n").filter(Boolean);
  };
  const tracked = git("ls-files");
  // Renames count as a deletion and an addition, so both sides are checked.
  const changed = new Set([
    ...git("diff", "--name-only", "--no-renames", base, head),
    ...(head === "HEAD"
      ? git("diff", "--name-only", "--no-renames", "HEAD")
      : []),
  ]);
  const present = new Set(tracked);
  const sorted = [...changed].sort();
  return {
    tracked,
    changed: sorted,
    deleted: sorted.filter((path) => !present.has(path)),
  };
}

if (import.meta.main) {
  const { worldBrowserSuites } = await import("./world-browser-suites");
  const root = process.cwd();
  const base = process.argv[2] ?? "origin/main";
  const { tracked, changed, deleted } = gitChanges(root, base, process.argv[3]);
  const result = affected(
    buildGraph(root, tracked, deleted),
    changed,
    worldBrowserSuites,
    coverageOwners(root),
  );
  console.log(JSON.stringify({ base, changed, ...result }, null, 2));
}
