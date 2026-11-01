import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { menuQuoted, parseCommandMenu } from "./pending-prompt";

const context = { session: "fixture", seq: 7 };
const screen = (name: string) =>
  readFileSync(
    new URL(`./fixtures/pending-prompts/${name}.txt`, import.meta.url),
    "utf8",
  );
const menu = (name: string) =>
  parseCommandMenu(
    name.includes("codex") ? "codex" : "claude",
    screen(name),
    context,
  );
const keys = (name: string) =>
  menu(name)!.menu!.controls.map((control) => control.key);

test("Claude /model: digits pick only where no longer number starts with them", () => {
  for (const name of ["menu-claude-model", "menu-claude-classic-model"]) {
    const prompt = menu(name)!;
    expect(prompt.question).toEqual(["Select model"]);
    // The list reaches 13 (10 shown, "… +3 models"): "1" could start "10".
    expect(prompt.options.map((option) => option.key)).toEqual([
      "",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "",
    ]);
    expect(prompt.options.find((option) => option.cursor)?.number).toBe("2");
    expect(prompt.options[1]).toMatchObject({
      label: "Opus 5.5 ✔",
      description: "For complex work and everyday tasks",
    });
    expect(prompt.menu!.after).toEqual([
      "… +3 models",
      "● High effort ←/→ to adjust",
    ]);
    expect(prompt.menu).toMatchObject({
      footer:
        "Enter to set as default · s to use this session only · Esc to cancel",
    });
    expect(prompt.menu!.controls).toEqual([
      { key: "enter", label: "Enter", action: "set as default" },
      { key: "s", label: "s", action: "use this session only" },
      { key: "esc", label: "Esc", action: "cancel" },
      { key: "left", label: "←", action: "adjust" },
      { key: "right", label: "→", action: "adjust" },
      { key: "up", label: "↑", action: "move" },
      { key: "down", label: "↓", action: "move" },
    ]);
  }
});

test("Claude /model scrolled: the window and its cursor follow the screen", () => {
  const prompt = menu("menu-claude-model-scrolled")!;
  expect(prompt.options.map((option) => option.number)).toEqual([
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "11",
  ]);
  expect(prompt.options.at(-1)).toMatchObject({ cursor: true, key: "" });
  expect(prompt.fingerprint).not.toBe(menu("menu-claude-model")!.fingerprint);
});

test("Claude /permissions: tabs and a search field take no digits", () => {
  for (const name of [
    "menu-claude-permissions",
    "menu-claude-classic-permissions",
  ]) {
    const prompt = menu(name)!;
    expect(prompt.question[0]).toStartWith("Permissions  Recently denied");
    expect(prompt.menu!.field).toBe("Search…");
    expect(prompt.options.every((option) => option.key === "")).toBe(true);
    expect(keys(name)).toEqual(
      expect.arrayContaining(["left", "right", "down", "esc"]),
    );
  }
});

test("Claude /permissions with its list focused, which Herdr reports blocked", () => {
  const prompt = menu("menu-claude-permissions-list")!;
  expect(prompt.options.find((option) => option.cursor)?.label).toBe(
    "Add a new rule…",
  );
  // The search field still takes typed digits.
  expect(prompt.options.every((option) => option.key === "")).toBe(true);
  expect(keys("menu-claude-permissions-list")).toEqual([
    "up",
    "down",
    "enter",
    "left",
    "right",
    "esc",
  ]);
});

test("Claude /permissions follow-up steps: a rule field, then where to save it", () => {
  const rule = menu("menu-claude-permission-rule")!;
  expect(rule.question).toEqual(["Add allow permission rule"]);
  expect(rule.options).toEqual([]);
  expect(rule.menu!.field).toBe("Enter permission rule…");
  expect(keys("menu-claude-permission-rule")).toEqual(["enter", "esc"]);

  const where = menu("menu-claude-permission-where")!;
  expect(where.request).toEqual([
    "Bash(ls *)",
    "Any Bash command starting with ls",
    "Where should this rule be saved?",
  ]);
  expect(where.options.map((option) => [option.key, option.label])).toEqual([
    ["1", "Project settings (local)"],
    ["2", "Project settings"],
    ["3", "User settings"],
  ]);
  expect(keys("menu-claude-permission-where")).toEqual([
    "enter",
    "esc",
    "up",
    "down",
  ]);
});

test("Codex /model, its effort step and /permissions read as menus", () => {
  const model = menu("menu-codex-model")!;
  expect(model.question).toEqual(["Select Model and Effort"]);
  expect(model.options).toHaveLength(8);
  expect(model.options[0]).toMatchObject({
    key: "1",
    cursor: true,
    label: "GPT-6.1-Sol (current)",
  });

  const effort = menu("menu-codex-effort")!;
  expect(effort.question).toEqual(["Select Reasoning Level for GPT-6.1-Sol"]);
  expect(effort.options.find((option) => option.cursor)?.label).toBe(
    "High (current)",
  );
  expect(keys("menu-codex-effort")).toEqual([
    "enter",
    "s",
    "esc",
    "up",
    "down",
  ]);

  const permissions = menu("menu-codex-permissions")!;
  expect(permissions.options[0]!.description).toBe(
    "Read and edit workspace files and run commands, with approval required for internet access or edits outside the workspace",
  );
});

test("Codex's confirmation above its idle composer is read; its composer is not", () => {
  const prompt = menu("menu-codex-full-access")!;
  expect(prompt.question).toEqual(["Enable full access?"]);
  expect(prompt.request[0]).toBe(
    "When Codex runs with full access, it can edit any file on your",
  );
  expect(prompt.options.map((option) => option.label)).toEqual([
    "Yes, continue anyway",
    "Cancel",
  ]);
});

test("closed menus, questions and composers are not command menus", () => {
  const dir = new URL("./fixtures/pending-prompts/", import.meta.url);
  const others = readdirSync(dir)
    .filter((file) => file.endsWith(".txt") && !file.startsWith("menu-"))
    .map((file) => file.slice(0, -4));
  expect(others.length).toBeGreaterThan(5);
  for (const name of [...others, "menu-claude-closed", "menu-codex-closed"])
    expect([name, menu(name)]).toEqual([name, null]);
  // Other harnesses' screens are never read as these menus.
  expect(parseCommandMenu("pi", screen("menu-codex-model"), context)).toBe(
    null,
  );
});

test("a cut-off or altered menu is not offered", () => {
  const lines = screen("menu-claude-permission-where").split("\n");
  // Without its top edge the panel cannot be bounded.
  const cut = lines.filter((line) => !line.startsWith("▔")).join("\n");
  expect(parseCommandMenu("claude", cut, context)).toBe(null);
  // Two cursors, or a gap in the numbering, are not one menu.
  const twoCursors = screen("menu-claude-permission-where").replace(
    "     2. Project",
    "   ❯ 2. Project",
  );
  expect(parseCommandMenu("claude", twoCursors, context)).toBe(null);
  const gap = screen("menu-codex-permissions").replace(
    "  3. Full",
    "  5. Full",
  );
  expect(parseCommandMenu("codex", gap, context)).toBe(null);
  // A footer without Escape is not a menu's.
  const noEscape = screen("menu-codex-model").replace(" · esc back", "");
  expect(parseCommandMenu("codex", noEscape, context)).toBe(null);
});

test("the fingerprint covers the session and Herdr's state", () => {
  const text = screen("menu-codex-model");
  const base = parseCommandMenu("codex", text, context)!.fingerprint;
  expect(
    parseCommandMenu("codex", text, { ...context, session: "other" })!
      .fingerprint,
  ).not.toBe(base);
  expect(
    parseCommandMenu("codex", text, { ...context, seq: 8 })!.fingerprint,
  ).not.toBe(base);
});

const quotedConfirmation = [
  "• The confirmation looks like this:",
  "",
  "    Enable full access?",
  "    When Codex runs with full access, it can edit any file.",
  "",
  "  › 1. Yes, continue anyway  Apply full access for this session",
  "    2. Cancel                Go back without enabling full access",
  "",
  "    enter select · esc back",
  "",
  "› Ask Codex to do anything",
  "",
  "  GPT-6.1-Sol high · Context 0% used",
  "  ? for shortcuts",
].join("\n");

test("a Codex menu above the composer may be the agent quoting one", () => {
  // The layout alone cannot tell a quoted menu from a real one.
  const quoted = parseCommandMenu("codex", quotedConfirmation, context)!;
  expect(quoted.question).toEqual(["Enable full access?"]);
  expect(quoted.menu!.overlay).toBe(true);
  expect(menu("menu-codex-full-access")!.menu!.overlay).toBe(true);
  // The agent's last message decides: quoting the title or footer, or an
  // unreadable transcript, is not a menu.
  expect(
    menuQuoted(
      quoted,
      "The confirmation looks like this:\n\nEnable full access?",
    ),
  ).toBe(true);
  expect(menuQuoted(quoted, "Press enter select · esc back to leave.")).toBe(
    true,
  );
  expect(menuQuoted(quoted, null)).toBe(true);
  expect(menuQuoted(quoted, "Switched permissions.")).toBe(false);
  // A menu at the bottom of the screen replaces the composer: never a quote.
  const bottom = menu("menu-codex-permissions")!;
  expect(bottom.menu!.overlay).toBeUndefined();
  expect(menuQuoted(bottom, null)).toBe(false);
});
