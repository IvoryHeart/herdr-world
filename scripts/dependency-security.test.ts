import { expect, test } from "bun:test";
import { missingSecurityIssues } from "./dependency-security-issues";
import {
  auditDependencies,
  blocksRelease,
  dependencyInventory,
  fixedVersion,
  validateExceptions,
  type AppLock,
  type Exception,
} from "./dependency-security";

const advisory = {
  url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
  title: "Command Injection",
  severity: "high",
  vulnerable_versions: "<4.17.21",
};
const pkg = { name: "lodash", version: "4.17.15", shipped: true };
const exception: Exception = {
  package: "lodash",
  version: "4.17.15",
  advisory: advisory.url,
  reason: "Synthetic risk acceptance for this fixture only",
  expires: "2099-01-01",
};
const registry = async (url: string) =>
  url.endsWith("/bulk")
    ? { lodash: [advisory] }
    : { versions: { "4.17.15": {}, "4.17.21": {}, "5.0.0-beta.1": {} } };

test("runtime closure includes nested, peer and cross-platform optional deps, excluding dev-only roots", () => {
  const lock: AppLock = {
    workspaces: {
      "": {
        dependencies: { root: "1" },
        devDependencies: { tool: "1" },
      } as object,
      web: { dependencies: { ui: "1" } },
      server: { dependencies: { api: "1" } },
    },
    packages: {
      ui: ["ui@1.0.0", "", { dependencies: { shared: "1" } }],
      api: [
        "api@1.0.0",
        "",
        {
          dependencies: { shared: "2" },
          optionalDependencies: { native: "1" },
          peerDependencies: { peer: "1" },
        },
      ],
      root: ["root@1.0.0", "", {}],
      shared: ["shared@1.0.0", "", {}],
      "api/shared": ["shared@2.0.0", "", { dependencies: { leaf: "1" } }],
      "api/leaf": ["leaf@1.0.0", "", {}],
      native: ["native@1.0.0", "", {}],
      peer: ["peer@1.0.0", "", {}],
      tool: ["tool@1.0.0", "", { dependencies: { dev: "1" } }],
      dev: ["dev@1.0.0", "", {}],
    },
  };
  const inventory = dependencyInventory(lock);
  expect(
    inventory
      .filter((pkg) => pkg.shipped)
      .map((pkg) => `${pkg.name}@${pkg.version}`),
  ).toEqual([
    "api@1.0.0",
    "leaf@1.0.0",
    "native@1.0.0",
    "peer@1.0.0",
    "root@1.0.0",
    "shared@1.0.0",
    "shared@2.0.0",
    "ui@1.0.0",
  ]);
  expect(inventory.find((pkg) => pkg.name === "dev")?.shipped).toBe(false);
  delete lock.packages["api/shared"];
  delete lock.packages.shared;
  expect(() => dependencyInventory(lock)).toThrow(
    "Missing locked runtime dependency",
  );
});

test("known vulnerable shipped version blocks and names advisory and available fix", async () => {
  const [finding] = await auditDependencies([pkg], [], registry);
  expect(finding).toMatchObject({ ...pkg, ...advisory, fix: "4.17.21" });
  expect(blocksRelease(finding!)).toBe(true);
  expect(blocksRelease({ ...finding!, shipped: false })).toBe(false);
  expect(blocksRelease({ ...finding!, severity: "moderate" })).toBe(false);
  expect(blocksRelease({ ...finding!, severity: "critical" })).toBe(true);
  expect(blocksRelease({ ...finding!, fix: null })).toBe(false);
  expect(
    await auditDependencies([{ ...pkg, version: "4.17.21" }], [], registry),
  ).toEqual([]);
});

for (const [workspace, name] of [
  ["web", "herdr-world-web"],
  ["server", "herdr-world-server"],
  ["web", "@site/web"],
] as const) {
  test(`workspace-specific runtime ${name}/lodash blocks release and queues an alert`, async () => {
    const lock: AppLock = {
      workspaces: {
        "": { dependencies: { lodash: "4.17.21" } },
        web: {},
        server: {},
        [workspace]: { name, dependencies: { lodash: "4.17.15" } },
      },
      packages: {
        lodash: ["lodash@4.17.21", "", {}],
        [`${name}/lodash`]: [
          "lodash@4.17.15",
          "",
          { dependencies: { leaf: "1" } },
        ],
        [`${name}/leaf`]: ["leaf@1.0.0", "", {}],
        [`${name}/tool`]: ["tool@1.0.0", "", {}],
      },
    };
    const inventory = dependencyInventory(lock);
    expect(inventory).toContainEqual({
      name: "leaf",
      version: "1.0.0",
      shipped: true,
    });
    expect(inventory).toContainEqual({
      name: "tool",
      version: "1.0.0",
      shipped: false,
    });
    const findings = await auditDependencies(inventory, [], registry);
    expect(findings).toEqual([{ ...pkg, ...advisory, fix: "4.17.21" }]);
    expect(findings.some(blocksRelease)).toBe(true);
    const issues = missingSecurityIssues(findings, []);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.labels).toContain("crew:ready");
    expect(issues[0]!.body).toContain("Priority: high");
    expect(issues[0]!.body).toContain(advisory.url);
  });
}

test("scoped package ancestry skips incomplete scopes when resolving hoisted dependencies", () => {
  const lock: AppLock = {
    workspaces: {
      web: { name: "herdr-world-web", dependencies: { "@vendor/ui": "1" } },
      server: {},
    },
    packages: {
      "herdr-world-web/@vendor/ui": [
        "@vendor/ui@1.0.0",
        "",
        { dependencies: { lodash: "4.17.15" } },
      ],
      "herdr-world-web/lodash": ["lodash@4.17.15", "", {}],
      "herdr-world-web/@vendor/lodash": ["@vendor/lodash@4.17.21", "", {}],
      lodash: ["lodash@4.17.21", "", {}],
    },
  };
  expect(dependencyInventory(lock)).toContainEqual(pkg);
  expect(dependencyInventory(lock)).toContainEqual({
    name: "@vendor/lodash",
    version: "4.17.21",
    shipped: false,
  });
});

test("only exact, reasoned, unexpired exceptions can unblock a finding", async () => {
  const [accepted] = await auditDependencies([pkg], [exception], registry);
  expect(blocksRelease(accepted!)).toBe(false);
  const [different] = await auditDependencies(
    [pkg],
    [{ ...exception, version: "4.17.14" }],
    registry,
  );
  expect(blocksRelease(different!)).toBe(true);
  for (const invalid of [
    { ...exception, reason: "" },
    { ...exception, expires: "2020-01-01" },
    { ...exception, expires: "2099-02-31" },
    { ...exception, version: "*" },
  ])
    expect(() => validateExceptions([invalid])).toThrow();
  expect(() => validateExceptions([exception, exception])).toThrow("Duplicate");
  expect(() =>
    validateExceptions([{ ...exception, expires: "2026-11-19" }], "2026-11-19"),
  ).toThrow("Expired");
});

test("fix detection excludes old unaffected versions, affected branches and prereleases", () => {
  expect(
    fixedVersion("2.0.1", ">=2.0.0 <2.1.0 || >=3.0.0 <3.1.0", [
      "1.0.0",
      "2.0.2",
      "2.1.0-beta.1",
      "2.1.0",
      "3.0.0",
    ]),
  ).toBe("2.1.0");
  expect(fixedVersion("2.0.0", "*", ["1.0.0", "2.1.0"])).toBeNull();
});

test("registry outages and malformed responses fail closed", async () => {
  await expect(
    auditDependencies([pkg], [], async () => {
      throw new Error("registry unavailable");
    }),
  ).rejects.toThrow("unavailable");
  for (const response of [
    null,
    [],
    { unexpected: [] },
    { lodash: [{ ...advisory, severity: "unknown" }] },
  ])
    await expect(
      auditDependencies([pkg], [], async () => response),
    ).rejects.toThrow();
});

test("advisory ranges include affected prereleases immediately below a fixed release", async () => {
  const [finding] = await auditDependencies(
    [{ ...pkg, version: "4.17.21-beta.1" }],
    [],
    registry,
  );
  expect(finding?.version).toBe("4.17.21-beta.1");
  expect(blocksRelease(finding!)).toBe(true);
  for (const range of [
    "<4.17.21",
    ">=4.17.0 <4.17.21",
    "4.0.0 - 4.17.21",
    "^4.17.0",
    "~4.17.0",
    ">=5 || <4.17.21",
  ]) {
    const results = await auditDependencies(
      [{ ...pkg, version: "4.17.21-beta.1" }],
      [],
      async (url) =>
        url.endsWith("/bulk")
          ? { lodash: [{ ...advisory, vulnerable_versions: range }] }
          : { versions: { "4.18.0": {} } },
    );
    expect(results).toHaveLength(1);
  }
  expect(
    await auditDependencies(
      [{ ...pkg, version: "4.17.22-beta.1" }],
      [],
      registry,
    ),
  ).toEqual([]);
});

test("invalid fix-version inventories fail closed instead of being treated as no available fix", async () => {
  await expect(
    auditDependencies([pkg], [], async (url) =>
      url.endsWith("/bulk") ? { lodash: [advisory] } : { versions: [] },
    ),
  ).rejects.toThrow("fix-version inventory");
});

test("prerelease matching follows npm semantics for hyphen, wildcard and shortened comparator ranges", async () => {
  for (const [version, range] of [
    ["1.0.0-beta.1", "1.0.0 - 2.0.0"],
    ["1.0.0-beta.1", "1.x"],
    ["1.2.0-beta.1", "1.2.x"],
    ["2.0.0-beta.1", ">=2 || <1.2.3"],
  ]) {
    const results = await auditDependencies(
      [{ ...pkg, version: version! }],
      [],
      async (url) =>
        url.endsWith("/bulk")
          ? { lodash: [{ ...advisory, vulnerable_versions: range }] }
          : { versions: { "4.18.0": {} } },
    );
    expect(results).toHaveLength(1);
  }
  await expect(
    auditDependencies([pkg], [], async (url) =>
      url.endsWith("/bulk")
        ? { lodash: [{ ...advisory, vulnerable_versions: "invalid-range" }] }
        : { versions: { "4.18.0": {} } },
    ),
  ).rejects.toThrow("Malformed advisory range");
});
