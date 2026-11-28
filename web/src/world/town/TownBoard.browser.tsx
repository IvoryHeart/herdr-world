import { clock } from "../../testing/installRunningTestClock";
import { createRoot } from "react-dom/client";
import { bridge } from "../../api";
import type { UsageLimit, WorldUsageSnapshot } from "../../../../shared/usage";
import { townUsageFixture } from "../testing/usageFixture";
import { TownBoard } from "./TownBoard";
import { TownFuel } from "./TownFuelGauge";
import { townFuelGauges, townFuelNotes } from "./townLimits";
import "../../styles/tokens.css";
import "../../styles/base.css";
import "../worldFonts.css";
import "./town.css";
import "./townBoard.css";
import "./townOverlay.css";

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
// window, an aged reading ("as of …", dimmed) whose 5 h window was not
// reported, and a harness with no reading yet. These get their own sign.
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
const otherNotes = townFuelNotes(
  [limit("codex", { state: "missing", source: null, observed_at: null })],
  [],
  ["codex"],
);
createRoot(signHost).render(
  <div className="town-board" data-open="true">
    <TownFuel gauges={otherGauges} notes={otherNotes} now={now} />
  </div>,
);

async function waitFor(condition: () => boolean, message: string) {
  await clock.until(condition, message);
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

/**
 * The status chip is one compact indicator: the waiting count only, the
 * board a popover that a tap or click pins open, a mouse over the chip
 * shows, and Escape or a tap outside closes (#1006).
 */
async function checkPopover() {
  await waitFor(
    () => host.querySelector(".town-board-chip") !== null,
    "the status chip never rendered",
  );
  const chip = host.querySelector<HTMLButtonElement>(".town-board-chip")!;
  const board = host.querySelector<HTMLElement>(".town-board")!;
  const shown = () => getComputedStyle(board).display !== "none";
  const expect = async (open: boolean, message: string) => {
    try {
      await waitFor(
        () =>
          shown() === open &&
          chip.getAttribute("aria-expanded") === String(open),
        message,
      );
    } catch (error) {
      failures.push(String(error));
    }
  };
  if (chip.textContent?.trim() !== "!1")
    failures.push(
      `the chip shows more than the waiting count: ${chip.textContent}`,
    );
  if (!chip.getAttribute("aria-label")?.includes("1 need you"))
    failures.push(
      `the chip's label lacks the breakdown: ${chip.getAttribute("aria-label")}`,
    );
  await expect(false, "the board starts open");
  chip.click();
  await expect(true, "a tap on the chip did not open the board");
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await expect(false, "Escape did not close the board");
  chip.click();
  await expect(true, "a second tap on the chip did not open the board");
  document.body.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }),
  );
  await expect(false, "a tap outside did not close the board");
  chip.dispatchEvent(
    new PointerEvent("pointerover", {
      bubbles: true,
      pointerType: "mouse",
      relatedTarget: document.body,
    }),
  );
  await expect(true, "hovering the chip did not show the board");
  chip.dispatchEvent(
    new PointerEvent("pointerout", {
      bubbles: true,
      pointerType: "mouse",
      relatedTarget: document.body,
    }),
  );
  await expect(false, "leaving the chip did not hide the board");
  chip.dispatchEvent(
    new PointerEvent("pointerover", {
      bubbles: true,
      pointerType: "mouse",
      relatedTarget: document.body,
    }),
  );
  await expect(true, "hovering the chip again did not show the board");
  // A click on a board the mouse opened keeps it open, even after leaving.
  chip.click();
  chip.dispatchEvent(
    new PointerEvent("pointerout", {
      bubbles: true,
      pointerType: "mouse",
      relatedTarget: document.body,
    }),
  );
  await clock.advance(400);
  await expect(true, "a click after hovering closed the board");
}

async function run() {
  const boards = () => document.querySelectorAll<HTMLElement>(".town-board");
  await checkPopover();
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
  if (!sign!.querySelector('button[data-aged="true"]'))
    failures.push("the second sign shows no aged reading");
  if (!sign!.querySelector(".town-fuel-age")?.textContent?.startsWith("as of "))
    failures.push("the aged reading does not read as of its time");
  if (
    sign!.querySelector(".town-fuel-missing")?.textContent !== "— not reported"
  )
    failures.push("the second sign shows no unreported window");
  if (
    ![...sign!.querySelectorAll(".town-fuel-unavailable")].some(
      (row) => row.textContent === "no reading yet",
    )
  )
    failures.push("the second sign does not name Codex with no reading");
  // A gauge with three rows keeps every row beside its name.
  const name = sign!.querySelector(".town-fuel-name")!.getBoundingClientRect();
  for (const row of sign!
    .querySelector(".town-fuel-gauge")!
    .querySelectorAll(".town-fuel-window"))
    if (row.getBoundingClientRect().left < name.right)
      failures.push(`fuel row "${row.textContent}" sits under its name`);
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
