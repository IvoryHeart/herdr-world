import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CLAUDE_TAP_MARK, claudeTapCommand } from "../usage/claude-tap";
import { shQuote } from "../utils/process-utils";
import type { CliRuntime } from "./command";
import { claudeSettings } from "./claude-settings";

type Saved = { version: 1; before: string | null; installed: string };
function info(file: string) {
  try {
    return lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function regular(file: string, directory = false) {
  const stat = info(file);
  if (stat && !(directory ? stat.isDirectory() : stat.isFile()))
    throw new Error(
      `refusing non-${directory ? "directory" : "regular file"}: ${file}`,
    );
  return stat;
}
function read(file: string) {
  if (!regular(file)) return null;
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    readFileSync(file),
  );
}
function atomic(file: string, text: string, mode = 0o600) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { flag: "wx", mode });
    renameSync(temporary, file);
  } finally {
    if (info(temporary)) unlinkSync(temporary);
  }
}
function paths(config: string) {
  const folder = join(config, "herdr-world");
  return {
    folder,
    settings: join(config, "settings.json"),
    saved: join(folder, "claude-status-line.json"),
    script: join(folder, "herdr-world-claude-tap.sh"),
  };
}
function savedState(text: string | null): Saved | null {
  if (text === null) return null;
  const state = JSON.parse(text);
  if (
    state?.version !== 1 ||
    !(state.before === null || typeof state.before === "string") ||
    typeof state.installed !== "string"
  )
    throw new Error(
      "invalid World Claude status line backup; preserve it for recovery",
    );
  if (state.before !== null) claudeSettings(state.before);
  if (
    !claudeSettings(state.installed).value.statusLine?.command?.includes(
      CLAUDE_TAP_MARK,
    )
  )
    throw new Error("invalid World Claude status line registration");
  return state as Saved;
}
const sameLine = isDeepStrictEqual;

function ownsLine(line: any, saved: Saved) {
  return (
    line?.type === "command" &&
    line.command === claudeSettings(saved.installed).value.statusLine.command
  );
}

function restoredSettings(
  saved: Saved,
  document: ReturnType<typeof claudeSettings>,
  current: string,
) {
  if (current === saved.installed) return saved.before;
  const original = claudeSettings(saved.before ?? "{}");
  const line = original.value.statusLine;
  const registered = claudeSettings(saved.installed).value.statusLine;
  const edited = document.value.statusLine;
  let previous = original.raw;
  if (line?.type === "command" && !sameLine(registered, edited)) {
    const merged = { ...line };
    for (const key of new Set([
      ...Object.keys(registered),
      ...Object.keys(edited),
    ])) {
      if (
        key === "type" ||
        key === "command" ||
        sameLine(registered[key], edited[key])
      )
        continue;
      if (Object.hasOwn(edited, key)) merged[key] = edited[key];
      else delete merged[key];
    }
    previous = JSON.stringify(merged);
  }
  const restored = document.replace(previous);
  return saved.before === null &&
    !Object.keys(claudeSettings(restored).value).length
    ? null
    : restored;
}

export function claudeTapCurrent(config: string, runtime: CliRuntime) {
  try {
    const p = paths(config);
    regular(p.folder, true);
    const state = savedState(read(p.saved));
    return (
      !!state &&
      read(p.script) === script(runtime, state.before) &&
      ownsLine(claudeSettings(read(p.settings) ?? "{}").value.statusLine, state)
    );
  } catch {
    return false;
  }
}

function script(runtime: CliRuntime, before: string | null) {
  const previous =
    before === null ? null : claudeSettings(before).value.statusLine;
  const fallback =
    previous?.type === "command" &&
    typeof previous.command === "string" &&
    !previous.command.includes(CLAUDE_TAP_MARK)
      ? `exec sh -c ${shQuote(previous.command)}`
      : ":";
  return `#!/bin/sh\n# ${CLAUDE_TAP_MARK} v1\nif [ -x ${shQuote(runtime.execPath.replaceAll("\\", "/"))} ]; then\n${claudeTapCommand({ kind: "bun", path: runtime.execPath })}\nelse\n${fallback}\nfi\n`;
}

/** All validation precedes writes; backup precedes registration; restore precedes deletion. */
export function changeClaudeTap(
  config: string,
  action: "install" | "uninstall",
  runtime: CliRuntime,
) {
  const p = paths(config);
  if (!info(config) && action === "uninstall") return;
  regular(p.folder, true);
  regular(p.script);
  const lock = join(config, ".herdr-world-tap.lock");
  mkdirSync(lock, { mode: 0o700 });
  try {
    const current = read(p.settings);
    const document = current === null ? null : claudeSettings(current);
    const saved = savedState(read(p.saved));
    const owned = saved && ownsLine(document?.value.statusLine, saved);
    if (
      !saved &&
      document?.value.statusLine?.command?.includes(CLAUDE_TAP_MARK)
    )
      throw new Error(
        "World status line has no matching backup; preserve settings for recovery",
      );
    if (
      !owned &&
      document?.value.statusLine?.command?.includes(CLAUDE_TAP_MARK)
    )
      throw new Error(
        "modified World status line reference; preserve settings and recovery files",
      );
    if (action === "install") {
      const before = owned
        ? restoredSettings(saved, document!, current!)
        : current;
      const previous = document?.value.statusLine;
      const presentation =
        previous && typeof previous === "object" && !Array.isArray(previous)
          ? previous
          : {};
      const line = JSON.stringify({
        ...presentation,
        type: "command",
        command: `sh ${shQuote(p.script.replaceAll("\\", "/"))} # ${CLAUDE_TAP_MARK}`,
      });
      const installed = (document ?? claudeSettings("{}\n")).replace(line);
      mkdirSync(p.folder, { recursive: true, mode: 0o700 });
      atomic(
        p.saved,
        JSON.stringify({ version: 1, before, installed } satisfies Saved),
      );
      atomic(p.script, script(runtime, before), 0o700);
      atomic(p.settings, installed, info(p.settings)?.mode ?? 0o600);
    } else if (saved) {
      if (owned && document) {
        const restored = restoredSettings(saved, document, current!);
        if (restored === null) unlinkSync(p.settings);
        else atomic(p.settings, restored, info(p.settings)?.mode);
      }
      if (info(p.script)) unlinkSync(p.script);
      unlinkSync(p.saved);
      try {
        rmdirSync(p.folder);
      } catch (error) {
        if (
          !["ENOTEMPTY", "EEXIST"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
      }
    }
  } finally {
    rmdirSync(lock);
  }
}
