import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sha = "a".repeat(40);
const version = "0.3.6";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "release-walk-gate-test-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const receipts = Bun.spawnSync(
    [
      "python3",
      "-c",
      `import json, sys
sys.path.insert(0, 'scripts/release-walk')
from contract_test import receipt
from validate import receipt_digest
reports = [receipt(platform=p) for p in ('linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64')]
signed = receipt('signed-in')
print(json.dumps(dict(reports=reports, signed=signed, digest=receipt_digest(signed))))`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(receipts.stderr.toString()).toBe("");
  expect(receipts.exitCode).toBe(0);
  const { reports, signed, digest } = JSON.parse(receipts.stdout.toString());
  for (const report of reports) {
    const directory = join(root, "reports", report.platform);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "report.json"), JSON.stringify(report));
  }
  const ci = {
    path: ".github/workflows/ci.yml",
    event: "push",
    head_branch: "main",
    head_sha: sha,
    conclusion: "success",
  };
  const pr = {
    mergedAt: "2026-11-24T00:00:00Z",
    mergeCommit: { oid: sha },
    baseRefName: "main",
    body: `Release walk signed-in receipt: ${digest}`,
  };
  const save = (name: string, value: unknown) =>
    writeFileSync(join(root, `${name}.json`), JSON.stringify(value));
  save("ci", ci);
  save("pr", pr);
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env bun
import { appendFileSync, cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.WALK_GATE_FIXTURE;
const args = process.argv.slice(2);
appendFileSync(join(root, 'calls.jsonl'), JSON.stringify(args) + '\\n');
if (args[0] === 'api') {
  if (args[1].endsWith('/123')) console.log(readFileSync(join(root, 'ci.json'), 'utf8'));
  else if (args[1].endsWith('/456')) console.log(JSON.stringify({path: '.github/workflows/publish-release.yml', event: 'workflow_dispatch'}));
  else process.exit(64);
} else if (args[0] === 'run' && args[1] === 'download') {
  const destination = args[args.indexOf('--dir') + 1];
  if (args.includes('release-walk-authorization')) cpSync(join(root, 'authorization.json'), join(destination, 'authorization.json'));
  else cpSync(join(root, 'reports'), destination, {recursive: true});
} else if (args[0] === 'pr' && args[1] === 'view' && args[2] === '1358') console.log(readFileSync(join(root, 'pr.json'), 'utf8'));
else process.exit(64);
`,
    { mode: 0o755 },
  );
  function run(mode = "authorize", receipt = "", releasePr = "") {
    return Bun.spawnSync(
      [
        process.execPath,
        "scripts/release-walk-gate.ts",
        mode,
        sha,
        version,
        mode === "authorize" ? "123" : "456",
        releasePr,
      ],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          WALK_GATE_FIXTURE: root,
          RELEASE_WALK_SIGNED_RECEIPT: receipt,
          RELEASE_WALK_AUTHORIZATION: join(root, "authorization.json"),
          GITHUB_OUTPUT: join(root, "outputs"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
  }
  return {
    root,
    reports,
    signed,
    digest,
    ci,
    pr,
    save,
    run,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("Publish Release requires only version and native CI run inputs", () => {
  const workflow = Bun.YAML.parse(
    readFileSync(".github/workflows/publish-release.yml", "utf8"),
  ) as {
    on: {
      workflow_dispatch: { inputs: Record<string, { required: boolean }> };
    };
  };
  const inputs = workflow.on.workflow_dispatch.inputs;
  expect(Object.keys(inputs).filter((name) => inputs[name].required)).toEqual([
    "version",
    "walk_run_id",
  ]);
});

for (const hasReceipt of [false, true]) {
  for (const hasPr of [false, true]) {
    test(`authorization and publication pass with receipt=${hasReceipt}, release PR=${hasPr}`, () => {
      const f = fixture();
      try {
        const result = f.run(
          "authorize",
          hasReceipt ? JSON.stringify(f.signed) : "",
          hasPr ? "1358" : "",
        );
        expect(result.stderr.toString()).toBe("");
        expect(result.exitCode).toBe(0);
        const authorization = JSON.parse(
          readFileSync(join(f.root, "authorization.json"), "utf8"),
        );
        expect(authorization).toMatchObject({
          before_tag: true,
          commit: sha,
          version,
          ci_run_id: "123",
          signed: hasReceipt ? f.signed : null,
        });
        const published = f.run("publication");
        expect(published.stderr.toString()).toBe("");
        expect(published.exitCode).toBe(0);
        expect(readFileSync(join(f.root, "outputs"), "utf8")).toContain(
          "walk_run_id=123\n",
        );
        const calls = readFileSync(join(f.root, "calls.jsonl"), "utf8");
        expect(calls.includes('["pr","view"')).toBe(hasPr);
      } finally {
        f.cleanup();
      }
    });
  }
}

test("a signed-in receipt does not require a PR receipt line, but a supplied line must match", () => {
  const f = fixture();
  try {
    f.save("pr", { ...f.pr, body: "Reviewed release preparation" });
    const signed = JSON.stringify(f.signed);
    expect(f.run("authorize", signed, "1358").exitCode).toBe(0);
    expect(f.run("publication").exitCode).toBe(0);
    f.save("pr", {
      ...f.pr,
      body: `Release walk signed-in receipt: ${"d".repeat(64)}`,
    });
    expect(f.run("authorize", signed, "1358").exitCode).toBe(1);
    expect(f.run("publication").exitCode).toBe(1);
  } finally {
    f.cleanup();
  }
});

test("supplied receipts are verified without a release PR", () => {
  const f = fixture();
  try {
    for (const signed of [
      "malformed JSON",
      JSON.stringify({ ...f.signed, archive_sha256: "d".repeat(64) }),
      JSON.stringify({ ...f.signed, binary_sha256: "d".repeat(64) }),
      JSON.stringify({ ...f.signed, commit: "d".repeat(40) }),
      JSON.stringify({ ...f.signed, journeys: [] }),
      "false",
    ])
      expect(f.run("authorize", signed).exitCode).toBe(1);
  } finally {
    f.cleanup();
  }
});

test("optional release PRs still require the exact merged main commit", () => {
  const f = fixture();
  try {
    for (const change of [
      { mergedAt: null },
      { baseRefName: "other" },
      { mergeCommit: { oid: "d".repeat(40) } },
    ]) {
      f.save("pr", { ...f.pr, ...change });
      expect(f.run("authorize", "", "1358").exitCode).toBe(1);
    }
    expect(f.run("authorize", "", "invalid").exitCode).toBe(1);
  } finally {
    f.cleanup();
  }
});

test("omitting signed-in evidence preserves native CI and pre-tag identity checks", () => {
  const f = fixture();
  try {
    for (const change of [
      { head_sha: "d".repeat(40) },
      { conclusion: "failure" },
      { path: ".github/workflows/release-walk.yml" },
      { head_branch: "other" },
    ]) {
      f.save("ci", { ...f.ci, ...change });
      expect(f.run().exitCode).toBe(1);
    }
    f.save("ci", f.ci);
    expect(f.run().exitCode).toBe(0);
    const authorization = JSON.parse(
      readFileSync(join(f.root, "authorization.json"), "utf8"),
    );
    for (const change of [
      { commit: "d".repeat(40) },
      { version: "0.3.7" },
      { before_tag: false },
    ]) {
      f.save("authorization", { ...authorization, ...change });
      expect(f.run("publication").exitCode).toBe(1);
    }
    rmSync(join(f.root, "reports", "darwin-arm64"), {
      recursive: true,
    });
    expect(f.run().exitCode).toBe(1);
  } finally {
    f.cleanup();
  }
});
