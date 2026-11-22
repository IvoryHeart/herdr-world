import { randomUUID } from "node:crypto";
import {
  type FocusEnded,
  type FocusSession,
  type FocusState,
  parseFocusMinutes,
  parseFocusState,
} from "../../../shared/focus";
import type { Clock, Scheduler } from "../service/ports";
import type { GuiSettingsStore } from "../config/gui-settings";

/** Where the session is kept: the service settings file's custom bag. */
export const FOCUS_SETTINGS_KEY = "world_focus_v1";

/** The persisted part; `now` is added on every read. */
type Saved = Omit<FocusState, "now">;

/**
 * The owner's focus session (world.focus.*), one per service, shared by every
 * browser. States: idle → focused (start) → idle with `last` set, by End now
 * ("ended") or its time ("expired"). Starting again while focused keeps the
 * start and sets a new end, so one recap covers the whole stretch.
 *
 * The session is saved before it is acknowledged or published, so a service
 * restart restores it: a session whose time passed while the service was down
 * ends as "expired" at its own end time. If saving fails the change is
 * refused and nothing changes; a failed expiry is retried, waiting up to a
 * minute between tries. Whether it is held is judged by the clock on
 * every call, so a late timer never lets a notification through after the
 * end time, or holds one before it.
 */
export function createFocusService(deps: {
  clock: Pick<Clock, "now">;
  scheduler: Scheduler;
  load(): Promise<unknown>;
  save(state: Saved): Promise<void>;
  publish(revision: number): void;
  log?(message: string): void;
  id?(): string;
}) {
  let saved: Saved = { revision: 0, session: null, last: null };
  let timer: { cancel(): void } | null = null;
  let stopped = false;
  let queue: Promise<unknown> = Promise.resolve();
  const newId = deps.id ?? (() => randomUUID());

  const state = (): FocusState => ({ ...saved, now: deps.clock.now() });

  /** The session if its time has not passed. */
  const live = (now = deps.clock.now()) =>
    saved.session &&
    (saved.session.ends_at === null || now < saved.session.ends_at)
      ? saved.session
      : null;

  /** Expiry saves that failed in a row; each retry waits longer, up to 1 min. */
  let failures = 0;

  function arm(wait?: number) {
    timer?.cancel();
    timer = null;
    const ends = saved.session?.ends_at;
    if (stopped || ends == null) return;
    // Re-arm at most a minute ahead: timers stop while the machine sleeps.
    const delay =
      wait ?? Math.min(60_000, Math.max(0, ends - deps.clock.now()));
    timer = deps.scheduler.schedule(() => {
      timer = null;
      void expire().then(
        () => {
          failures = 0;
        },
        (error) => {
          failures += 1;
          deps.log?.(`Focus could not end on time: ${String(error)}`);
          // A failed save changed nothing, so try again until it is kept;
          // a change made meanwhile has already armed its own timer.
          if (!timer) arm(Math.min(60_000, 1_000 * 2 ** (failures - 1)));
        },
      );
    }, delay);
  }

  /** One change at a time, saved before it applies. */
  function change(next: (current: Saved) => Saved | null) {
    const run = queue.then(async () => {
      if (stopped) throw new Error("World is stopping");
      const proposed = next(saved);
      if (!proposed) return state();
      const candidate = { ...proposed, revision: saved.revision + 1 };
      await deps.save(candidate);
      saved = candidate;
      arm();
      deps.publish(saved.revision);
      return state();
    });
    queue = run.catch(() => undefined);
    return run;
  }

  const ended = (
    session: FocusSession,
    at: number,
    reason: FocusEnded["reason"],
  ): FocusEnded => ({ ...session, ended_at: at, reason });

  /** A session whose time passed, ended as "expired" at its end time. */
  const settle = (current: Saved, now: number): Saved => {
    const session = current.session;
    if (!session || session.ends_at === null || now < session.ends_at)
      return current;
    return {
      ...current,
      session: null,
      last: ended(session, session.ends_at, "expired"),
    };
  };

  function expire() {
    return change((current) => {
      const next = settle(current, deps.clock.now());
      if (next === current) {
        arm();
        return null;
      }
      return next;
    });
  }

  return {
    /** Restore the saved session; one that ran out while down ends now. */
    async start() {
      const restored = parseFocusState(await deps.load().catch(() => null));
      if (restored)
        saved = {
          revision: restored.revision,
          session: restored.session,
          last: restored.last,
        };
      arm();
      if (saved.session && !live()) await expire().catch(() => undefined);
    },
    get: state,
    /** True while notifications are held. */
    held: () => Boolean(live()),
    begin(minutes: unknown) {
      const length = parseFocusMinutes(minutes);
      return change((current) => {
        const now = deps.clock.now();
        const settled = settle(current, now);
        const session = settled.session;
        return {
          ...settled,
          session: {
            id: session?.id ?? newId(),
            started_at: session?.started_at ?? now,
            ends_at: length === null ? null : now + length * 60_000,
          },
        };
      });
    },
    end() {
      return change((current) => {
        const now = deps.clock.now();
        const settled = settle(current, now);
        if (!settled.session) return settled === current ? null : settled;
        return {
          ...settled,
          session: null,
          last: ended(settled.session, now, "ended"),
        };
      });
    },
    stop() {
      stopped = true;
      timer?.cancel();
      timer = null;
    },
  };
}

export type FocusService = ReturnType<typeof createFocusService>;

/**
 * The service's focus session, kept in the settings file and started; its
 * changes are published through `publish` once browsers can listen.
 */
export async function startSettingsFocus(deps: {
  clock: Pick<Clock, "now">;
  scheduler: Scheduler;
  settings: Pick<GuiSettingsStore, "read" | "update">;
  publish(revision: number): void;
  log(message: string): void;
}) {
  const { settings, ...rest } = deps;
  const focus = createFocusService({
    ...rest,
    load: async () => (await settings.read()).custom[FOCUS_SETTINGS_KEY],
    save: async (state) => {
      await settings.update((current) => ({
        ...current,
        custom: { ...current.custom, [FOCUS_SETTINGS_KEY]: state },
      }));
    },
  });
  await focus.start();
  return focus;
}
