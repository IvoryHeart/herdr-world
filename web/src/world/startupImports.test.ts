import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Every first load fetches WorldFoundationApp and everything it imports
// statically. Views and dialogs that Town's first frame never shows load when
// first opened (#1479); a static import from anywhere in that graph would pull
// them back into startup.
const LOADED_ON_FIRST_OPEN = [
  "world/DeskView.tsx",
  "world/groups/GroupsBody.tsx",
  "world/apartments/ApartmentsDialog.tsx",
  "components/AgentHistoryChat.tsx",
  "components/WorktreeLifecycleDialog.tsx",
];

const src = dirname(dirname(fileURLToPath(import.meta.url)));
const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

function resolveSource(from: string, specifier: string) {
  const base = join(dirname(from), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]
    .filter((candidate) => /\.tsx?$/.test(candidate))
    .find((candidate) => existsSync(candidate));
}

/** Source files reached from `entry` through static, non-type imports. */
function staticImportGraph(entry: string) {
  const reached = new Set<string>();
  const pending = [entry];
  for (let file = pending.pop(); file; file = pending.pop()) {
    if (reached.has(file)) continue;
    reached.add(file);
    const transpiler = transpilers[file.endsWith(".tsx") ? "tsx" : "ts"];
    for (const { kind, path } of transpiler.scanImports(
      readFileSync(file, "utf8"),
    )) {
      if (kind !== "import-statement" || !path.startsWith(".")) continue;
      const resolved = resolveSource(file, path);
      if (resolved) pending.push(resolved);
    }
  }
  return reached;
}

test("Town's first load leaves Desk, Groups, Apartments and worktree dialogs for first open", () => {
  const startup = staticImportGraph(join(src, "world/WorldFoundationApp.tsx"));
  // The walk does follow the app: Town's controls are in it.
  expect(startup.has(join(src, "world/WorldControlPlane.tsx"))).toBe(true);
  expect(startup.has(join(src, "world/groups/GroupsWindow.tsx"))).toBe(true);
  for (const lazy of LOADED_ON_FIRST_OPEN) {
    expect(existsSync(join(src, lazy))).toBe(true);
    expect({ lazy, startup: startup.has(join(src, lazy)) }).toEqual({
      lazy,
      startup: false,
    });
  }
});
