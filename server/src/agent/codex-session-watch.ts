import { existsSync, type FSWatcher, watch } from "node:fs";
import { join } from "node:path";
import type { AgentSessionFileAccess } from "./session-file-access";
import { codexHome } from "./session-file-access";
import type { AgentSessionResolverContext } from "./session-resolver";

/**
 * Change detection may reuse a remembered Codex title match only while
 * every Codex session root is watched: any created or removed transcript
 * can change which transcripts a title prefix matches, so it forgets them
 * all. Remote hosts and unwatchable roots always search.
 */
export function createCodexSessionWatch(args: {
  files: AgentSessionFileAccess;
  context: AgentSessionResolverContext;
  onCodexSessionsChanged?: () => void;
}) {
  let codexWatch: { ok: boolean; close(): void } | null = null;
  const watchCodexSessions = () => {
    if (args.files.remote) return false;
    if (codexWatch) return codexWatch.ok;
    const watchers: FSWatcher[] = [];
    let ok = true;
    const forget = () => {
      args.context.codexTitles.clear();
      args.onCodexSessionsChanged?.();
    };
    const home = codexHome();
    const roots = ["sessions", "archived_sessions"];
    for (const name of roots) {
      const root = join(home, name);
      if (!existsSync(root)) continue;
      try {
        const watcher = watch(
          root,
          { recursive: true, persistent: false },
          (type) => {
            if (type === "rename") forget();
          },
        );
        watcher.on("error", () => {
          watcher.close();
          if (codexWatch) codexWatch.ok = false;
          args.context.codexTitles.clear();
        });
        watchers.push(watcher);
      } catch {
        ok = false;
      }
    }
    // A root created later (Codex archives a thread for the first time) is
    // seen through the home directory, and the roots are watched afresh.
    try {
      const watcher = watch(home, { persistent: false }, (_type, name) => {
        if (!roots.includes(String(name))) return;
        codexWatch?.close();
        codexWatch = null;
        forget();
      });
      watcher.on("error", () => {
        watcher.close();
        if (codexWatch) codexWatch.ok = false;
      });
      watchers.push(watcher);
    } catch {
      ok = false;
    }
    codexWatch = {
      ok,
      close: () => watchers.forEach((watcher) => watcher.close()),
    };
    return ok;
  };
  return {
    watch: watchCodexSessions,
    close: () => {
      codexWatch?.close();
      codexWatch = null;
    },
  };
}
