/**
 * Town's group selection state and its orders (#820), shared through
 * context by the canvas (rings, the Shift box, Show them), the board sign's
 * command card, the peek's and table card's Select, and the accessible
 * agent targets. See townGroup.ts for the rules.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import type { OfficeAgent } from "../officeProjectionTypes";
import type { WorldLeafObject, WorldObject } from "../worldObject";
import { isMobileLayout } from "../../layoutPreferences";
import { useSystemBack } from "../../systemBack";
import { townLeaf, townOwner } from "./townChat";
import { townScaleSceneConnection } from "./townScaleScene";
import {
  townGroupAdd,
  townGroupCounts,
  townGroupOrders,
  townGroupPrune,
  townGroupState,
  townGroupToggle,
  townMessageLeftOut,
  type TownGroupMember,
  type TownReviewOutcome,
  type TownSendOutcome,
} from "./townGroup";
import { townReviewAll, townSendAll, townSendOne } from "./townGroupSend";

const NONE: ReadonlySet<string> = new Set();

/** One agent's line in an order's results, kept while the selection lasts. */
export type TownGroupResult<T> = { key: string; label: string; outcome: T };

export type TownGroup = ReturnType<typeof useTownGroup>;

export const TownGroupContext = createContext<TownGroup | null>(null);

/** The group selection, or null outside Town. */
export const useTownGroupContext = () => useContext(TownGroupContext);

/**
 * Only the chosen keys and a stable toggle, for the map's memoized layers
 * (room cards, reception portraits, accessible targets): it changes only
 * when the selection does, never on Town's other renders.
 */
export type TownGroupKeys = {
  keys: ReadonlySet<string>;
  toggle(keys: readonly string[]): void;
};

const TownGroupKeysContext = createContext<TownGroupKeys | null>(null);

export const useTownGroupKeys = () => useContext(TownGroupKeysContext);

export function TownGroupProvider({
  group,
  children,
}: {
  group: TownGroup;
  children: ReactNode;
}) {
  return (
    <TownGroupContext.Provider value={group}>
      <TownGroupKeysContext.Provider value={group.selection}>
        {children}
      </TownGroupKeysContext.Provider>
    </TownGroupContext.Provider>
  );
}

export function useTownGroup({
  office,
  world,
  finishedKeys,
  mark,
}: {
  office: HerdrOfficeProjection;
  world: WorldObject;
  /** Agents with finished work waiting for review (Town's finished calls). */
  finishedKeys: ReadonlySet<string>;
  /** The existing Mark reviewed rule for one agent. */
  mark: (leaf: WorldLeafObject) => Promise<boolean>;
}) {
  const [keys, setKeys] = useState<ReadonlySet<string>>(NONE);
  const [review, setReview] = useState<
    readonly TownGroupResult<TownReviewOutcome>[] | null
  >(null);
  const [sent, setSent] = useState<
    readonly TownGroupResult<TownSendOutcome>[] | null
  >(null);
  const [composing, setComposing] = useState(false);
  const agents = useMemo(
    () => new Map(office.roster.map(({ agent }) => [agent.key, agent])),
    [office.roster],
  );
  // A closed agent leaves the selection (the canvas prunes binned ones).
  useEffect(() => {
    setKeys((current) => townGroupPrune(current, (key) => agents.has(key)));
  }, [agents]);
  const members = useMemo(
    (): TownGroupMember[] =>
      [...keys].flatMap((key) => {
        const agent = agents.get(key);
        if (!agent) return [];
        return [
          {
            key,
            label: agent.displayLabel,
            state: townGroupState(agent, finishedKeys.has(key)),
            leftOut: townMessageLeftOut(agent, townLeaf(world, agent.nodeId)),
          },
        ];
      }),
    [keys, agents, finishedKeys, world],
  );
  const toggle = useCallback(
    (add: readonly string[]) =>
      setKeys((current) => townGroupToggle(current, add)),
    [],
  );
  const selection = useMemo(() => ({ keys, toggle }), [keys, toggle]);
  const clear = useCallback(() => {
    setKeys(NONE);
    setReview(null);
    setSent(null);
    setComposing(false);
  }, []);
  const open = keys.size > 0;
  // The phone's Back ends selection; Escape does too, after anything that
  // takes it first (a carry, a peek, a menu).
  useSystemBack(open, clear, "panel");
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) clear();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open, clear]);
  // A tap toggles only for touch (or the phone layout): a mouse click still
  // opens the agent, and Shift+click is the desktop toggle.
  const pointer = useRef("mouse");
  useEffect(() => {
    const down = (event: PointerEvent) => {
      pointer.current = event.pointerType;
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, []);
  const framer = useRef<((keys: readonly string[]) => void) | null>(null);
  const leafOf = (agent: OfficeAgent | undefined) =>
    agent ? townLeaf(world, agent.nodeId) : null;
  const orders = townGroupOrders(members);
  const latest = useRef({ agents, world, orders });
  latest.current = { agents, world, orders };
  const report =
    <T,>(
      set: (
        update: (
          rows: readonly TownGroupResult<T>[] | null,
        ) => readonly TownGroupResult<T>[] | null,
      ) => void,
    ) =>
    (key: string, outcome: T) =>
      set(
        (rows) =>
          rows?.map((row) => (row.key === key ? { ...row, outcome } : row)) ??
          rows,
      );
  return {
    keys,
    selection,
    open,
    members,
    counts: townGroupCounts(members.map((member) => member.state)),
    orders,
    composing,
    setComposing,
    review,
    sent,
    /** Scene agents' sends are synthetic: the card labels them test data. */
    testData: orders.message.some((member) => {
      const leaf = leafOf(agents.get(member.key));
      return !!leaf && townScaleSceneConnection(leaf.connectionId);
    }),
    framer,
    toggle,
    add: (add: Iterable<string>) =>
      setKeys((current) => townGroupAdd(current, add)),
    prune: (onMap: (key: string) => boolean) =>
      setKeys((current) => townGroupPrune(current, onMap)),
    clear,
    /** Whether a tap now toggles rather than opens. */
    tapToggles: () =>
      keys.size > 0 && (pointer.current !== "mouse" || isMobileLayout()),
    /** The agents at a table, for its card's Select and a tap on it. */
    deskAgents: (deskKey: string) =>
      office.paneRoster.flatMap(({ device }) =>
        device.deskKey === deskKey && device.agentKey ? [device.agentKey] : [],
      ),
    show: () => framer.current?.([...keys]),
    runReview: () => {
      const targets = latest.current.orders.review;
      setReview(
        targets.map(({ key, label }) => ({ key, label, outcome: "marking" })),
      );
      void townReviewAll(
        targets,
        async ({ key }) => {
          const leaf = leafOf(latest.current.agents.get(key));
          return leaf ? mark(leaf) : false;
        },
        report<TownReviewOutcome>(setReview),
      );
    },
    send: async (text: string) => {
      const body = text.trim();
      if (!body) throw new Error("Write a message first.");
      const targets = latest.current.orders.message;
      if (!targets.length) throw new Error("No selected agent can take it.");
      setSent(
        targets.map(({ key, label }) => ({
          key,
          label,
          outcome: { status: "sending" },
        })),
      );
      setComposing(false);
      await townSendAll(
        targets,
        ({ key }) => {
          const leaf = leafOf(latest.current.agents.get(key));
          return townSendOne(
            leaf ? townOwner(leaf) : null,
            leaf?.pane.pane_id ?? "",
            body,
          );
        },
        report<TownSendOutcome>(setSent),
      );
    },
  };
}
