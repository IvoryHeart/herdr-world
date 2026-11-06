import { useEffect, useSyncExternalStore } from "react";
import { bridge } from "../api";
import type { AsksClient, WorldAsk } from "./worldAsks";

export type AnswerDelivery = {
  state:
    | "pending"
    | "claimed"
    | "dispatching"
    | "delivered"
    | "uncertain"
    | "refused"
    | "cancelled";
  attempt: number;
  received_at?: number;
  reason?: string;
  prior_uncertainty?: boolean;
  attempts?: {
    attempt: number;
    state: string;
    reason: string;
    created_at: number;
    finished_at: number | null;
  }[];
};
export type AnswerNotice = {
  ask: WorldAsk;
  delivery: AnswerDelivery;
  can_resend: boolean;
};
export type AnswerDeliveryCounts = {
  checks: number;
  waiting: number;
  connections: Record<string, number>;
};
type Page = {
  counts?: AnswerDeliveryCounts;
  revision: number;
  incarnation: string;
  deliveries: AnswerNotice[];
  next: string | null;
};
export type AnswerNotices = {
  counts?: AnswerDeliveryCounts;
  entries: readonly AnswerNotice[];
  next: string | null;
  older: boolean;
  error: string | null;
  loading: boolean;
};
const EMPTY: AnswerNotices = {
  entries: [],
  next: null,
  older: false,
  error: null,
  loading: false,
};

/** A separate, memory-only query: delivery changes never invalidate Board or open question counts. */
export class WorldAnswerDeliveriesStore {
  private value = EMPTY;
  private listeners = new Set<() => void>();
  private unlisten: (() => void)[] = [];
  private users = 0;
  private request = 0;
  private revision = -1;
  private incarnation: string | null = null;
  private requestedResends = new Map<string, AnswerNotice>();
  private receipts = new Map<string, AnswerNotice>();
  constructor(private client: AsksClient) {}
  get = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(value: AnswerNotices) {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
  start() {
    if (++this.users !== 1) return;
    this.unlisten = [
      this.client.onControl((control) => {
        if (
          control.type === "world_ask_delivery_changed" &&
          (control.incarnation !== this.incarnation ||
            (control.revision ?? 0) > this.revision)
        )
          void this.refresh();
      }),
      this.client.onStatus((status) => {
        if (status === "disconnected") {
          this.requestedResends.clear();
          this.receipts.clear();
          this.request++;
          this.revision = -1;
          this.incarnation = null;
          this.publish(EMPTY);
        }
        if (status === "connected") void this.refresh();
      }),
    ];
    void this.refresh();
  }
  stop() {
    if (this.users === 0 || --this.users > 0) return;
    this.request++;
    this.requestedResends.clear();
    this.receipts.clear();
    for (const off of this.unlisten.splice(0)) off();
    this.publish(EMPTY);
    this.revision = -1;
    this.incarnation = null;
  }
  refresh = async (after?: string, preserveReceipts = false) => {
    if (!preserveReceipts || after) this.receipts.clear();
    const request = ++this.request;
    this.publish({ ...this.value, error: null, loading: true });
    try {
      const page = (await this.client.call(
        "world.ask.deliveries.get",
        after ? { after } : {},
      )) as Page;
      if (request !== this.request) return;
      if (
        after &&
        (page.incarnation !== this.incarnation ||
          page.revision !== this.revision)
      ) {
        await this.refresh();
        return;
      }
      for (const [id, previous] of this.requestedResends) {
        const current = page.deliveries.find((entry) => entry.ask.id === id);
        if (current) {
          if (["uncertain", "refused"].includes(current.delivery.state))
            this.requestedResends.delete(id);
          continue;
        }
        const settled = (await this.client.call("world.ask.delivery.get", {
          id,
          occurrence: previous.ask.answer?.occurrence,
        })) as AnswerNotice | null;
        if (request !== this.request) return;
        if (
          settled?.delivery?.state === "delivered" &&
          settled.ask.id === id &&
          settled.ask.answer?.occurrence === previous.ask.answer?.occurrence
        )
          this.receipts.set(id, { ...settled, can_resend: false });
        this.requestedResends.delete(id);
      }
      while (this.receipts.size > 5)
        this.receipts.delete(this.receipts.keys().next().value!);
      this.revision = page.revision;
      this.incarnation = page.incarnation;
      this.publish({
        counts: page.counts ?? {
          checks: page.deliveries.filter((entry) =>
            ["uncertain", "refused"].includes(entry.delivery.state),
          ).length,
          waiting: page.deliveries.filter((entry) =>
            ["pending", "claimed", "dispatching"].includes(
              entry.delivery.state,
            ),
          ).length,
          connections: Object.fromEntries(
            [
              ...new Set(
                page.deliveries
                  .map((entry) => entry.ask.actor.connection_id)
                  .filter((id): id is string => Boolean(id)),
              ),
            ].map((id) => [
              id,
              page.deliveries.filter(
                (entry) => entry.ask.actor.connection_id === id,
              ).length,
            ]),
          ),
        },
        entries: [
          ...this.receipts.values(),
          ...page.deliveries
            .slice(0, 60)
            .filter((entry) => !this.receipts.has(entry.ask.id)),
        ],
        next: page.next,
        older: Boolean(after),
        error: null,
        loading: false,
      });
    } catch (error) {
      if (request === this.request)
        this.publish({
          ...this.value,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  };
  older = () =>
    this.value.next ? this.refresh(this.value.next) : Promise.resolve();
  decide = async (notice: AnswerNotice, action: "resend" | "close") => {
    try {
      if (action === "resend") {
        this.requestedResends.set(notice.ask.id, notice);
        while (this.requestedResends.size > 60)
          this.requestedResends.delete(
            this.requestedResends.keys().next().value!,
          );
      }
      await this.client.call(`world.ask.delivery.${action}`, {
        id: notice.ask.id,
        occurrence: notice.ask.answer?.occurrence,
        attempt: notice.delivery.attempt,
        ...(action === "resend" ? { confirm_duplicate: true } : {}),
      });
      await this.refresh(undefined, true);
      return null;
    } catch (error) {
      this.requestedResends.delete(notice.ask.id);
      await this.refresh(undefined, true);
      return error instanceof Error ? error.message : String(error);
    }
  };
}
let shared: WorldAnswerDeliveriesStore | undefined;
export const sharedAnswerDeliveries = () =>
  (shared ??= new WorldAnswerDeliveriesStore(bridge));
export function useAnswerDeliveries(store = sharedAnswerDeliveries()) {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function useAnswerDeliveryCounts(store = sharedAnswerDeliveries()) {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const value = useSyncExternalStore(
    store.subscribe,
    () =>
      `${store.get().counts?.checks ?? 0}:${store.get().counts?.waiting ?? 0}`,
    () => "0:0",
  );
  const [checks, waiting] = value.split(":").map(Number);
  return { checks: checks!, waiting: waiting! };
}
export function useAnswerConnectionCount(
  connectionId: string,
  store = sharedAnswerDeliveries(),
) {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(
    store.subscribe,
    () => store.get().counts?.connections[connectionId] ?? 0,
    () => 0,
  );
}
