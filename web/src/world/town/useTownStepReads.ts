/**
 * Reads the steps Town's thought bubbles show, for the agents Town wants
 * (TownStepStore.want): working agents in rooms on screen at the room or desk
 * level. Nothing is polled. Each wanted agent's pane is watched as Chat
 * watches it (conversationWatch.ts); the service says when its conversation
 * changed (a transcript write, a status or title change), and Town reads the
 * conversation summary Chat's Now bar reads (`agent_conversation.latest`):
 * one call at a time per connection, of at most TOWN_STEP_BATCH agents, so
 * a crowded screen is read in turns rather than all at once.
 */

import { useEffect, useRef } from "react";
import { bridge, type ConnectionClient } from "../../api";
import { watchConversation } from "../../conversationWatch";
import { deskClient } from "../handoffs";
import type { WorldLeafObject } from "../worldObject";
import { townScaleSceneConnection, townScaleStep } from "./townScaleScene";
import {
  townStepOf,
  type TownStep,
  type TownStepConversation,
} from "./townSteps";
import type { TownStepStore } from "./townStepStore";

/** Changes within this window share one read. */
const BATCH_MS = 200;

/** The most agents one read asks a connection about. */
export const TOWN_STEP_BATCH = 32;

const leafClient = (leaf: WorldLeafObject): ConnectionClient | null =>
  deskClient(
    (candidate: WorldLeafObject) =>
      bridge.connection(candidate.connectionId, candidate.generation),
    leaf,
  );

type Reply = TownStepConversation & {
  pane_id?: string;
  session_binding?: string | null;
};

/**
 * The reads behind Town's bubbles, without React. `leafOf` finds an agent's
 * World leaf by its Town key (its leaf ID); `sceneStep` gives the scale
 * scene's synthetic steps instead of reads.
 */
export class TownStepReads {
  private readonly watches = new Map<string, () => void>();
  private readonly steps = new Map<string, TownStep>();
  private readonly pending = new Set<string>();
  /** Connections (by ID and generation) with a read in flight. */
  private readonly reading = new Set<string>();
  /** Each agent's newest read; an older reply for it is dropped. */
  private readonly issued = new Map<string, number>();
  private serial = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private readonly store: TownStepStore,
    private readonly leafOf: (key: string) => WorldLeafObject | undefined,
    private readonly options: {
      clientFor?: (leaf: WorldLeafObject) => ConnectionClient | null;
      watch?: typeof watchConversation;
      sceneStep?: (leaf: WorldLeafObject) => TownStep | null;
      batchMs?: number;
    } = {},
  ) {}

  /** Follow the store's wanted agents: watch new ones, drop the rest. */
  sync() {
    if (this.disposed) return;
    const wanted = new Set(this.store.wantedKeys());
    for (const [key, stop] of this.watches)
      if (!wanted.has(key)) {
        stop();
        this.watches.delete(key);
        this.steps.delete(key);
        this.issued.delete(key);
      }
    for (const key of [...this.steps.keys()])
      if (!wanted.has(key)) this.steps.delete(key);
    for (const key of wanted) {
      if (this.watches.has(key)) continue;
      const leaf = this.leafOf(key);
      if (!leaf) continue;
      const scene = this.options.sceneStep;
      if (scene) {
        const step = scene(leaf);
        if (step) this.steps.set(key, step);
        continue;
      }
      const client = (this.options.clientFor ?? leafClient)(leaf);
      if (!client) continue;
      const watch = this.options.watch ?? watchConversation;
      this.watches.set(
        key,
        watch(client, leaf.pane.pane_id, () => this.queue(key)),
      );
      this.queue(key);
    }
    this.publish();
  }

  private publish() {
    this.store.set(new Map(this.steps));
  }

  private queue(key: string) {
    if (this.disposed) return;
    this.pending.add(key);
    this.schedule();
  }

  private schedule() {
    if (this.disposed || !this.pending.size) return;
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.options.batchMs ?? BATCH_MS);
  }

  /**
   * Start a read on each idle connection for up to TOWN_STEP_BATCH of its
   * pending agents. The rest wait: a read's end schedules the next.
   */
  private flush() {
    const groups = new Map<
      string,
      {
        client: ConnectionClient;
        group: { leaf: WorldLeafObject; key: string }[];
      }
    >();
    for (const key of [...this.pending]) {
      const leaf = this.watches.has(key) ? this.leafOf(key) : undefined;
      if (!leaf) {
        this.pending.delete(key);
        continue;
      }
      // A connection's client is a fresh object on each lookup: its ID and
      // generation name it.
      const scope = `${leaf.connectionId}\0${leaf.generation}`;
      if (this.reading.has(scope)) continue;
      let entry = groups.get(scope);
      if (!entry) {
        const client = (this.options.clientFor ?? leafClient)(leaf);
        if (!client) {
          this.pending.delete(key);
          continue;
        }
        groups.set(scope, (entry = { client, group: [] }));
      }
      if (entry.group.length >= TOWN_STEP_BATCH) continue;
      this.pending.delete(key);
      entry.group.push({ leaf, key });
    }
    for (const [scope, { client, group }] of groups)
      void this.read(scope, client, group);
  }

  private async read(
    scope: string,
    client: ConnectionClient,
    group: { leaf: WorldLeafObject; key: string }[],
  ) {
    this.reading.add(scope);
    const serial = ++this.serial;
    for (const { key } of group) this.issued.set(key, serial);
    try {
      const reply = (await client.call(
        "agent_conversation.latest",
        { pane_ids: group.map(({ leaf }) => leaf.pane.pane_id) },
        8_000,
      )) as { conversations?: Reply[] } | null;
      if (this.disposed || !client.isCurrent()) return;
      const byPane = new Map(
        (Array.isArray(reply?.conversations) ? reply.conversations : []).map(
          (conversation) => [conversation.pane_id, conversation],
        ),
      );
      for (const { leaf, key } of group) {
        // Only this agent's newest read sets its step.
        if (!this.watches.has(key) || this.issued.get(key) !== serial) continue;
        const conversation = byPane.get(leaf.pane.pane_id);
        // A session found only by guessing from the folder may be another
        // agent's: it shows no step.
        const step =
          conversation && conversation.session_binding !== "guessed"
            ? townStepOf(conversation, leaf.pane.agent)
            : null;
        if (step) this.steps.set(key, step);
        else this.steps.delete(key);
      }
      this.publish();
    } catch {
      // A failed read keeps the last steps; the next change reads again.
    } finally {
      this.reading.delete(scope);
      this.schedule();
    }
  }

  dispose() {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    for (const stop of this.watches.values()) stop();
    this.watches.clear();
    this.steps.clear();
    this.pending.clear();
    this.issued.clear();
    this.publish();
  }
}

/**
 * Keeps `store`'s steps for the agents Town wants, read from `leaves`. With
 * `scene` (the `?scene=town-scale` page), the scale scene's agents show
 * synthetic steps and nothing is read.
 */
export function useTownStepReads(
  store: TownStepStore,
  leaves: readonly WorldLeafObject[],
  scene: boolean,
) {
  // A Town agent's key is its leaf ID. The index is built on first use after
  // the World changes; the reads and their watches outlive such changes.
  const world = useRef({
    leaves,
    index: null as Map<string, WorldLeafObject> | null,
  });
  if (world.current.leaves !== leaves) world.current = { leaves, index: null };
  const reads = useRef<TownStepReads | null>(null);
  useEffect(() => {
    const leafOf = (key: string) =>
      (world.current.index ??= new Map(
        world.current.leaves.map((leaf) => [leaf.id, leaf]),
      )).get(key);
    const loadedAt = Date.now();
    const current = new TownStepReads(store, leafOf, {
      ...(scene
        ? {
            sceneStep: (leaf: WorldLeafObject) =>
              townScaleSceneConnection(leaf.connectionId)
                ? townScaleStep(leaf.pane.pane_id, loadedAt)
                : null,
          }
        : {}),
    });
    reads.current = current;
    current.sync();
    const stop = store.onWant(() => current.sync());
    return () => {
      stop();
      current.dispose();
      reads.current = null;
    };
  }, [store, scene]);
  // A wanted agent whose leaf only now arrived is watched once it does.
  useEffect(() => reads.current?.sync(), [leaves]);
}
