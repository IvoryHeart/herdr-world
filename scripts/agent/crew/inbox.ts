import type { Database } from "bun:sqlite";
import { watch } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { Deps } from "./deps";
import { herdrIds, shellLine } from "./deps";
import {
  dismissItem,
  listItems,
  markNotified,
  openOwnerStore,
  putItem,
  resolveItem,
  type OwnerItem,
  type OwnerTarget,
} from "./owner-items";

export const INBOX_USAGE = `Usage: bun run agent:crew -- inbox [--json]
  inbox tab                         Open the live Owner inbox in a Herdr tab
  inbox open ID                     Open the item's PR, seat or reviewer table
  inbox dismiss ID                  Hide until the cause clears and recurs
  inbox add --key KEY --reason TEXT [--pr N] (--seat NAME | --url URL | --tab ID)
                                    Dispatcher: record one durable cause and nudge
  inbox resolve --key KEY            Dispatcher: clear a cause
  inbox watch                       Live terminal list (used by the tab)`;

/** Only explicit owner actions focus another tab or open a browser. */
export function openItem(target: OwnerTarget, deps: Deps) {
  let result = deps.run(
    target.kind === "url"
      ? browserCommand(target.value)
      : [
          "herdr",
          target.kind === "seat" ? "agent" : "tab",
          "focus",
          target.value,
        ],
  );
  if (result.code !== 0 && target.fallbackUrl)
    result = deps.run(browserCommand(target.fallbackUrl));
  if (result.code !== 0)
    throw new Error(
      (result.stderr || result.stdout).trim() || "Couldn't open owner item",
    );
}

export function browserCommand(url: string, platform = process.platform) {
  if (platform === "darwin") return ["open", url];
  if (platform === "win32")
    return ["rundll32.exe", "url.dll,FileProtocolHandler", url];
  return ["xdg-open", url];
}

/** A shared, background Herdr tab, also visible in World's Spaces view. */
export function inboxTab(db: Database, dir: string, deps: Deps, focus = false) {
  return db
    .transaction(() => {
      const saved = db
        .query<{ tab: string }, []>("SELECT tab FROM inbox_tab WHERE id = 1")
        .get();
      if (saved && deps.run(["herdr", "tab", "get", saved.tab]).code === 0) {
        if (focus) openItem({ kind: "tab", value: saved.tab }, deps);
        return saved.tab;
      }
      const created = deps.run([
        "herdr",
        "tab",
        "create",
        ...(process.env.HERDR_WORKSPACE_ID
          ? ["--workspace", process.env.HERDR_WORKSPACE_ID]
          : []),
        "--cwd",
        dirname(dirname(dir)),
        "--label",
        "Owner inbox",
        ...(focus ? [] : ["--no-focus"]),
      ]);
      const { tab, pane } = herdrIds(created.stdout);
      if (created.code !== 0 || !tab || !pane) return null;
      const line = shellLine([
        "bun",
        join(import.meta.dir, "..", "crew.ts"),
        "inbox",
        "watch",
        "--tab",
        tab,
      ]);
      if (deps.run(["herdr", "pane", "run", pane, line]).code !== 0) {
        deps.run(["herdr", "tab", "close", tab]);
        return null;
      }
      db.query("INSERT OR REPLACE INTO inbox_tab (id, tab) VALUES (1, ?)").run(
        tab,
      );
      return tab;
    })
    .immediate();
}

/** Persist first; toast delivery can fail without losing the owner's work. */
export function nudgeItems(db: Database, dir: string, deps: Deps, now: number) {
  db.transaction(() => {
    const pending = listItems(db).filter((entry) => entry.notifiedAt === null);
    if (!pending.length) return;
    inboxTab(db, dir, deps);
    for (const entry of pending) {
      const result = deps.run([
        "herdr",
        "notification",
        "show",
        entry.source === "crew"
          ? entry.reason.startsWith("READY ")
            ? `Crew: READY #${entry.pr}`
            : `Crew: ${entry.pr ? `#${entry.pr}` : entry.seat} needs you`
          : "Dispatch: needs you",
        "--body",
        `${entry.reason}\nOwner inbox → bun run agent:crew -- inbox`,
        "--sound",
        entry.reason.startsWith("READY ") ? "done" : "request",
      ]);
      if (result.code === 0) markNotified(db, entry.id, now);
    }
  }).immediate();
}

/** Strip terminal control characters from producer text before rendering. */
export function itemLine(entry: OwnerItem) {
  return `${entry.id}\t${entry.pr ? `#${entry.pr} ` : ""}${entry.seat ? `${entry.seat}: ` : ""}${entry.reason}`.replace(
    /[\x00-\x1f\x7f-\x9f]/gu,
    " ",
  );
}

async function liveInbox(db: Database, dir: string, deps: Deps, tab?: string) {
  if (!process.stdin.isTTY)
    throw new Error("inbox watch needs an interactive terminal");
  const render = () => {
    process.stdout.write("\x1b[2J\x1b[HOwner inbox\n\n");
    const items = listItems(db);
    for (const entry of items) deps.out(itemLine(entry));
    if (!items.length) deps.out("No open owner items.");
    deps.out(
      "\nEnter an item ID to open it; d ID to dismiss; r to refresh; q to quit.",
    );
  };
  const changes = watch(dir, (_event, name) => {
    if (name?.toString().startsWith("owner-items.sqlite")) render();
  });
  const input = createInterface({ input: process.stdin });
  render();
  try {
    for await (const line of input) {
      const text = line.trim();
      if (text === "q") break;
      const match = /^(d\s+)?([1-9]\d*)$/u.exec(text);
      try {
        if (match) {
          const entry = listItems(db).find(
            (item) => item.id === Number(match[2]),
          );
          if (!entry)
            throw new Error("That item has cleared or was dismissed.");
          if (match[1]) dismissItem(db, entry.id, Date.now());
          else openItem(entry.target, deps);
        }
        render();
      } catch (error) {
        deps.out(String(error));
      }
    }
  } finally {
    changes.close();
    input.close();
    if (tab)
      db.query("DELETE FROM inbox_tab WHERE id = 1 AND tab = ?").run(tab);
  }
}

export async function inboxCommand(argv: string[], dir: string, deps: Deps) {
  const command = argv[0]?.startsWith("--") ? "list" : (argv.shift() ?? "list");
  const flags = new Map<string, string>();
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") flags.set(arg, "true");
    else if (
      ["--key", "--reason", "--pr", "--seat", "--url", "--tab"].includes(arg)
    ) {
      const value = argv[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} needs a value`);
      flags.set(arg, value);
    } else if (arg.startsWith("--")) throw new Error(INBOX_USAGE);
    else args.push(arg);
  }
  const required = (key: string) => {
    const value = flags.get(key)?.trim();
    if (!value) throw new Error(`${key} is required\n${INBOX_USAGE}`);
    return value;
  };
  const db = openOwnerStore(join(dir, "owner-items.sqlite"));
  try {
    const now = Date.now();
    if (command === "add") {
      const targets = (["seat", "url", "tab"] as const).filter((kind) =>
        flags.has(`--${kind}`),
      );
      if (targets.length !== 1)
        throw new Error("Choose exactly one of --seat, --url or --tab");
      const kind = targets[0]!;
      const value = required(`--${kind}`);
      if (kind === "url" && !/^https:\/\//u.test(value))
        throw new Error("--url needs an HTTPS URL");
      const pr = flags.has("--pr") ? Number(required("--pr")) : undefined;
      if (pr !== undefined && (!Number.isSafeInteger(pr) || pr < 1))
        throw new Error("--pr needs a positive number");
      const entry = putItem(
        db,
        {
          source: "dispatch",
          key: required("--key"),
          reason: required("--reason"),
          ...(pr ? { pr } : {}),
          ...(kind === "seat" ? { seat: value } : {}),
          target: { kind, value },
        },
        now,
      );
      nudgeItems(db, dir, deps, now);
      deps.out(itemLine(entry));
    } else if (command === "resolve") {
      resolveItem(db, "dispatch", required("--key"), now);
    } else if (command === "dismiss" || command === "open") {
      const entry = listItems(db).find((item) => item.id === Number(args[0]));
      if (!entry) throw new Error("No open owner item with that ID");
      if (command === "dismiss") dismissItem(db, entry.id, now);
      else openItem(entry.target, deps);
    } else if (command === "tab") {
      if (!inboxTab(db, dir, deps, true))
        throw new Error("Couldn't open Owner inbox tab");
    } else if (command === "watch") {
      await liveInbox(db, dir, deps, flags.get("--tab"));
    } else if (command === "list") {
      const items = listItems(db);
      if (flags.has("--json")) deps.out(JSON.stringify(items));
      else {
        deps.out(`${items.length} open owner item(s), newest first`);
        for (const entry of items) deps.out(itemLine(entry));
      }
    } else throw new Error(INBOX_USAGE);
    return 0;
  } finally {
    db.close();
  }
}
