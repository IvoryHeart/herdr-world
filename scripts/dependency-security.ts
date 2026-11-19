import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

type Dependencies = {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
export type AppLock = {
  workspaces: Record<string, Dependencies>;
  packages: Record<string, [string, string, Dependencies, ...unknown[]]>;
};
export type Package = { name: string; version: string; shipped: boolean };
export type Advisory = {
  url: string;
  title: string;
  severity: string;
  vulnerable_versions: string;
};
export type Finding = Package &
  Advisory & { fix: string | null; exception?: string };
export type Exception = {
  package: string;
  version: string;
  advisory: string;
  reason: string;
  expires: string;
};

function packageId(id: string) {
  const at = id.lastIndexOf("@");
  if (at <= 0 || !Bun.semver.satisfies(id.slice(at + 1), id.slice(at + 1)))
    throw new Error(`Unsupported locked dependency: ${id}`);
  return { name: id.slice(0, at), version: id.slice(at + 1) };
}

/** Conservative shipping boundary: all runtime transitive/peer/optional deps,
 * across every target OS/CPU, whether or not a bundler can remove some code.
 * The binary embeds server + web; npm wraps that binary; Pages reuses web art.
 * Root devDependencies and the separate Quint lock are never shipping roots.
 */
export function dependencyInventory(lock: AppLock): Package[] {
  if (!lock.packages || !lock.workspaces?.web || !lock.workspaces.server)
    throw new Error("Missing application lock/workspace inventory");
  const shipped = new Set<string>();
  const locate = (name: string, from: string): string | undefined => {
    let context = from;
    while (context) {
      const key = `${context}/${name}`;
      if (lock.packages[key]) return key;
      context = context.slice(0, Math.max(0, context.lastIndexOf("/")));
    }
    return lock.packages[name] ? name : undefined;
  };
  const visit = (deps: Dependencies, from: string) => {
    for (const [kind, entries] of Object.entries(deps)) {
      if (
        !["dependencies", "optionalDependencies", "peerDependencies"].includes(
          kind,
        )
      )
        continue;
      for (const name of Object.keys(entries ?? {})) {
        const key = locate(name, from);
        if (!key) {
          if (kind === "dependencies")
            throw new Error(
              `Missing locked runtime dependency ${from}/${name}`,
            );
          continue;
        }
        if (shipped.has(key)) continue;
        shipped.add(key);
        visit(lock.packages[key]![2], key);
      }
    }
  };
  // Include root runtime dependencies too, should the workspace acquire any.
  for (const workspace of Object.values(lock.workspaces)) visit(workspace, "");
  const byId = new Map<string, Package>();
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (entry[0].includes("@workspace:")) continue;
    const pkg = packageId(entry[0]);
    const id = `${pkg.name}@${pkg.version}`;
    byId.set(id, {
      ...pkg,
      shipped: shipped.has(key) || !!byId.get(id)?.shipped,
    });
  }
  return [...byId.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
}

export function validateExceptions(
  entries: Exception[],
  today = new Date().toISOString().slice(0, 10),
) {
  if (!Array.isArray(entries))
    throw new Error("Security exceptions must be an array");
  const seen = new Set<string>();
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.package !== "string" ||
      !entry.package ||
      typeof entry.version !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(entry.version) ||
      !Bun.semver.satisfies(entry.version, entry.version) ||
      !/^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9-]+$/.test(
        entry.advisory,
      ) ||
      typeof entry.reason !== "string" ||
      entry.reason.trim().length < 20 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires) ||
      !Number.isFinite(Date.parse(entry.expires)) ||
      new Date(entry.expires).toISOString().slice(0, 10) !== entry.expires
    )
      throw new Error(
        "Security exception requires an exact package/version, GHSA URL, reason and valid expiry date",
      );
    if (entry.expires <= today)
      throw new Error(
        `Expired security exception: ${entry.package} ${entry.advisory} (${entry.expires})`,
      );
    const key = `${entry.package}@${entry.version} ${entry.advisory}`;
    if (seen.has(key)) throw new Error(`Duplicate security exception: ${key}`);
    seen.add(key);
  }
}

export function fixedVersion(
  current: string,
  range: string,
  versions: string[],
) {
  return (
    versions
      .filter(
        (version) =>
          /^\d+\.\d+\.\d+$/.test(version) &&
          Bun.semver.order(version, current) > 0 &&
          !Bun.semver.satisfies(version, range),
      )
      .sort(Bun.semver.order)[0] ?? null
  );
}

function affectedVersion(version: string, range: string) {
  // Load only during an audit: bot metadata generation imports the lock graph
  // helpers in trusted jobs that deliberately do not install dependencies.
  const semver = createRequire(import.meta.url)("semver") as {
    validRange(
      range: string,
      options: { includePrerelease: boolean },
    ): string | null;
    satisfies(
      version: string,
      range: string,
      options: { includePrerelease: boolean },
    ): boolean;
  };
  // Security ranges must include affected beta releases as well as stable ones.
  const options = { includePrerelease: true };
  if (semver.validRange(range, options) === null)
    throw new Error(`Malformed advisory range: ${range}`);
  return semver.satisfies(version, range, options);
}

type JsonRequest = (url: string, init?: RequestInit) => Promise<unknown>;
export async function registryJson(
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(
      `Security registry request failed (${response.status}): ${url}`,
    );
  return response.json();
}

export async function auditDependencies(
  packages: Package[],
  exceptions: Exception[],
  request: JsonRequest = registryJson,
): Promise<Finding[]> {
  validateExceptions(exceptions);
  const query: Record<string, string[]> = {};
  for (const pkg of packages) (query[pkg.name] ??= []).push(pkg.version);
  const response = await request(
    "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(query),
    },
  );
  if (!response || typeof response !== "object" || Array.isArray(response))
    throw new Error("Malformed security advisory response");
  const findings: Finding[] = [];
  for (const [name, value] of Object.entries(response)) {
    if (!query[name] || !Array.isArray(value))
      throw new Error("Unexpected security advisory package");
    const advisories = value as Advisory[];
    for (const advisory of advisories) {
      if (
        !advisory ||
        typeof advisory.title !== "string" ||
        !/^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9-]+$/.test(
          advisory.url,
        ) ||
        !["info", "low", "moderate", "high", "critical"].includes(
          advisory.severity,
        ) ||
        typeof advisory.vulnerable_versions !== "string" ||
        !advisory.vulnerable_versions
      )
        throw new Error(`Malformed advisory for ${name}`);
    }
    const metadata = (await request(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
    )) as { versions?: Record<string, unknown> };
    if (
      !metadata.versions ||
      typeof metadata.versions !== "object" ||
      Array.isArray(metadata.versions)
    )
      throw new Error(`Missing fix-version inventory for ${name}`);
    for (const pkg of packages.filter((pkg) => pkg.name === name)) {
      for (const advisory of advisories) {
        if (!affectedVersion(pkg.version, advisory.vulnerable_versions))
          continue;
        const exception = exceptions.find(
          (entry) =>
            entry.package === name &&
            entry.version === pkg.version &&
            entry.advisory === advisory.url,
        );
        findings.push({
          ...pkg,
          ...advisory,
          fix: fixedVersion(
            pkg.version,
            advisory.vulnerable_versions,
            Object.keys(metadata.versions),
          ),
          ...(exception
            ? {
                exception: `${exception.reason} (expires ${exception.expires})`,
              }
            : {}),
        });
      }
    }
  }
  return findings;
}

export function blocksRelease(finding: Finding) {
  return (
    finding.shipped &&
    ["high", "critical"].includes(finding.severity) &&
    !!finding.fix &&
    !finding.exception
  );
}

export async function securityCheck(root = resolve(import.meta.dir, "..")) {
  const lock = Bun.JSONC.parse(
    await readFile(resolve(root, "bun.lock"), "utf8"),
  ) as AppLock;
  const packages = dependencyInventory(lock);
  // Also report isolated development alerts; never mislabel Quint as shipped.
  const quint = JSON.parse(
    await readFile(resolve(root, "tools/quint/package-lock.json"), "utf8"),
  );
  for (const [path, entry] of Object.entries(quint.packages) as [
    string,
    { version?: string },
  ][]) {
    if (!path || !entry.version) continue;
    const name = path.split("node_modules/").at(-1)!;
    if (
      !packages.some(
        (pkg) => pkg.name === name && pkg.version === entry.version,
      )
    )
      packages.push({ name, version: entry.version, shipped: false });
  }
  const exceptions = JSON.parse(
    await readFile(
      resolve(root, "security/dependency-exceptions.json"),
      "utf8",
    ),
  ) as Exception[];
  const findings = await auditDependencies(packages, exceptions);
  for (const finding of findings)
    console.log(
      `${blocksRelease(finding) ? "BLOCK" : "NOTICE"} ${finding.shipped ? "shipped" : "dev-only"} ${finding.name}@${finding.version}: ${finding.severity} ${finding.url} — ${finding.title}; fix: ${finding.fix ?? "none available"}${finding.exception ? `; exception: ${finding.exception}` : ""}`,
    );
  console.log(
    `Audited ${packages.length} locked versions (${packages.filter((pkg) => pkg.shipped).length} potentially shipped); ${findings.filter(blocksRelease).length} release blocker(s).`,
  );
  return { findings, checkedAt: new Date().toISOString() };
}

if (import.meta.main) {
  const demo = process.argv.includes("--demo-vulnerable");
  const report = demo
    ? {
        findings: await auditDependencies(
          [{ name: "lodash", version: "4.17.15", shipped: true }],
          [],
        ),
        checkedAt: new Date().toISOString(),
      }
    : await securityCheck();
  if (demo)
    for (const finding of report.findings)
      console.log(
        `TEST FIXTURE ${blocksRelease(finding) ? "BLOCK" : "NOTICE"} ${finding.name}@${finding.version}: ${finding.url}; fix: ${finding.fix ?? "none available"}`,
      );
  const output = process.argv.indexOf("--report");
  if (output !== -1) {
    if (!process.argv[output + 1])
      throw new Error("--report requires an output path");
    await writeFile(
      process.argv[output + 1]!,
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  process.exitCode = report.findings.some(blocksRelease) ? 1 : 0;
}
