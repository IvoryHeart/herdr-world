import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { crewPass } from "./crew";
import type { Deps } from "./crew/deps";
import { config, input, NOW, SHA } from "./gate/cases";
import { evaluate, type GateInput } from "./gate/predicate";
import { SETTINGS_DEFAULTS } from "./crew/plan";
import { saveCycle } from "./crew/round-policy-store";
import { openCrewStore, openLock, roundFor } from "./crew/store";

export const cleanups: (() => void)[] = [];
export function cleanupDeliveries() {
  for (const cleanup of cleanups.splice(0)) cleanup();
}

export function setup(
  options: { reviewers?: string[]; seedCycle?: boolean } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "crew-round-delivery-"));
  const dir = join(root, ".agents", "crew-gate");
  const configPath = join(root, "config.json");
  const settings = {
    ...SETTINGS_DEFAULTS,
    maxRuns: 1,
    authors: { "7": "builder" },
    roster: {
      "rev-astra": { model: "gpt-6-astra" },
      rev2: { model: "gpt-6.1-sol" },
      evaluator: { model: "claude-opus-5-5", effort: "high" },
      visionary: { model: "claude-opus-5-5" },
    },
  };
  const gateConfig = {
    ...config,
    reviewers: { default: options.reviewers ?? ["rev2"] },
  };
  writeFileSync(configPath, JSON.stringify({ ...gateConfig, crew: settings }));
  const crew = openCrewStore(":memory:");
  const lock = openLock(":memory:");
  cleanups.push(() => {
    crew.close();
    lock.close();
    rmSync(root, { recursive: true, force: true });
  });
  const round = roundFor(crew, 7, SHA.reviewed, NOW - 1_000_000);
  if (options.seedCycle !== false)
    saveCycle(crew, {
      pr: 7,
      head: SHA.reviewed,
      round: round.round,
      ordinal: 2,
      reviewers: options.reviewers ?? ["rev2"],
      trigger: {
        replies: [],
        quietSince: NOW - 1_000_000,
        reason: "synthetic round 2",
      },
    });
  let posts = [
    {
      id: 101,
      body: `Reviewer: rev2\nReviewed commit: ${SHA.reviewed}\nRESULT #7: 0/0 resolved, 1 new\nP2 src/widget.ts:10 incorrect recovery`,
      created_at: new Date(NOW - 60_000).toISOString(),
      html_url:
        "https://github.com/example-org/widgets/pull/7#pullrequestreview-101",
    },
  ];
  const spawned: string[][] = [];
  const killed: number[] = [];
  const calls: string[][] = [];
  const deps: Deps = {
    run: (argv) => {
      calls.push(argv);
      let stdout = "";
      if (argv.join(" ") === "herdr agent list")
        stdout = '{"result":{"agents":[]}}';
      else if (argv[0] === "gh" && argv.includes("--paginate"))
        stdout = JSON.stringify([
          argv.at(-1)!.includes("issues/7/comments") ? posts : [],
        ]);
      else if (argv[0] === "herdr-world")
        stdout = '{"ok":true,"result":{"id":"q-synthetic"}}';
      else if (argv.includes("rev-list"))
        stdout = `${SHA.fixed} ${SHA.reviewed}\n`;
      else if (argv.includes("diff")) stdout = "src/widget.ts\0";
      return { code: 0, stdout, stderr: "" };
    },
    spawn: (argv) => {
      spawned.push(argv);
      return { pid: 1000 + spawned.length, pane: null, tab: null };
    },
    alive: () => true,
    kill: (pid) => killed.push(pid),
    usage: () => null,
    closeTab: () => true,
    openTab: () => null,
    out: () => {},
  };
  const value = (head = SHA.reviewed, clear = false) =>
    input({
      head,
      posts: [
        {
          reviewer: "rev2",
          commit: SHA.reviewed,
          result: clear ? "1/1 resolved, 0 new" : "0/0 resolved, 1 new",
        },
      ],
      item: { branch: "agent/builder-7" },
    });
  const passInput = (item: GateInput, now = NOW) =>
    crewPass({
      crew,
      lock,
      judge: () => ({
        verdicts: [evaluate(item, gateConfig, NOW)],
        inputs: [item],
      }),
      configPath,
      dir,
      prs: [],
      dryRun: false,
      now,
      deps,
      worker: ["bun", "crew.ts"],
    });
  const pass = (head = SHA.reviewed, now = NOW, clear = false) =>
    passInput(value(head, clear), now);
  const comment = (body: string, at = NOW + 1) => {
    posts = [
      ...posts,
      {
        id: 200 + posts.length,
        body,
        created_at: new Date(at).toISOString(),
        html_url:
          "https://github.com/example-org/widgets/pull/7#issuecomment-201",
      },
    ];
  };
  return { crew, deps, spawned, killed, calls, pass, passInput, comment };
}
