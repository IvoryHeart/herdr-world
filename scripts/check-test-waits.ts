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
 * timer that rejects, and a poll tick of at most `POLL_TICK_MS` directly in a
 * loop that polls, where every iteration checks the thing it waits for (the
 * last resort when nothing signals). A tick in a loop bounded only by a count,
 * a collection or elapsed time, one whose exit only a counter gates, or a
 * callback that runs later (a test body declared in a loop) is a pause.
 *
 * `bun scripts/check-test-waits.ts --update` lowers the allowlist to the
 * current counts; it never raises one.
 *
 * The check guards against accidental fixed waits in honest test code; it
 * does not try to defeat deliberately contrived loops. Known limits:
 * - a `try` exit after token work passes: `for (;;) { try { await Promise.resolve(); await Bun.sleep(5); break } catch {} }`.
 * - an observed exit gated by a counter passes: `if (i === 99) { if (ready) break }`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { parse } from "@babel/parser";
import { children, isIdentifier, type Node, TEST_FILE } from "./source-ast";
import {
  compareProductionClock,
  formatClockAllowlist,
  loweredClock,
  PRODUCTION_CLOCK_ALLOWLIST,
  parseClockAllowlist,
  scanProductionClock,
} from "./production-clock";

const ALLOWLIST = "scripts/test-waits-allowlist.json";
const POLL_TICK_MS = 10;
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

/** A pause's length; `{ param }` is a helper's own parameter, set per call. */
type Delay = number | "unknown" | "none" | { param: number };
type Site = { line: number; delay: Delay; loop: boolean; helper?: string };
type FileScan = {
  /** Pause lines counted against the allowlist. */
  pauses: number[];
  /** Helpers that pause once per call, by name, for importing files. */
  exported: Map<string, Delay>;
};

/** A clock read: `Date.now()`, `performance.now()`, `Bun.nanoseconds()`, `new Date()`. */
const isClock = (node: Node) => {
  if (node.type === "NewExpression")
    return (
      isIdentifier(node.callee, "Date") && !(node.arguments as Node[]).length
    );
  if (node.type !== "CallExpression") return false;
  const callee = node.callee as Node;
  if (callee.type !== "MemberExpression") return false;
  return (
    ((isIdentifier(callee.object, "Date") ||
      isIdentifier(callee.object, "performance")) &&
      isIdentifier(callee.property, "now")) ||
    (isIdentifier(callee.object, "Bun") &&
      isIdentifier(callee.property, "nanoseconds"))
  );
};

/** Whether an expression reads the clock anywhere outside nested functions. */
function readsClock(node: Node) {
  let found = false;
  within(node, (current) => {
    if (isClock(current)) found = true;
  });
  return found;
}

/**
 * Names a file sets from the clock (`const started = Date.now()`,
 * `deadline = performance.now() + 500`): a loop bounded by them waits on
 * elapsed time, not on the thing it checks.
 */
function clockNames(program: Node) {
  const out = new Set<string>();
  const visit = (node: Node) => {
    if (
      node.type === "VariableDeclarator" &&
      isIdentifier(node.id) &&
      node.init &&
      readsClock(node.init as Node)
    )
      out.add((node.id as Node).name as string);
    if (
      node.type === "AssignmentExpression" &&
      isIdentifier(node.left) &&
      readsClock(node.right as Node)
    )
      out.add((node.left as Node).name as string);
    for (const child of children(node)) visit(child);
  };
  visit(program);
  return out;
}
const COMPARISON = new Set(["<", "<=", ">", ">=", "==", "===", "!=", "!=="]);

/** Walks a subtree without entering nested functions. */
function within(node: Node, visit: (node: Node, path: Node[]) => void) {
  const step = (current: Node, path: Node[]) => {
    visit(current, path);
    for (const child of children(current))
      if (!FUNCTIONS.has(child.type)) step(child, [...path, current]);
  };
  step(node, []);
}

const isStep = (node: Node) =>
  node.type === "NumericLiteral" ||
  node.type === "BigIntLiteral" ||
  isIdentifier(node);

/**
 * Identifiers a loop counts with: `i++`, `n -= 1`, `i = i + 1`, and anything
 * a `for` statement's update step sets.
 */
function counters(loop: Node) {
  const out = new Set<string>();
  const counter = (target: Node | undefined) => {
    if (target && isIdentifier(target)) out.add(target.name as string);
  };
  within(loop, (node) => {
    if (node.type === "UpdateExpression") counter(node.argument as Node);
    if (node.type !== "AssignmentExpression") return;
    const left = node.left as Node;
    const right = node.right as Node;
    if (node.operator !== "=") {
      if (isStep(right)) counter(left);
      return;
    }
    // `i = i + 1`, `n = 2 * n`: the name stepped by a constant or a name.
    if (
      isIdentifier(left) &&
      right.type === "BinaryExpression" &&
      [right.left as Node, right.right as Node].some((side) =>
        isIdentifier(side, left.name as string),
      ) &&
      [right.left as Node, right.right as Node].every(isStep)
    )
      counter(left);
  });
  if (loop.type === "ForStatement" && loop.update)
    within(loop.update as Node, (node) => {
      if (node.type === "UpdateExpression") counter(node.argument as Node);
      if (node.type === "AssignmentExpression") counter(node.left as Node);
    });
  return out;
}

/**
 * Whether a condition reads state the loop waits on, rather than only its
 * own counter, the clock or constants: `!done`, `seen.length < 2`, `check()`.
 */
function observes(test: Node, counted: ReadonlySet<string>): boolean {
  switch (test.type) {
    case "BinaryExpression":
      if (COMPARISON.has(test.operator as string)) {
        const sides = [test.left as Node, test.right as Node];
        // `i < cases.length` counts; `Date.now() - started < 500` is a deadline.
        if (
          sides.some(
            (side) =>
              readsClock(side) ||
              (isIdentifier(side) && counted.has(side.name as string)),
          )
        )
          return false;
      }
      return (
        observes(test.left as Node, counted) ||
        observes(test.right as Node, counted)
      );
    case "LogicalExpression":
      return (
        observes(test.left as Node, counted) ||
        observes(test.right as Node, counted)
      );
    case "UnaryExpression":
    case "AwaitExpression":
    case "TSNonNullExpression":
      return observes((test.argument ?? test.expression) as Node, counted);
    case "Identifier":
      return !counted.has(test.name as string) && test.name !== "undefined";
    case "CallExpression":
      return !isClock(test);
    case "MemberExpression":
    case "OptionalMemberExpression":
    case "OptionalCallExpression":
      return true;
    default:
      return children(test).some((child) => observes(child, counted));
  }
}

/** What a file's loops are judged against. */
type LoopContext = {
  /** Names set from the clock (`started`, `deadline`). */
  clocks: ReadonlySet<string>;
  /** Primitive pauses and local helpers that pause: no work to wait on. */
  pauses: (call: Node) => boolean;
};

/**
 * A poll: a loop where every iteration checks the thing it waits for. Its
 * condition reads observable state, or it has a conditional exit that does
 * (`if (check()) return`), or it leaves after real work succeeded in `try`
 * (`try { await fetch(url); return; } catch {}`). A loop bounded only by a
 * count, a collection or the clock, or whose exit only a counter or the clock
 * gates, merely pauses.
 */
function polls(loop: Node, context: LoopContext): boolean {
  const counted = new Set([...counters(loop), ...context.clocks]);
  if (loop.test && observes(loop.test as Node, counted)) return true;
  let exits = false;
  within(loop.body as Node, (node, path) => {
    if (exits) return;
    if (node.type !== "BreakStatement" && node.type !== "ReturnStatement")
      return;
    // An unlabelled break inside a nested loop or switch leaves only that.
    if (
      node.type === "BreakStatement" &&
      !node.label &&
      path.some(
        (outer) => LOOPS.has(outer.type) || outer.type === "SwitchStatement",
      )
    )
      return;
    const gates = path.filter(
      (outer) =>
        outer.type === "IfStatement" || outer.type === "ConditionalExpression",
    );
    if (gates.length)
      exits = gates.some((gate) => observes(gate.test as Node, counted));
    else
      exits = path.some(
        (outer, index) =>
          outer.type === "TryStatement" &&
          path[index + 1] === outer.block &&
          works(outer.block as Node, context),
      );
  });
  return exits;
}

/** Whether a block calls something other than a pause or the clock. */
function works(block: Node, context: LoopContext) {
  let found = false;
  within(block, (node) => {
    if (
      (node.type === "CallExpression" || node.type === "NewExpression") &&
      !isIdentifier(node.callee, "Promise") &&
      !isClock(node) &&
      !context.pauses(node)
    )
      found = true;
  });
  return found;
}

function delayOf(
  argument: Node | undefined,
  params: readonly string[] = [],
): Delay {
  if (!argument) return "none";
  if (argument.type === "NumericLiteral") return argument.value as number;
  const param = isIdentifier(argument)
    ? params.indexOf(argument.name as string)
    : -1;
  return param >= 0 ? { param } : "unknown";
}

/** `resolve` or `() => resolve(...)`: a callback that only settles a promise. */
function onlyResolves(
  callback: Node | undefined,
  executorParam?: string,
): boolean {
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
  if (body.type !== "CallExpression") return false;
  if (resolver(body.callee)) return true;
  // A deferral that still only settles the promise:
  // `setTimeout(() => requestAnimationFrame(() => resolve()), ms)`.
  return (body.arguments as Node[]).some((argument) =>
    onlyResolves(argument, executorParam),
  );
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
  /** Each argument's delay, for helpers whose pause is a parameter. */
  delays: Delay[];
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

  // Loops judge work against primitive pauses and the local helpers that
  // reach one (`settle()`), and their bounds against clock-set names.
  const primitive = (call: Node) => {
    const callee = call.callee as Node;
    return (
      call.type === "CallExpression" &&
      (isCall(call, "Bun", /^sleep(?:Sync)?$/) ||
        isIdentifier(callee, "setTimeout") ||
        (callee.type === "MemberExpression" &&
          isIdentifier(callee.property, "setTimeout")) ||
        (isIdentifier(callee) && timersPromises.has(callee.name as string)))
    );
  };
  const helpers: Array<{ name: string; node: Node }> = [];
  const collect = (node: Node, parent: Node | undefined) => {
    const name = FUNCTIONS.has(node.type) ? helperName(node, parent) : null;
    if (name) helpers.push({ name, node });
    for (const child of children(node)) collect(child, node);
  };
  collect(ast.program as Node, undefined);
  const pausers = new Set<string>();
  const reaches = (node: Node): boolean =>
    (node.type === "CallExpression" &&
      (primitive(node) ||
        (isIdentifier(node.callee) &&
          pausers.has((node.callee as Node).name as string)))) ||
    children(node).some(reaches);
  for (let changed = true; changed; ) {
    changed = false;
    for (const { name, node } of helpers)
      if (!pausers.has(name) && reaches(node.body as Node)) {
        pausers.add(name);
        changed = true;
      }
  }
  const context: LoopContext = {
    clocks: clockNames(ast.program as Node),
    pauses: (call) =>
      primitive(call) ||
      (isIdentifier(call.callee) &&
        pausers.has((call.callee as Node).name as string)),
  };

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
    params: readonly string[],
  ) => {
    let nextHelper = helper;
    let nextParams = params;
    let nextLoop = loop;
    let nextExecutor = executorParam;
    if (FUNCTIONS.has(node.type)) {
      const name = helperName(node, parent);
      if (name) {
        nextHelper = name;
        nextParams = (node.params as Node[]).map((param) => {
          const target =
            param.type === "AssignmentPattern" ? param.left : param;
          return isIdentifier(target) ? ((target as Node).name as string) : "";
        });
      }
      // Only a promise executor or a React `act` body runs in place, once
      // per poll; any other callback (a test body, a handler) runs later,
      // outside the loop.
      const executor =
        parent?.type === "NewExpression" &&
        isIdentifier(parent.callee, "Promise");
      const inPlace =
        executor ||
        (parent?.type === "CallExpression" &&
          (isIdentifier(parent.callee, "act") ||
            ((parent.callee as Node).type === "MemberExpression" &&
              isIdentifier((parent.callee as Node).property, "act"))));
      if (!inPlace || name) nextLoop = false;
      if (executor) {
        const first = (node.params as Node[])[0];
        nextExecutor = isIdentifier(first)
          ? ((first as Node).name as string)
          : undefined;
      }
    }
    // The nearest loop decides: a short tick is exempt only when it polls.
    if (LOOPS.has(node.type)) nextLoop = polls(node, context);
    if (node.type === "CallExpression") {
      // A timer raced against real work bounds a failure; it is no pause.
      if (isCall(node, "Promise", /^(?:race|any)$/)) return;
      const callee = node.callee as Node;
      const args = node.arguments as Node[];
      const line = node.loc?.start.line ?? 0;
      let delay: Delay | null = null;
      if (isCall(node, "Bun", /^sleep(?:Sync)?$/))
        delay = delayOf(args[0], params);
      else if (
        (isIdentifier(callee, "setTimeout") ||
          (callee.type === "MemberExpression" &&
            isIdentifier(callee.property, "setTimeout"))) &&
        onlyResolves(args[0], executorParam)
      )
        delay = delayOf(args[1], params);
      else if (
        isIdentifier(callee) &&
        timersPromises.has(callee.name as string)
      )
        delay = delayOf(args[0], params);
      if (delay !== null) sites.push({ line, delay, loop, helper });
      else if (isIdentifier(callee))
        calls.push({
          name: callee.name as string,
          line,
          delays: args.map((arg) => delayOf(arg, params)),
          loop,
          helper,
        });
    }
    for (const child of children(node))
      walk(child, node, nextHelper, nextLoop, nextExecutor, nextParams);
  };
  walk(ast.program as Node, undefined, undefined, false, undefined, []);
  return { sites, calls, imports, exportedNames, timingSwitches };
}

const isParam = (delay: Delay): delay is { param: number } =>
  typeof delay === "object";

/**
 * Whether a pause counts where it is written: not a yield, not a short tick
 * in a poll, and not a helper's parameter outside a loop (its calls count).
 */
const counts = (site: { delay: Delay; loop: boolean }) =>
  !(site.delay === "none" || site.delay === 0) &&
  !(isParam(site.delay) && !site.loop) &&
  !(site.loop && typeof site.delay === "number" && site.delay <= POLL_TICK_MS);

/** One delay for a helper with several pauses. */
function merge(a: Delay | undefined, b: Delay): Delay {
  if (a === undefined || JSON.stringify(a) === JSON.stringify(b)) return b;
  if (typeof a === "number" && typeof b === "number") return Math.max(a, b);
  return "unknown";
}

/**
 * Pause lines of one parsed file. `importedPausing` holds the local names of
 * imported helpers that pause once per call, with their delay.
 *
 * Every line that pauses counts: a primitive pause where it is written and
 * each call of a pausing helper, also inside another helper (so a new sleep
 * inside `run()` or `settle()` raises the count like any other).
 */
function resolvePauses(
  parsed: Parsed,
  importedPausing: ReadonlyMap<string, Delay> = new Map(),
): FileScan {
  const { sites, calls } = parsed;
  // A call's delay: the helper's own, or the argument its pause reads.
  const callDelay = (call: Call, helperDelay: Delay): Delay => {
    if (!isParam(helperDelay)) return helperDelay;
    const argument = call.delays[helperDelay.param] ?? "none";
    // An omitted argument takes the helper's default: a real pause.
    return argument === "none" ? "unknown" : argument;
  };
  // A helper pauses once per call when it pauses outside a loop; so does a
  // helper calling one outside a loop.
  const pausing = new Map(importedPausing);
  const add = (name: string, delay: Delay) => {
    const next = merge(pausing.get(name), delay);
    if (JSON.stringify(next) === JSON.stringify(pausing.get(name)))
      return false;
    pausing.set(name, next);
    return true;
  };
  for (const site of sites)
    if (site.helper && !site.loop && (counts(site) || isParam(site.delay)))
      add(site.helper, site.delay);
  for (let changed = true, rounds = 0; changed && rounds < 50; rounds++) {
    changed = false;
    for (const call of calls) {
      const delay = pausing.get(call.name);
      if (delay === undefined || !call.helper || call.loop) continue;
      const effective = callDelay(call, delay);
      if (
        (counts({ delay: effective, loop: false }) || isParam(effective)) &&
        add(call.helper, effective)
      )
        changed = true;
    }
  }
  // A helper only handed on as a value (`{ advance: sleep }`) has no call
  // here to count, so its parameter pause counts where it is written.
  const called = new Set([
    ...calls.map((call) => call.name),
    ...parsed.exportedNames,
  ]);
  const pauses = [
    ...sites
      .filter(
        (site) =>
          counts(site) ||
          (isParam(site.delay) && !!site.helper && !called.has(site.helper)),
      )
      .map((site) => site.line),
    ...calls
      .filter((call) => {
        const delay = pausing.get(call.name);
        // `settle()` pauses; `sleep(0)` yields; `sleep(5)` in a poll ticks.
        return (
          delay !== undefined &&
          counts({ delay: callDelay(call, delay), loop: call.loop })
        );
      })
      .map((call) => call.line),
  ].sort((a, b) => a - b);
  return {
    pauses,
    exported: new Map(
      [...parsed.exportedNames].flatMap((name) => {
        const delay = pausing.get(name);
        return delay === undefined ? [] : [[name, delay] as const];
      }),
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
  let exported = new Map<string, Delay>();
  let result = new Map<string, number[]>();
  for (let rounds = 0; rounds < 50; rounds++) {
    const next = new Map<string, Delay>();
    result = new Map([...files.keys()].map((path) => [path, []]));
    for (const [path, file] of parsed) {
      const importedPausing = new Map(
        targets.get(path)!.flatMap((target) => {
          const delay = exported.get(target.ref);
          return delay === undefined ? [] : [[target.local, delay] as const];
        }),
      );
      const scan = resolvePauses(file, importedPausing);
      result.set(path, scan.pauses);
      for (const [name, delay] of scan.exported)
        next.set(`${path}#${name}`, delay);
    }
    if (JSON.stringify([...next]) === JSON.stringify([...exported])) break;
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

/** An allowlist at the PR base, so raising it cannot bless a new use. */
function atBase<T>(
  root: string,
  file: string,
  parse: (text: string) => T,
): T | undefined {
  const git = (args: string[]) =>
    Bun.spawnSync(["git", ...args], { cwd: root });
  const merge = git(["merge-base", "HEAD", "origin/main"]);
  const ref =
    process.env.HERDR_WORLD_RATCHET_TARGET ||
    (merge.exitCode === 0 ? merge.stdout.toString().trim() : undefined);
  if (!ref) return;
  if (git(["rev-parse", "--verify", `${ref}^{commit}`]).exitCode !== 0)
    throw new Error(`Cannot resolve the allowlist base ${ref} for ${file}`);
  const entry = `${ref}:${file}`;
  // A base predating this check is its adoption.
  if (git(["cat-file", "-e", entry]).exitCode !== 0) return;
  return parse(git(["show", entry]).stdout.toString());
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const sources = sourceFiles(root);
  const current = scanFiles(
    new Map([...sources].filter(([path]) => TEST_FILE.test(path))),
  );
  const allowed = parseAllowlist(readFileSync(join(root, ALLOWLIST), "utf8"));
  const clockUses = scanProductionClock(sources);
  const clockAllowed = parseClockAllowlist(
    readFileSync(join(root, PRODUCTION_CLOCK_ALLOWLIST), "utf8"),
  );
  if (process.argv.includes("--update")) {
    writeFileSync(
      join(root, ALLOWLIST),
      formatAllowlist(lowered(current, allowed)),
    );
    writeFileSync(
      join(root, PRODUCTION_CLOCK_ALLOWLIST),
      formatClockAllowlist(loweredClock(clockUses, clockAllowed)),
    );
    console.info(
      `${ALLOWLIST}, ${PRODUCTION_CLOCK_ALLOWLIST}: lowered to the current counts`,
    );
  } else {
    const problems = [
      ...compare(current, allowed, atBase(root, ALLOWLIST, parseAllowlist)),
      ...timingSwitchesOutsideTests(sources),
      ...compareProductionClock(
        clockUses,
        clockAllowed,
        atBase(root, PRODUCTION_CLOCK_ALLOWLIST, parseClockAllowlist),
      ),
    ];
    const total = [...current.values()].reduce(
      (sum, lines) => sum + lines.length,
      0,
    );
    if (problems.length) {
      for (const problem of problems) console.error(problem);
      process.exit(1);
    }
    const clockTotal = [...clockUses.values()].reduce(
      (sum, lines) => sum + lines.length,
      0,
    );
    console.info(
      `test waits: ${total} allowlisted fixed sleep(s) in ${Object.keys(allowed).length} file(s); no new ones`,
    );
    console.info(
      `production clock: ${clockTotal} allowlisted direct use(s) in ${clockUses.size} file(s); no new ones`,
    );
  }
}
