import { createRoot } from "react-dom/client";
import { bridge } from "../../api";
import type { UsageLimit, WorldUsageSnapshot } from "../../../../shared/usage";
import { townUsageFixture } from "../testing/usageFixture";
import { TownBoard } from "./TownBoard";
import { TownFuel } from "./TownFuelGauge";
import { townFuelGauges } from "./townLimits";
import "../../styles/tokens.css";
import "../../styles/base.css";
import "../worldFonts.css";
import "./town.css";
import "./townBoard.css";

/*
 * The Town board's rows stay inside its border (#886). Synthetic usage: the
 * readings the owner saw (Claude 99 % and 56 % left, Codex stale) and the
 * longest economy caveat line (test data, partial, stale, a missing host),
 * at every width the board takes: 236 px on desktop, 240 px on a phone and
 * 260 px in Board's dock. Every name here is invented.
 */

const failures: string[] = [];
const now = Date.now();
const HOUR = 3_600_000;

const limit = (
  harness: UsageLimit["harness"],
  fields: Partial<UsageLimit>,
): UsageLimit => ({
  connection_id: "example-studio",
  connection_generation: 1,
  harness,
  state: "available",
  reason: null,
  source: harness === "claude" ? "claude-status-line" : "codex-session-log",
  observed_at: now,
  reached: null,
  windows: [],
  ...fields,
});

const week = 10_080;
const snapshot: WorldUsageSnapshot = {
  ...townUsageFixture({ window: "7d" }),
  // "TEST DATA · partial · stale left out · 1 host missing"
  incarnation: "town-economy-preview",
  truncated: true,
  limits: [
    limit("claude", {
      windows: [
        { window_minutes: 300, used_percent: 1, resets_at: now + HOUR },
        { window_minutes: week, used_percent: 44, resets_at: now + 90 * HOUR },
      ],
    }),
    limit("codex", {
      state: "stale",
      observed_at: now - 3 * HOUR,
      windows: [
        { window_minutes: 300, used_percent: 1, resets_at: now - HOUR },
        { window_minutes: week, used_percent: 44, resets_at: now + 90 * HOUR },
      ],
    }),
  ],
};
snapshot.today = {
  total: snapshot.total,
  unattributed: snapshot.unattributed,
  rollups: snapshot.rollups,
};
bridge.call = (async (method: string) =>
  method === "world.usage.get"
    ? structuredClone(snapshot)
    : null) as typeof bridge.call;

// Other rows the board can show: a limit reached with its reset time, a low
// window and an old reading's age. These get their own sign.
const otherGauges = townFuelGauges(
  [
    limit("codex", {
      reached: { window_minutes: week, resets_at: now + 50 * HOUR },
    }),
    limit("claude", {
      observed_at: now - 2 * HOUR,
      windows: [
        { window_minutes: 30, used_percent: 92, resets_at: now + HOUR },
        { window_minutes: week, used_percent: 100, resets_at: now + HOUR },
      ],
    }),
  ],
  now,
);

const host = document.createElement("div");
host.className = "town-shell";
document.body.append(host);
const signHost = document.createElement("div");
signHost.className = "town-shell";
signHost.style.left = "320px";
document.body.append(signHost);
createRoot(host).render(
  <TownBoard
    counts={{
      agents: 12,
      buildings: 3,
      working: 4,
      needsYou: 1,
      finished: 3,
      quiet: 4,
      unknown: 0,
      outOfFuel: 0,
    }}
    onOpenSummary={() => {}}
  />,
);
createRoot(signHost).render(
  <div className="town-board" data-open="true">
    <TownFuel gauges={otherGauges} now={now} />
  </div>,
);

async function waitFor(condition: () => boolean, message: string) {
  const until = performance.now() + 10_000;
  while (!condition()) {
    if (performance.now() > until) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Every drawn element sits within the board's border box, inside its border. */
function checkInside(board: HTMLElement, label: string) {
  const box = board.getBoundingClientRect();
  const style = getComputedStyle(board);
  const left = box.left + parseFloat(style.borderLeftWidth);
  const right = box.right - parseFloat(style.borderRightWidth);
  if (board.scrollWidth > board.clientWidth)
    failures.push(
      `${label}: content is ${board.scrollWidth}px wide in a ${board.clientWidth}px board`,
    );
  for (const element of board.querySelectorAll<HTMLElement>("*")) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || element.closest('[role="tooltip"]')) continue;
    if (rect.left < left - 0.5 || rect.right > right + 0.5)
      failures.push(
        `${label}: ${element.className || element.tagName} "${element.textContent?.slice(0, 24)}" spans ${rect.left.toFixed(1)}–${rect.right.toFixed(1)}, the board ${left.toFixed(1)}–${right.toFixed(1)}`,
      );
  }
}

async function run() {
  const boards = () => document.querySelectorAll<HTMLElement>(".town-board");
  await waitFor(
    () =>
      boards().length === 2 &&
      boards()[0]!.querySelectorAll(".town-fuel-gauge").length === 2 &&
      boards()[0]!.querySelector(".town-board-economy-caveats") !== null,
    "the board never showed its fuel gauges and caveat line",
  );
  const [board, sign] = boards();
  await document.fonts.ready;
  const values = [...board!.querySelectorAll(".town-fuel-value")].map(
    (value) => value.textContent,
  );
  if (values.join(",") !== "99%,56%,stale,stale")
    failures.push(`unexpected fuel values: ${values.join(", ")}`);
  if (!sign!.querySelector(".town-fuel-reached"))
    failures.push("the second sign shows no reached limit");
  for (const width of [236, 240, 260]) {
    board!.style.width = sign!.style.width = `${width}px`;
    checkInside(board!, `board at ${width}px`);
    checkInside(sign!, `reached and low gauges at ${width}px`);
  }
}

run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", {
      method: "POST",
      body: JSON.stringify(failures.slice(0, 30)),
    }),
  );
