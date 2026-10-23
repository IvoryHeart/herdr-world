import { expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { startChimeHeartbeat } from "./chimeHost";
import { CHIME_DEVICE_CHANGED_EVENT } from "./chimeCenter";
import { CHIME_AUDIO_STATE_EVENT, installChimeUnlock } from "./player";

test.each(["playing", "muted"])(
  "first worker installation receives %s policy without reloading",
  async (mode) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
    const page = new EventTarget();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: page,
    });
    const container = Object.assign(new EventTarget(), {
      controller: null as ServiceWorker | null,
    });
    const listeners: Record<string, (event: any) => void> = {};
    const shown = mock(async () => {});
    const sent: { mode: string }[] = [];
    const worker = {
      postMessage: (data: { mode: string }) => {
        sent.push(data);
        listeners.message({ data, source: { id: "first-page" } });
      },
    } as unknown as ServiceWorker;
    const claim = mock(async () => {
      container.controller = worker;
      container.dispatchEvent(new Event("controllerchange"));
    });
    runInNewContext(
      await readFile(
        new URL("../../public/task-notifications-sw.js", import.meta.url),
        "utf8",
      ),
      {
        self: {
          addEventListener: (type: string, callback: (event: any) => void) => {
            listeners[type] = callback;
          },
          clients: { claim },
          registration: { showNotification: shown },
        },
      },
    );
    let on = mode === "playing";
    let ready = mode === "playing";
    const stop = startChimeHeartbeat(
      container,
      () => ({ on, volume: 0.5 }),
      () => ready,
    );
    const push = async () => {
      let pending: Promise<void> | undefined;
      listeners.push({
        data: { json: () => ({ title: "Review ready" }) },
        waitUntil: (value: Promise<void>) => {
          pending = value;
        },
      });
      await pending;
      return (shown.mock.calls.slice(-1)[0] as unknown[])[1];
    };
    try {
      expect(container.controller).toBeNull();
      expect(sent).toEqual([]);
      let activated: Promise<void> | undefined;
      listeners.activate({
        waitUntil: (value: Promise<void>) => {
          activated = value;
        },
      });
      await activated;
      expect(claim).toHaveBeenCalledTimes(1);
      expect(sent[sent.length - 1]?.mode).toBe(mode);
      expect(await push()).toMatchObject({ silent: true });
      on = true;
      ready = false;
      page.dispatchEvent(new Event("storage"));
      expect(sent[sent.length - 1]?.mode).toBe("fallback");
      expect(await push()).toMatchObject({ silent: false });
      ready = true;
      page.dispatchEvent(new Event(CHIME_AUDIO_STATE_EVENT));
      expect(await push()).toMatchObject({ silent: true });
      on = false;
      page.dispatchEvent(new Event(CHIME_DEVICE_CHANGED_EVENT));
      expect(sent[sent.length - 1]?.mode).toBe("muted");
      expect(await push()).toMatchObject({ silent: true });
    } finally {
      stop();
      const count = sent.length;
      page.dispatchEvent(new Event("storage"));
      container.dispatchEvent(new Event("controllerchange"));
      expect(sent).toHaveLength(count);
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    }
  },
);

test("audio unlock and suspension immediately refresh the worker policy", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  class FakeAudioContext extends EventTarget {
    state = "running";
    async resume() {
      this.state = "running";
      this.dispatchEvent(new Event("statechange"));
    }
  }
  const audio = new FakeAudioContext();
  const page = Object.assign(new EventTarget(), {
    AudioContext: class {
      constructor() {
        return audio;
      }
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: page,
  });
  const policies: string[] = [];
  const container = Object.assign(new EventTarget(), {
    controller: {
      postMessage: (data: { mode: string }) => policies.push(data.mode),
    } as unknown as ServiceWorker,
  });
  const stop = startChimeHeartbeat(container, () => ({
    on: true,
    volume: 0.5,
  }));
  try {
    expect(policies[policies.length - 1]).toBe("fallback");
    installChimeUnlock();
    page.dispatchEvent(new Event("pointerdown"));
    expect(policies[policies.length - 1]).toBe("playing");
    audio.state = "suspended";
    audio.dispatchEvent(new Event("statechange"));
    expect(policies[policies.length - 1]).toBe("fallback");
  } finally {
    if (audio) {
      audio.state = "suspended";
      audio.dispatchEvent(new Event("statechange"));
    }
    stop();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a paused or disconnected page leaves the push its sound", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: new EventTarget(),
  });
  const policies: string[] = [];
  const container = Object.assign(new EventTarget(), {
    controller: {
      postMessage: (data: { mode: string }) => policies.push(data.mode),
    } as unknown as ServiceWorker,
  });
  let listening = true;
  const changed = new Set<() => void>();
  const notify = () => {
    for (const listener of changed) listener();
  };
  const stop = startChimeHeartbeat(
    container,
    () => ({ on: true, volume: 0.5 }),
    () => true,
    {
      now: () => listening,
      subscribe: (listener) => {
        changed.add(listener);
        return () => changed.delete(listener);
      },
    },
  );
  try {
    expect(policies).toEqual(["playing"]);
    // Unrelated store changes don't beat.
    notify();
    expect(policies).toEqual(["playing"]);
    listening = false;
    notify();
    expect(policies).toEqual(["playing", "fallback"]);
    listening = true;
    notify();
    expect(policies).toEqual(["playing", "fallback", "playing"]);
  } finally {
    stop();
    expect(changed.size).toBe(0);
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
