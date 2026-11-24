import { expect, test } from "bun:test";
import { spawnSync } from "bun";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { sealBundle } from "./release-bundle.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "release-publication-"));
  const bundle = join(root, "candidate");
  const bin = join(root, "bin");
  for (const name of ["candidate/github", "candidate/npm", "bin", "remote"])
    mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(bundle, "notes.md"), "Synthetic release notes\n");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FIXTURE: root,
    RELEASE_VERSION: "0.3.6",
    GITHUB_REPOSITORY: "fixture/release",
    GITHUB_RUN_ID: "123",
    VERIFY_RESULT: "success",
  };
  // Fake external registries only; real scripts, hashes, subprocesses and file IO.
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const root = process.env.FIXTURE, args = process.argv.slice(2), state = path.join(root, 'github.json'), remote = path.join(root, 'remote');
fs.appendFileSync(path.join(root, 'calls'), JSON.stringify(args) + '\\n');
if (args[0] === 'api') { if (args[1].includes('/pulls?')) { console.log('[]'); process.exit(0); } console.error('HTTP 404'); process.exit(1); }
if (args[0] !== 'release') process.exit(64);
if (args[1] === 'view') {
  if (!fs.existsSync(state)) { console.error('release not found'); process.exit(1); }
  console.log(JSON.stringify({ ...JSON.parse(fs.readFileSync(state)), assets: fs.readdirSync(remote).map(name => ({name})), url: 'https://example.invalid/release' }));
} else if (args[1] === 'create') fs.writeFileSync(state, JSON.stringify({isDraft:true}));
else if (args[1] === 'upload') {
  for (const file of args.slice(3)) {
    fs.copyFileSync(file, path.join(remote, path.basename(file)));
    if (process.env.FAIL_UPLOAD === 'true' && !fs.existsSync(path.join(root, 'failed'))) { fs.writeFileSync(path.join(root, 'failed'), '1'); process.exit(1); }
  }
} else if (args[1] === 'download') {
  const output = args[args.indexOf('--dir') + 1];
  for (const name of fs.readdirSync(remote)) fs.copyFileSync(path.join(remote, name), path.join(output, name));
} else if (args[1] === 'edit') fs.writeFileSync(state, JSON.stringify({isDraft:false}));
else process.exit(64);
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "npm"),
    `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = process.env.FIXTURE, args = process.argv.slice(2), file = path.join(root, 'npm.json');
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
if (args[0] === 'view') {
  if (!state[args[1]]) { console.error('E404'); process.exit(1); }
  console.log(JSON.stringify(state[args[1]]));
} else if (args[0] === 'publish') {
  if (process.env.FAIL_NPM_AT && args[1].includes(process.env.FAIL_NPM_AT)) process.exit(1);
  const name = '@ivoryheart/' + path.basename(args[1]).replace(/^ivoryheart-/, '').replace(/-0.3.6.tgz$/, '@0.3.6');
  state[name] = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(args[1])).digest('base64');
  fs.writeFileSync(file, JSON.stringify(state));
} else process.exit(64);
`,
    { mode: 0o755 },
  );
  const run = (script, args = [], extra = {}) =>
    spawnSync(["node", join(import.meta.dir, script), ...args], {
      env: { ...env, ...extra },
      stdout: "pipe",
      stderr: "pipe",
    });
  return {
    root,
    bundle,
    env,
    run,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("partial GitHub upload stays draft; retry reuses verified bytes and rejects drift", () => {
  const f = fixture();
  try {
    for (const name of [
      "archive.tar.xz",
      "archive.sha256",
      "install-herdr-world.sh",
    ])
      writeFileSync(join(f.bundle, "github", name), name);
    sealBundle(f.bundle, "0.3.6", "fixture-sha");
    const args = ["0.3.6", f.bundle, "fixture-sha"];
    expect(
      f.run("publish-github-release.mjs", args, { FAIL_UPLOAD: "true" })
        .exitCode,
    ).toBe(1);
    expect(JSON.parse(readFileSync(join(f.root, "github.json"))).isDraft).toBe(
      true,
    );
    expect(readdirSync(join(f.root, "remote"))).toHaveLength(1);
    const retry = f.run("publish-github-release.mjs", args);
    expect(retry.stderr.toString()).toBe("");
    expect(retry.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(f.root, "github.json"))).isDraft).toBe(
      false,
    );
    const calls = readFileSync(join(f.root, "calls"), "utf8");
    expect(f.run("publish-github-release.mjs", args).exitCode).toBe(0);
    const newCalls = readFileSync(join(f.root, "calls"), "utf8").slice(
      calls.length,
    );
    expect(newCalls).not.toContain('"upload"');
    expect(newCalls).not.toContain('"create"');
    writeFileSync(join(f.root, "remote/archive.tar.xz"), "drift");
    expect(
      f.run("publish-github-release.mjs", args).stderr.toString(),
    ).toContain("Published GitHub asset differs");
    writeFileSync(join(f.bundle, "github/archive.tar.xz"), "local drift");
    const before = readFileSync(join(f.root, "calls"), "utf8");
    expect(
      f.run("publish-github-release.mjs", args).stderr.toString(),
    ).toContain("digests differ");
    expect(readFileSync(join(f.root, "calls"), "utf8")).toBe(before);
  } finally {
    f.cleanup();
  }
});

test("npm partial publication reports each public package and resumes without repacking", () => {
  const f = fixture();
  try {
    for (const suffix of [
      "-linux-x64",
      "-linux-arm64",
      "-darwin-x64",
      "-darwin-arm64",
      "-windows-x64",
      "-windows-arm64",
      "",
    ]) {
      writeFileSync(
        join(f.bundle, `npm/ivoryheart-herdr-world${suffix}-0.3.6.tgz`),
        `verified ${suffix}`,
      );
    }
    const args = ["0.3.6", join(f.bundle, "npm")];
    expect(
      f.run("publish-npm-release.mjs", args, { FAIL_NPM_AT: "darwin-x64" })
        .exitCode,
    ).toBe(1);
    const before = JSON.parse(readFileSync(join(f.root, "npm.json")));
    expect(Object.keys(before)).toHaveLength(2);
    const retry = f.run("publish-npm-release.mjs", args);
    expect(retry.exitCode).toBe(0);
    expect(retry.stdout.toString()).toContain("Already published");
    expect(
      Object.keys(JSON.parse(readFileSync(join(f.root, "npm.json")))),
    ).toHaveLength(7);
    const archive = join(
      f.bundle,
      "npm/ivoryheart-herdr-world-linux-x64-0.3.6.tgz",
    );
    const hash = createHash("sha512")
      .update(readFileSync(archive))
      .digest("base64");
    expect(before["@ivoryheart/herdr-world-linux-x64@0.3.6"]).toBe(
      `sha512-${hash}`,
    );
    writeFileSync(archive, "rebuilt bytes");
    expect(f.run("publish-npm-release.mjs", args).stderr.toString()).toContain(
      "different package contents",
    );
  } finally {
    f.cleanup();
  }
});

test.each(
  [0, 1, 2, 3].flatMap((count) => [true, false].map((draft) => [count, draft])),
)(
  "GitHub recovery at asset boundary %i (draft=%s) preserves identical public bytes",
  (count, draft) => {
    const f = fixture();
    try {
      const names = ["a.tar.xz", "b.sha256", "install-herdr-world.sh"];
      for (const name of names)
        writeFileSync(join(f.bundle, "github", name), `sealed ${name}`);
      sealBundle(f.bundle, "0.3.6", "fixture-sha");
      writeFileSync(
        join(f.root, "github.json"),
        JSON.stringify({ isDraft: draft }),
      );
      for (const name of names.slice(0, count))
        writeFileSync(join(f.root, "remote", name), `sealed ${name}`);
      const result = f.run("publish-github-release.mjs", [
        "0.3.6",
        f.bundle,
        "fixture-sha",
      ]);
      expect(result.exitCode).toBe(draft || count === 3 ? 0 : 1);
      for (const name of names.slice(0, count))
        expect(readFileSync(join(f.root, "remote", name), "utf8")).toBe(
          `sealed ${name}`,
        );
      if (draft || count === 3) {
        const replay = f.run("publish-github-release.mjs", [
          "0.3.6",
          f.bundle,
          "fixture-sha",
        ]);
        expect(replay.exitCode).toBe(0);
        expect(readdirSync(join(f.root, "remote")).sort()).toEqual(names);
      }
    } finally {
      f.cleanup();
    }
  },
);

test.each([
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
  "",
])(
  "npm interruption before %s resumes exactly the remaining immutable versions",
  (cut) => {
    const f = fixture();
    try {
      const platforms = [
        "linux-x64",
        "linux-arm64",
        "darwin-x64",
        "darwin-arm64",
        "windows-x64",
        "windows-arm64",
        "",
      ];
      for (const platform of platforms)
        writeFileSync(
          join(
            f.bundle,
            "npm",
            `ivoryheart-herdr-world${platform ? "-" + platform : ""}-0.3.6.tgz`,
          ),
          `sealed ${platform}`,
        );
      const args = ["0.3.6", join(f.bundle, "npm")];
      const interrupted = f.run("publish-npm-release.mjs", args, {
        FAIL_NPM_AT: cut ? `herdr-world-${cut}-` : "herdr-world-0.3.6.tgz",
      });
      expect(interrupted.exitCode).toBe(1);
      expect(f.run("publish-npm-release.mjs", args).exitCode).toBe(0);
      const replay = f.run("publish-npm-release.mjs", args);
      expect(replay.exitCode).toBe(0);
      expect(
        replay.stdout.toString().match(/Already published:/g),
      ).toHaveLength(7);
      expect(
        Object.keys(JSON.parse(readFileSync(join(f.root, "npm.json"), "utf8"))),
      ).toHaveLength(7);
    } finally {
      f.cleanup();
    }
  },
);
