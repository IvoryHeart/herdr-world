/**
 * Town lenses: map overlays that colour every room and desk by one fact,
 * as strategy games do. A lens only changes how Town is drawn; it reads what
 * World already has (agent activity, today's usage, linked pull requests,
 * quests and harnesses) and never moves an agent or changes state.
 *
 * Pure: `lensView` turns a lens and its facts into a mark per room, desk
 * and agent, each with a legend swatch and its value in words. A missing
 * number is never drawn as zero: it is "no data", with its own look.
 *
 * Town and Board read the same marks: a room is a Herdr workspace (Board's
 * workspace card), a desk a tab (Board's tab card) and an agent its pane.
 * `townLensView` reads Town's presented places; Board builds its own
 * (board/boardLens.ts) with the same keys, so one fact reads the same.
 */

import type { WorkItem } from "../../../../shared/worldSources";
import { formatOfficeCost, formatOfficeUsage } from "../officeObservability";
import type {
  OfficeAgent,
  OfficeDesk,
  OfficeRoom,
} from "../officeProjectionTypes";
import type { TownModel } from "./townModel";
import type { TownPlaceEconomy, TownUsagePlace } from "./townPlaceUsage";
import type { TownQuestMark } from "./townQuestPennant";

/** The lenses, in the order ‹ › and `L` step through them. */
export const TOWN_LENSES = [
  "attention",
  "idle",
  "spend",
  "pulls",
  "quests",
  "harness",
] as const;
export type TownLensId = (typeof TOWN_LENSES)[number];

export const TOWN_LENS_NAMES: Record<TownLensId, string> = {
  attention: "Attention",
  idle: "Idle time",
  spend: "Spend",
  pulls: "Pull requests",
  quests: "Quests",
  harness: "Harness",
};

/** What each lens shows, for the chooser and screen readers. */
export const TOWN_LENS_HINTS: Record<TownLensId, string> = {
  attention: "Town as usual: who needs you, who works.",
  idle: "How long since each agent last worked.",
  spend: "Today's usage per room and desk.",
  pulls: "Each desk's linked pull request.",
  quests: "Each agent's quest progress.",
  harness: "Which harness each agent runs.",
};

/** The next lens after `lens`, `step` places on, wrapping. */
export function townLensStep(lens: TownLensId, step: 1 | -1): TownLensId {
  const at = TOWN_LENSES.indexOf(lens);
  const count = TOWN_LENSES.length;
  return TOWN_LENSES[(at + step + count) % count]!;
}

/** An agent as a lens reads it: its key is its World leaf ID. */
export type LensAgent = Pick<
  OfficeAgent,
  "key" | "nodeId" | "roomKey" | "semanticStatus" | "stale" | "harness"
>;

/** A desk (a Herdr tab), keyed as Town keys it (officeDeskKey). */
export type LensDesk = Pick<
  OfficeDesk,
  "key" | "tabRef" | "occupantAgentKey"
> & {
  agents: readonly LensAgent[];
  /** Its panes, agents and plain shells. */
  panes: number;
};

/** A room (a Herdr workspace), keyed by its World space ID. */
export type LensRoom = Pick<OfficeRoom, "key" | "workspaceRef"> & {
  hostLabel: string;
  /** The desks the view shows. */
  desks: readonly LensDesk[];
  /** Every agent of the room, at a shown desk or not. */
  agents: readonly LensAgent[];
};

/** The places a view shows, which a lens reads. */
export type LensPlaces = { rooms: readonly LensRoom[] };

/** Whatever World knows that a lens may show. */
export type TownLensFacts = {
  /** Epoch ms, for ages. */
  now: number;
  /** When the agent last worked (epoch ms), when World knows. */
  activityAt(agent: LensAgent): number | undefined;
  /** Today's usage for a room (workspace) or desk (tab). */
  economy(place: TownUsagePlace): TownPlaceEconomy;
  /** The desk's linked work item, as its badge shows it. */
  work(desk: LensDesk): WorkItem | undefined;
  quest(agentKey: string): TownQuestMark | undefined;
};

/** One legend entry. Colours are Town's `--town-lens-*` tokens. */
export type TownLensSwatch = { label: string; color: string };

/**
 * A place's reading: a legend swatch, "no-data" (hatched, never zero), or
 * null for nothing to show (drawn neutral). `words` always says the value.
 */
export type TownLensMark = {
  swatch: number | "no-data" | null;
  words: string;
  /** Rooms: the reading in a few characters, for the room's label. */
  short?: string;
  /**
   * A place holding several categories (a room with Claude and Codex
   * agents): each swatch's share, most first, drawn as stripes so no place
   * reads as one category it is not. `swatch` is then null.
   */
  mix?: readonly { swatch: number; count: number }[];
};

export type TownLensView = {
  lens: Exclude<TownLensId, "attention">;
  /** Ordered low to high, or by category. */
  swatches: readonly TownLensSwatch[];
  /** Whether some place has no data (the legend then shows its look). */
  noData: boolean;
  /** A short line under the scale: what is measured, and what is missing. */
  note?: string;
  rooms: ReadonlyMap<string, TownLensMark>;
  desks: ReadonlyMap<string, TownLensMark>;
  /** Agent-scoped lenses only: each seated agent's own mark. */
  agents: ReadonlyMap<string, TownLensMark>;
};

const v = (name: string) => `var(--town-lens-${name})`;

/* ---------- Idle time ---------- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Idle bands: under 5 m is fresh; 8 h or more is cold. */
const IDLE_BANDS = [5 * MINUTE, 30 * MINUTE, 2 * HOUR, 8 * HOUR] as const;
const IDLE_SWATCHES: readonly TownLensSwatch[] = [
  { label: "< 5 m", color: v("warm-1") },
  { label: "5–30 m", color: v("warm-2") },
  { label: "30 m–2 h", color: v("cold-1") },
  { label: "2–8 h", color: v("cold-2") },
  { label: "8 h +", color: v("cold-3") },
];

/** "4 m", "3 h 12 m", "2 d 5 h": an idle span in words. */
export function townIdleWords(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return minutes % 60 ? `${hours} h ${minutes % 60} m` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

export function townIdleSwatch(ms: number): number {
  const band = IDLE_BANDS.findIndex((limit) => ms < limit);
  return band === -1 ? IDLE_BANDS.length : band;
}

/** An agent's idle time: 0 while it works; undefined when unknown. */
function idleOf(agent: LensAgent, facts: TownLensFacts): number | undefined {
  if (agent.semanticStatus === "working" && !agent.stale) return 0;
  const at = facts.activityAt(agent);
  return at === undefined ? undefined : Math.max(0, facts.now - at);
}

function idleMark(ms: number | undefined, working: boolean): TownLensMark {
  if (ms === undefined)
    return { swatch: "no-data", words: "Idle time unknown", short: "no data" };
  return {
    swatch: townIdleSwatch(ms),
    words: working ? "Working now" : `Idle ${townIdleWords(ms)}`,
  };
}

/**
 * A room's idle time: its coldest quarter's (the 75th percentile), so a
 * room where a few agents were forgotten stands out even while others work.
 */
export function townRoomIdle(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))]!;
}

/* ---------- Spend ---------- */

/** Spend bands, as a share of the costliest place of the same kind. */
const SPEND_BANDS = [0.1, 0.3, 0.6] as const;
const SPEND_SWATCHES: readonly TownLensSwatch[] = [
  { label: "None", color: v("none") },
  { label: "Low", color: v("heat-1") },
  { label: "Some", color: v("heat-2") },
  { label: "High", color: v("heat-3") },
  { label: "Top", color: v("heat-4") },
];

const ECONOMY_MISSING: Record<
  Exclude<TownPlaceEconomy["status"], "ready" | "none">,
  string
> = {
  loading: "Reading today's usage…",
  unavailable: "Usage unavailable",
  stale: "Usage out of date",
  "no-data": "No usage data from this host",
};

/** A ready place's spend in words: "~$1.40 today · 210.0k tokens". */
export function townSpendWords(
  economy: Extract<TownPlaceEconomy, { status: "ready" }>,
) {
  const tokens = `${formatOfficeUsage(economy.tokens)} tokens`;
  const text =
    economy.price === "priced" && economy.costUsd !== null
      ? `${formatOfficeCost(economy.costUsd, "estimated")} today · ${tokens}`
      : `${tokens} today, not priced`;
  return economy.partial ? `${text} · partial` : text;
}

/**
 * The unit every spend colour uses: estimated cost when every place with
 * usage, of every kind, is priced, else tokens. Rooms and desks share one
 * unit so the one legend is true at every zoom.
 */
export function townSpendUnit(
  ...kinds: readonly ReadonlyMap<string, TownPlaceEconomy>[]
): "cost" | "tokens" {
  return kinds.every((economies) =>
    [...economies.values()].every(
      (economy) =>
        economy.status !== "ready" ||
        (economy.price === "priced" && economy.costUsd !== null),
    ),
  )
    ? "cost"
    : "tokens";
}

/**
 * Marks for places of one kind, scaled against the costliest of them in
 * `by` (by default, their own common unit, see townSpendUnit).
 * Recorded zero usage is "None"; a missing reading is no data, never zero.
 */
export function townSpendMarks(
  economies: ReadonlyMap<string, TownPlaceEconomy>,
  by: "cost" | "tokens" = townSpendUnit(economies),
): { marks: Map<string, TownLensMark>; by: "cost" | "tokens" } {
  const ready = [...economies.values()].filter(
    (economy) => economy.status === "ready",
  );
  const amount = (economy: Extract<TownPlaceEconomy, { status: "ready" }>) =>
    by === "cost" ? (economy.costUsd ?? 0) : economy.tokens;
  const top = Math.max(0, ...ready.map(amount));
  const marks = new Map<string, TownLensMark>();
  for (const [key, economy] of economies) {
    if (economy.status === "ready") {
      const value = amount(economy);
      const share = top > 0 ? value / top : 0;
      const band = SPEND_BANDS.findIndex((limit) => share < limit);
      marks.set(key, {
        swatch:
          value <= 0 ? 0 : band === -1 ? SPEND_BANDS.length + 1 : band + 1,
        words: townSpendWords(economy),
        short:
          economy.price === "priced" && economy.costUsd !== null
            ? formatOfficeCost(economy.costUsd, "estimated")
            : formatOfficeUsage(economy.tokens),
      });
    } else if (economy.status === "none")
      marks.set(key, { swatch: 0, words: "No usage today", short: "0" });
    else
      marks.set(key, {
        swatch: "no-data",
        words: ECONOMY_MISSING[economy.status],
        short: "no data",
      });
  }
  return { marks, by };
}

/* ---------- Pull requests ---------- */

export type TownPullState =
  | "failing"
  | "ready"
  | "waiting"
  | "draft"
  | "merged";
const PULL_STATES: readonly TownPullState[] = [
  "failing",
  "ready",
  "waiting",
  "draft",
  "merged",
];
const PULL_SWATCHES: readonly TownLensSwatch[] = [
  { label: "Failing", color: v("fail") },
  { label: "Ready", color: v("ready") },
  { label: "Waiting", color: v("wait") },
  { label: "Draft", color: v("draft") },
  { label: "Merged", color: v("merged") },
];

/** A linked pull request's state, as Board's lanes read it; null for tickets. */
export function townPullState(item: WorkItem): {
  state: TownPullState;
  words: string;
} | null {
  if (item.kind !== "pull_request") return null;
  const ref = `#${item.number ?? "?"}`;
  if (item.lane === "merged")
    return { state: "merged", words: `${ref} merged` };
  if (item.lane === "fixing")
    return {
      state: "failing",
      words: `${ref} ${
        item.checks === "fail"
          ? "CI failing"
          : item.mergeable === "conflicting"
            ? "has conflicts"
            : "changes requested"
      }`,
    };
  if (item.draft) return { state: "draft", words: `${ref} draft` };
  if (item.lane === "ready")
    return { state: "ready", words: `${ref} ready to merge` };
  return {
    state: "waiting",
    words: `${ref} ${item.checks === "pending" ? "checks running" : "waiting for review"}`,
  };
}

/* ---------- Quests ---------- */

const QUEST_SWATCHES: readonly TownLensSwatch[] = [
  { label: "0–25%", color: v("grow-1") },
  { label: "25–50%", color: v("grow-2") },
  { label: "50–75%", color: v("grow-3") },
  { label: "75–99%", color: v("grow-4") },
  { label: "Done", color: v("grow-5") },
];

/** A quest's share done, 0–1: its steps, or 1 once it is done. */
export function townQuestShare(quest: TownQuestMark): number {
  if (quest.status === "done") return 1;
  return quest.total > 0 ? Math.min(1, quest.done / quest.total) : 0;
}

function questSwatch(share: number) {
  return share >= 1 ? 4 : Math.min(3, Math.floor(share * 4));
}

function questMark(quest: TownQuestMark): TownLensMark {
  const status =
    quest.status === "blocked"
      ? " · blocked"
      : quest.status === "paused"
        ? " · paused"
        : "";
  return {
    swatch: questSwatch(townQuestShare(quest)),
    words: `Quest ${quest.progress}: ${quest.title}${status}`,
  };
}

/* ---------- Harness ---------- */

export type TownHarness = "claude" | "codex" | "pi" | "other" | "shell";
const HARNESSES: readonly TownHarness[] = [
  "claude",
  "codex",
  "pi",
  "other",
  "shell",
];
const HARNESS_NAMES: Record<TownHarness, string> = {
  claude: "Claude",
  codex: "Codex",
  pi: "Pi",
  other: "Other agent",
  shell: "Plain shell",
};
const HARNESS_SWATCHES: readonly TownLensSwatch[] = HARNESSES.map(
  (harness) => ({ label: HARNESS_NAMES[harness], color: v(`h-${harness}`) }),
);

export function townHarnessOf(agent: Pick<OfficeAgent, "harness">) {
  const name = agent.harness?.toLowerCase() ?? "";
  return name === "claude" || name === "codex" || name === "pi"
    ? name
    : "other";
}

/** Counts in words, most first: "8 Claude · 3 Codex". */
function tally<T extends string>(
  values: readonly T[],
  order: readonly T[],
  name: (value: T) => string,
) {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const ranked = [...counts].sort(
    ([a, left], [b, right]) =>
      right - left || order.indexOf(a) - order.indexOf(b),
  );
  return {
    ranked,
    words: ranked
      .map(([value, count]) => `${count} ${name(value)}`)
      .join(" · "),
  };
}

/* ---------- The view ---------- */

/** Town's presented rooms and desks, and every agent of those rooms. */
export function townLensPlaces(model: TownModel): LensPlaces {
  const roomAgents = new Map<string, OfficeAgent[]>();
  for (const agent of model.agents.values()) {
    const list = roomAgents.get(agent.roomKey);
    if (list) list.push(agent);
    else roomAgents.set(agent.roomKey, [agent]);
  }
  return {
    rooms: [...model.rooms.values()].map((room) => ({
      key: room.key,
      workspaceRef: room.workspaceRef,
      hostLabel: model.hosts.get(room.hostKey)?.displayLabel ?? room.hostKey,
      agents: roomAgents.get(room.key) ?? [],
      desks: room.desks.flatMap((shown) => {
        const desk = model.desks.get(shown.key);
        if (!desk) return [];
        return [
          {
            key: desk.key,
            tabRef: desk.tabRef,
            occupantAgentKey: desk.occupantAgentKey,
            panes: desk.paneDevices.length,
            agents: desk.paneDevices.flatMap((device) => {
              const agent = device.agentKey
                ? model.agents.get(device.agentKey)
                : undefined;
              return agent ? [agent] : [];
            }),
          },
        ];
      }),
    })),
  };
}

const plural = (count: number, one: string) =>
  `${count} ${one}${count === 1 ? "" : "s"}`;

/** The marks for one lens over Town's presented rooms, desks and agents. */
export function townLensView(
  lens: TownLensId,
  model: TownModel,
  facts: TownLensFacts,
): TownLensView | null {
  return lens === "attention"
    ? null
    : lensView(lens, townLensPlaces(model), facts);
}

/** The marks for one lens over a view's rooms, desks and agents. */
export function lensView(
  lens: TownLensId,
  places: LensPlaces,
  facts: TownLensFacts,
): TownLensView | null {
  if (lens === "attention") return null;
  const { rooms } = places;
  const roomAgents = new Map(rooms.map((room) => [room.key, room.agents]));
  const deskAgents = new Map(
    rooms.flatMap((room) => room.desks.map((desk) => [desk.key, desk.agents])),
  );
  const desks = new Map(
    rooms.flatMap((room) => room.desks.map((desk) => [desk.key, desk])),
  );
  const roomMarks = new Map<string, TownLensMark>();
  const deskMarks = new Map<string, TownLensMark>();
  const agentMarks = new Map<string, TownLensMark>();
  const desksOf = (room: LensRoom) => room.desks;
  const view = (
    swatches: readonly TownLensSwatch[],
    note?: string,
  ): TownLensView => {
    const noData = [roomMarks, deskMarks, agentMarks].some((marks) =>
      [...marks.values()].some((mark) => mark.swatch === "no-data"),
    );
    return {
      lens,
      swatches,
      noData,
      ...(note ? { note } : {}),
      rooms: roomMarks,
      desks: deskMarks,
      agents: agentMarks,
    };
  };

  switch (lens) {
    case "idle": {
      const idle = new Map<string, number | undefined>();
      for (const agents of roomAgents.values())
        for (const agent of agents) {
          const ms = idleOf(agent, facts);
          idle.set(agent.key, ms);
          agentMarks.set(
            agent.key,
            idleMark(ms, ms === 0 && agent.semanticStatus === "working"),
          );
        }
      for (const [deskKey, agents] of deskAgents) {
        if (!agents.length) continue;
        const known = agents.flatMap((agent) => {
          const ms = idle.get(agent.key);
          return ms === undefined ? [] : [ms];
        });
        if (!known.length) {
          deskMarks.set(deskKey, idleMark(undefined, false));
          continue;
        }
        // A desk is as fresh as its freshest agent.
        const freshest = Math.min(...known);
        const mark =
          agents.length === 1
            ? agentMarks.get(agents[0]!.key)!
            : {
                swatch: townIdleSwatch(freshest),
                words: `Freshest ${freshest === 0 ? "working now" : `idle ${townIdleWords(freshest)}`} · ${plural(agents.length, "agent")}`,
              };
        deskMarks.set(deskKey, mark);
      }
      for (const room of rooms) {
        const agents = roomAgents.get(room.key) ?? [];
        if (!agents.length) continue;
        const known = agents.flatMap((agent) => {
          const ms = idle.get(agent.key);
          return ms === undefined ? [] : [ms];
        });
        if (!known.length) {
          roomMarks.set(room.key, idleMark(undefined, false));
          continue;
        }
        const cold = townRoomIdle(known);
        roomMarks.set(room.key, {
          swatch: townIdleSwatch(cold),
          short: cold < MINUTE ? "now" : townIdleWords(cold),
          words: `A quarter of ${plural(known.length, "agent")} idle ${townIdleWords(cold)} or more${
            known.length < agents.length
              ? ` (${agents.length - known.length} unknown)`
              : ""
          }`,
        });
      }
      return view(
        IDLE_SWATCHES,
        "Since each agent last worked; a room shows its coldest quarter.",
      );
    }
    case "spend": {
      const roomEconomies = new Map<string, TownPlaceEconomy>();
      const deskEconomies = new Map<string, TownPlaceEconomy>();
      for (const room of rooms) {
        roomEconomies.set(
          room.key,
          facts.economy({ kind: "room", target: room.workspaceRef }),
        );
        for (const desk of desksOf(room))
          deskEconomies.set(
            desk.key,
            facts.economy({ kind: "desk", target: desk.tabRef }),
          );
      }
      // One unit for rooms and desks: a desk folded out of view can hold
      // the room's only unpriced usage, and the legend names one scale.
      const by = townSpendUnit(roomEconomies, deskEconomies);
      const roomSpend = townSpendMarks(roomEconomies, by);
      const deskSpend = townSpendMarks(deskEconomies, by);
      for (const [key, mark] of roomSpend.marks) roomMarks.set(key, mark);
      for (const [key, mark] of deskSpend.marks) deskMarks.set(key, mark);
      const missing = new Set<string>();
      for (const room of rooms)
        if (roomSpend.marks.get(room.key)?.swatch === "no-data")
          missing.add(room.hostLabel);
      const scale =
        by === "cost"
          ? "Today's estimated cost, against the costliest place."
          : "Today's tokens, against the busiest place.";
      return view(
        SPEND_SWATCHES,
        missing.size ? `${scale} No data: ${[...missing].join(", ")}.` : scale,
      );
    }
    case "pulls": {
      for (const room of rooms) {
        const states: TownPullState[] = [];
        for (const desk of desksOf(room)) {
          const item = facts.work(desk);
          const pull = item ? townPullState(item) : null;
          if (!pull) continue;
          states.push(pull.state);
          deskMarks.set(desk.key, {
            swatch: PULL_STATES.indexOf(pull.state),
            words: pull.words,
          });
        }
        if (!states.length) continue;
        // A room shows its most urgent pull request: failing first.
        const worst = PULL_STATES.find((state) => states.includes(state))!;
        roomMarks.set(room.key, {
          swatch: PULL_STATES.indexOf(worst),
          short: `${states.filter((state) => state === worst).length} ${PULL_SWATCHES[PULL_STATES.indexOf(worst)]!.label.toLowerCase()}`,
          words: tally(states, PULL_STATES, (state) =>
            PULL_SWATCHES[PULL_STATES.indexOf(state)]!.label.toLowerCase(),
          ).words,
        });
      }
      return view(
        PULL_SWATCHES,
        "Desks without a linked pull request stay plain.",
      );
    }
    case "quests": {
      // Every agent gets its own mark, so one without a quest never reads
      // as its desk, which may show a teammate's quest.
      for (const agents of roomAgents.values())
        for (const agent of agents) {
          const quest = facts.quest(agent.key);
          agentMarks.set(
            agent.key,
            quest ? questMark(quest) : { swatch: null, words: "No quest" },
          );
        }
      const shares = (agents: readonly LensAgent[]) =>
        agents.flatMap((agent) => {
          const quest = facts.quest(agent.key);
          return quest ? [townQuestShare(quest)] : [];
        });
      for (const [deskKey, agents] of deskAgents) {
        const known = shares(agents);
        if (!known.length) continue;
        deskMarks.set(
          deskKey,
          agents.length === 1 || known.length === 1
            ? agentMarks.get(
                agents.find((agent) => facts.quest(agent.key))!.key,
              )!
            : {
                swatch: questSwatch(Math.min(...known)),
                words: `${plural(known.length, "quest")}, least done ${Math.round(Math.min(...known) * 100)}%`,
              },
        );
      }
      for (const room of rooms) {
        const known = shares(roomAgents.get(room.key) ?? []);
        if (!known.length) continue;
        // Summed in one order, so every view of the room rounds alike.
        const mean =
          [...known]
            .sort((a, b) => a - b)
            .reduce((sum, share) => sum + share, 0) / known.length;
        roomMarks.set(room.key, {
          swatch: questSwatch(mean),
          short: `${Math.round(mean * 100)}%`,
          words: `${plural(known.length, "quest")}, ${Math.round(mean * 100)}% done on average`,
        });
      }
      return view(QUEST_SWATCHES, "Agents without a quest stay plain.");
    }
    case "harness": {
      for (const agents of roomAgents.values())
        for (const agent of agents) {
          const harness = townHarnessOf(agent);
          agentMarks.set(agent.key, {
            swatch: HARNESSES.indexOf(harness),
            words: HARNESS_NAMES[harness],
          });
        }
      // A room or desk can hold several harnesses: one harness gets its
      // colour; several get a stripe each, by share, never the majority's.
      const mixed = (harnesses: TownHarness[]): TownLensMark => {
        const { ranked, words } = tally(
          harnesses,
          HARNESSES,
          (h) => HARNESS_NAMES[h],
        );
        if (ranked.length === 1)
          return {
            swatch: HARNESSES.indexOf(ranked[0]![0]),
            words,
            short: HARNESS_NAMES[ranked[0]![0]],
          };
        return {
          swatch: null,
          words,
          short:
            ranked.length === 2
              ? ranked.map(([h]) => HARNESS_NAMES[h]).join(" + ")
              : `${ranked.length} harnesses`,
          mix: ranked.map(([h, count]) => ({
            swatch: HARNESSES.indexOf(h),
            count,
          })),
        };
      };
      for (const [deskKey, agents] of deskAgents) {
        if (!agents.length) {
          if (desks.get(deskKey)?.panes)
            deskMarks.set(deskKey, {
              swatch: HARNESSES.indexOf("shell"),
              words: HARNESS_NAMES.shell,
            });
          continue;
        }
        deskMarks.set(deskKey, mixed(agents.map(townHarnessOf)));
      }
      for (const room of rooms) {
        const agents = roomAgents.get(room.key) ?? [];
        if (agents.length)
          roomMarks.set(room.key, mixed(agents.map(townHarnessOf)));
        else if (desksOf(room).some((desk) => desk.panes))
          roomMarks.set(room.key, {
            swatch: HARNESSES.indexOf("shell"),
            words: "Plain shells only",
            short: "Shells",
          });
      }
      return view(
        HARNESS_SWATCHES,
        "A room or desk with several harnesses is striped by each one's share.",
      );
    }
  }
}

/** A place's lens reading in words, for its accessible name and the legend. */
export function townLensWords(
  view: TownLensView | null,
  kind: "room" | "desk" | "agent" | "pane",
  key: string,
): string | undefined {
  if (!view) return undefined;
  const marks =
    kind === "room"
      ? view.rooms
      : kind === "desk"
        ? view.desks
        : kind === "agent"
          ? view.agents
          : null;
  return marks?.get(key)?.words;
}
