import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  publishedAttributionFile,
  reservedEmailDomain,
  syntheticCredential,
  syntheticHomeUsers,
  syntheticWorldPasswordBindings,
} from "./privacy-allowlist";

type Rule =
  | "private-ip"
  | "tailnet-ipv6"
  | "tailnet-host"
  | "home-path"
  | "email"
  | "login-token"
  | "world-password"
  | "session-secret";
export type PrivacyFinding = { file: string; line: number; rule: Rule };

function emailMatches(line: string) {
  return [
    ...line.matchAll(
      /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63})\b/gi,
    ),
  ].filter(
    (match) =>
      // Package versions/patch filenames are not mailbox domains.
      !/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?(?:\.patch)?$/i.test(match[1]),
  );
}

/** Only rule IDs escape this function: never return matched private material. */
export function privacyRules(
  line: string,
  publishedEmails: ReadonlySet<string> = new Set(),
  syntheticWorldPasswordBinding?: string,
): Rule[] {
  const rules = new Set<Rule>();
  for (const match of line.matchAll(
    /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g,
  )) {
    const octets = match[0].split(".").map(Number);
    if (octets.some((part) => part > 255)) continue;
    const [a, b] = octets;
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
      rules.add("private-ip");
  }
  if (/(?<![\da-f:])fd7a:115c:a1e0:(?=[:\da-f])/i.test(line))
    rules.add("tailnet-ipv6");
  if (/\b(?:[a-z0-9-]+\.)+ts\.net\b/i.test(line)) rules.add("tailnet-host");
  for (const match of line.matchAll(/\/(?:home|Users)\/([^/\s"'`]+)/g))
    if (!syntheticHomeUsers.has(match[1])) rules.add("home-path");
  for (const match of emailMatches(line))
    if (
      !reservedEmailDomain.test(match[1]) &&
      !publishedEmails.has(match[0].toLowerCase())
    )
      rules.add("email");

  // Quoted literals, shell assignments and copied links; interpolation stays
  // synthetic. Token/session literals need a plausible length; passwords do not.
  const value = String.raw`(?:"([^"\r\n]*)"|'([^'\r\n]*)'|(\$\{[^}\r\n]*\}|<[^>\r\n]*>|[^\s"'\x60&<>;,)}\]\\]+))`;
  const credentials: [Rule, string, number][] = [
    ["login-token", String.raw`(?:[?&#]|&amp;|\b)token=`, 16],
    ["world-password", String.raw`\bHERDR_WORLD_PASSWORD["']?\s*[:=]\s*`, 1],
    [
      "session-secret",
      String.raw`\b(?:(?:HERDR_WORLD_)?SESSION[_-]?SECRET|sessionSecret|secret)["']?\s*[:=]\s*`,
      16,
    ],
  ];
  for (const [rule, prefix, minimum] of credentials)
    for (const match of line.matchAll(new RegExp(prefix + value, "gi"))) {
      let literal = match[1] ?? match[2] ?? match[3] ?? "";
      try {
        literal = decodeURIComponent(literal);
      } catch {
        /* Inspect the literal when encoding is malformed. */
      }
      // Session state is normally a quoted literal. Unquoted environment
      // secrets must look like encoded key material, not a source expression
      // such as args.sessionSecret or anotherSessionSecretVariable.
      if (
        rule === "session-secret" &&
        match[3] !== undefined &&
        !/^[a-z0-9+/_=-]{32,}$/i.test(literal)
      )
        continue;
      if (
        rule === "world-password" &&
        syntheticWorldPasswordBinding !== undefined &&
        match[3] === syntheticWorldPasswordBinding
      )
        continue;
      if (literal.length >= minimum && !syntheticCredential(literal))
        rules.add(rule);
    }
  return [...rules];
}

function git(cwd: string, args: string[]): string {
  // Capture stderr: Git errors may contain private paths or file contents.
  return execFileSync(
    "git",
    ["-c", "core.fsmonitor=false", "--literal-pathspecs", ...args],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}
function commitId(cwd: string, ref: string): string {
  return git(cwd, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${ref}^{commit}`,
  ]).trim();
}
function mainBaseline(cwd: string): string | null {
  try {
    return commitId(cwd, "refs/remotes/origin/main");
  } catch {
    return null;
  }
}

function publishedAttribution(cwd: string, main: string | null): Set<string> {
  if (main) {
    try {
      return new Set(
        emailMatches(
          git(cwd, ["show", `${main}:${publishedAttributionFile}`]),
        ).map((match) => match[0].toLowerCase()),
      );
    } catch {
      /* No published attribution: keep the email rule strict. */
    }
  }
  return new Set();
}

function addedLines(diff: string): Map<number, string> {
  const lines = new Map<number, string>();
  let line = 0;
  let inHunk = false;
  for (const text of diff.split("\n")) {
    const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      line = Number(hunk[1]);
      inHunk = true;
    } else if (inHunk && text.startsWith("+")) lines.set(line++, text.slice(1));
    else if (inHunk && text.startsWith(" ")) line++;
  }
  return lines;
}

/** Scan additions absent from every parent of each introduced commit.
 * A net tree diff would miss a leak deleted later in the very same push. */
export function scanPrivacyRange(
  cwd: string,
  base: string | string[] | null,
  head: string,
): PrivacyFinding[] {
  const after = commitId(cwd, head);
  const before = (Array.isArray(base) ? base : base === null ? [] : [base]).map(
    (ref) => commitId(cwd, ref),
  );
  const commits = git(cwd, [
    "rev-list",
    "--reverse",
    "--topo-order",
    after,
    ...(before.length ? ["--not", ...before] : []),
  ])
    .trim()
    .split("\n")
    .filter(Boolean);
  const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  const findings: PrivacyFinding[] = [];
  const main = mainBaseline(cwd);
  // On a main push checkout's remote ref already points at the new head.
  // Only its prior baseline may approve attribution, never this push's additions.
  const attributionBase =
    main === after
      ? (before.find((revision) => revision !== after) ?? null)
      : main;
  const publishedEmails = publishedAttribution(cwd, attributionBase);
  for (const commit of commits) {
    const parents = git(cwd, ["rev-list", "--parents", "-n", "1", commit])
      .trim()
      .split(" ")
      .slice(1);
    if (!parents.length) parents.push(emptyTree);
    const diffArgs = [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
    ];
    const files = git(cwd, [
      ...diffArgs,
      parents[0],
      commit,
      "--name-only",
      "-z",
      "--",
    ])
      .split("\0")
      .filter(Boolean);
    for (const file of files) {
      let additions: Map<number, string> | undefined;
      for (const parent of parents) {
        // Let Git identify binary blobs; never force their bytes into text.
        const lines = addedLines(
          git(cwd, [...diffArgs, parent, commit, "--unified=0", "--", file]),
        );
        if (!additions) additions = lines;
        else
          for (const line of additions.keys())
            if (!lines.has(line)) additions.delete(line);
        if (!additions.size) break;
      }
      for (const [line, text] of additions ?? [])
        for (const rule of privacyRules(
          text,
          file === publishedAttributionFile ? publishedEmails : undefined,
          syntheticWorldPasswordBindings.get(file),
        ))
          findings.push({ file, line, rule });
    }
  }
  return findings;
}

function exactSha(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value))
    throw new Error("Invalid revision");
  return value;
}
const zero = "0".repeat(40);
function pushBaseline(cwd: string, before: string, after: string): string[] {
  const main = mainBaseline(cwd);
  if (before !== zero) {
    try {
      const prior = commitId(cwd, before);
      git(cwd, ["merge-base", "--is-ancestor", prior, after]);
      // Main's published commits must not be re-scanned when a branch syncs it.
      return [prior, ...(main && main !== after ? [main] : [])];
    } catch {
      /* Force pushes may leave the old head outside checkout's refs. */
    }
  }
  return main ? [main] : [];
}
type PrivacyRange = [string | string[] | null, string];
function ranges(cwd: string, args: string[]): PrivacyRange[] {
  if (!args.length) return [[mainBaseline(cwd), "HEAD"]];
  if (args[0] === "--range" && args.length === 3) return [[args[1], args[2]]];
  if (args[0] === "--event" && args.length === 2) {
    const event = JSON.parse(readFileSync(args[1], "utf8"));
    if (event.pull_request)
      return [
        [
          exactSha(event.pull_request.base?.sha),
          exactSha(event.pull_request.head?.sha),
        ],
      ];
    const after = exactSha(event.after);
    const before = exactSha(event.before);
    return after === zero ? [] : [[pushBaseline(cwd, before, after), after]];
  }
  if (args[0] === "--pre-push" && args.length === 2) {
    const rows = readFileSync(args[1], "utf8").trim();
    if (!rows) return [[mainBaseline(cwd), "HEAD"]];
    return rows.split("\n").flatMap((row): PrivacyRange[] => {
      const fields = row.trim().split(/\s+/);
      if (fields.length !== 4) throw new Error("Invalid push input");
      const after = exactSha(fields[1]);
      const before = exactSha(fields[3]);
      return after === zero ? [] : [[pushBaseline(cwd, before, after), after]];
    });
  }
  throw new Error("Invalid arguments");
}

if (import.meta.main) {
  try {
    const cwd = process.cwd();
    let failed = false;
    for (const [base, head] of ranges(cwd, process.argv.slice(2)))
      for (const finding of scanPrivacyRange(cwd, base, head)) {
        failed = true;
        // Escape control characters and suppress sensitive filenames as well.
        const file = privacyRules(finding.file).length
          ? "[redacted-path]"
          : finding.file;
        console.error(
          `${JSON.stringify(file)}:${finding.line}: privacy/${finding.rule}`,
        );
      }
    if (failed) {
      console.error(
        "Privacy check failed. Replace private values with reviewed synthetic data before pushing.",
      );
      process.exitCode = 1;
    } else console.info("Privacy check passed.");
  } catch {
    console.error(
      "Privacy check could not scan all requested commits. Ensure complete Git history is available; refusing to pass.",
    );
    process.exitCode = 1;
  }
}
