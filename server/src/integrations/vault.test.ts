import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSourceSecrets, writeSourceSecrets } from "../sources/secrets";
import { fileVault } from "./vault";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function vaultPath() {
  const root = mkdtempSync(join(tmpdir(), "world-vault-"));
  dirs.push(root);
  return join(root, "source-secrets.json");
}

test("keeps named secrets private and reports only their names", () => {
  const path = vaultPath();
  const vault = fileVault(path);
  expect(vault.status().secrets).toEqual([]);
  vault.set("jira.token", "synthetic-token");
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(vault.get("jira.token")).toBe("synthetic-token");
  const status = vault.status();
  expect(status).toMatchObject({ backend: "file", label: "Private file" });
  expect(status.secrets).toEqual([
    { name: "jira.token", label: "Jira API token", usedBy: "source:jira" },
  ]);
  expect(JSON.stringify(status)).not.toContain("synthetic-token");
  vault.set("jira.token", undefined);
  expect(vault.get("jira.token")).toBeUndefined();
  expect(vault.status().secrets).toEqual([]);
});

test("reads the earlier source-secrets format and rewrites it", () => {
  const path = vaultPath();
  writeFileSync(
    path,
    JSON.stringify({ version: 1, jira_token: "legacy-token" }),
    { mode: 0o600 },
  );
  expect(readSourceSecrets(path)).toEqual({ jiraToken: "legacy-token" });
  writeSourceSecrets({ jiraToken: "next-token" }, path);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    version: 2,
    secrets: { "jira.token": "next-token" },
  });
  expect(readSourceSecrets(path)).toEqual({ jiraToken: "next-token" });
});

test("narrows a readable vault file back to owner-only", () => {
  if (process.platform === "win32") return;
  const path = vaultPath();
  fileVault(path).set("jira.token", "synthetic-token");
  chmodSync(path, 0o644);
  expect(fileVault(path).get("jira.token")).toBe("synthetic-token");
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

test("refuses a symlinked vault and ignores unknown names", () => {
  const path = vaultPath();
  const target = `${path}.target`;
  writeFileSync(
    target,
    JSON.stringify({ version: 2, secrets: { "jira.token": "x" } }),
  );
  symlinkSync(target, path);
  expect(() => fileVault(path).get("jira.token")).toThrow();
  expect(fileVault(path).status().detail).toContain("can't read");

  const other = vaultPath();
  writeFileSync(
    other,
    JSON.stringify({ version: 2, secrets: { "other.token": "x" } }),
    { mode: 0o600 },
  );
  expect(fileVault(other).status().secrets).toEqual([]);
});

test("refuses writes once storage is closed", () => {
  const path = vaultPath();
  const vault = fileVault(path, { writable: () => false });
  expect(() => vault.set("jira.token", "synthetic-token")).toThrow(
    "World storage is closed",
  );
});
