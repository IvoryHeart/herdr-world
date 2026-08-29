#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

function parseNpmErrorCode(output) {
  if (!output) return null;
  try {
    return JSON.parse(output)?.error?.code ?? null;
  } catch {
    return null;
  }
}

export function queryNpm(args, { command = "npm" } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;

  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  if (result.status === 0) return { present: true, raw: stdout };

  const errorCode = parseNpmErrorCode(stdout) ?? parseNpmErrorCode(stderr);
  if (errorCode === "E404") return { present: false, raw: "" };

  const detail = stderr || stdout || `exit status ${result.status}`;
  throw new Error(`npm ${args.join(" ")} failed${errorCode ? ` (${errorCode})` : ""}: ${detail}`);
}

function valueFromResult(result) {
  if (
    !result.present ||
    !result.raw ||
    result.raw === "null" ||
    result.raw === "undefined"
  ) return "";
  const value = JSON.parse(result.raw);
  return value === null || value === undefined ? "" : String(value);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  if (!mode || args.length === 0 || !["state", "value"].includes(mode)) {
    console.error("Usage: node scripts/npm-registry-query.mjs <state|value> npm-args...");
    process.exit(2);
  }
  try {
    const result = queryNpm(args);
    if (mode === "state") {
      console.log(JSON.stringify(result));
    } else {
      process.stdout.write(`${valueFromResult(result)}\n`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
