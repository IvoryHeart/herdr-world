import { expect, test } from "bun:test";
import { createUiSettingsRpcHandler } from "./settings-rpc";
import { defaultGuiSettings, type GuiSettings } from "../config/gui-settings";
import {
  createRuntimeGroupingPreference,
  RUNTIME_GROUPING_CACHE_KEY,
  RUNTIME_GROUPING_SETTING_KEY,
  type RuntimeGrouping,
} from "../../../web/src/world/runtimeGrouping";
import { OFFICE_PREFERENCES_KEY } from "../../../web/src/world/officePreferences";

/**
 * Bounded exhaustive check of World's "Group runtimes" preference (#1307):
 * every order in which browsers' requests reach the service, the service's
 * answers and pushes reach each browser, and browsers act, with the real
 * UI-settings handler (settings-rpc.ts) and the real browser preference
 * (web/src/world/runtimeGrouping.ts). Each browser's requests reach the
 * service in order; the service answers the sender and pushes to the others
 * at commit, as rpc/bridge.ts does, and a browser may receive its waiting
 * answers and pushes in any order. Every schedule is replayed from the start.
 *
 * Checked in every schedule, once nothing is left to do:
 * - every browser shows, and caches, the value the service holds;
 * - a browser's one-time migration never replaces a value already stored;
 * - once a browser's explicit choice is stored, the service ends on the
 *   last explicit choice it stored.
 */

type Step = "connect" | RuntimeGrouping;
type Browser = {
  legacy?: RuntimeGrouping;
  script: Step[];
};
type Scenario = {
  name: string;
  stored?: RuntimeGrouping;
  browsers: Browser[];
  /** How many update requests the service may refuse in one schedule. */
  refusals: number;
};

type Request = {
  method: string;
  params: Record<string, unknown>;
  answer: (result: unknown) => void;
  refuse: (error: Error) => void;
};
type Message =
  | { kind: "answer"; deliver: () => void }
  | { kind: "push"; value: unknown; revision?: number };

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

async function runSchedule(
  scenario: Scenario,
  choose: (count: number) => number,
) {
  let settings: GuiSettings = {
    ...defaultGuiSettings(),
    ui: scenario.stored
      ? { [RUNTIME_GROUPING_SETTING_KEY]: scenario.stored }
      : {},
  };
  const handler = createUiSettingsRpcHandler({
    readSettings: async () => settings,
    updateSettings: async (update) => (settings = await update(settings)),
  });
  const stored = () => settings.ui[RUNTIME_GROUPING_SETTING_KEY];
  const violations: string[] = [];
  /** The last explicit choice the service stored, if any. */
  let explicit: unknown;
  let refusals = scenario.refusals;

  const browsers = scenario.browsers.map((spec) => {
    const storage = memoryStorage(
      spec.legacy
        ? {
            [OFFICE_PREFERENCES_KEY]: JSON.stringify({
              townBuildings: spec.legacy,
            }),
          }
        : {},
    );
    const preference = createRuntimeGroupingPreference(storage);
    const browser = {
      spec,
      storage,
      preference,
      toService: [] as Request[],
      toBrowser: [] as Message[],
      next: 0,
      connected: false,
      busy: false,
      call(method: string, params: Record<string, unknown>) {
        return new Promise<any>((answer, refuse) =>
          browser.toService.push({ method, params, answer, refuse }),
        );
      },
    };
    return browser;
  });

  type Simulated = (typeof browsers)[number];
  async function runStep(browser: Simulated, step: Step) {
    if (step === "connect") {
      const result = await browser.call("bridge.ui_settings.get", {});
      // store/uiSettings.ts: install the write path, then adopt.
      browser.preference.connect(async (value, options) => {
        const answer = await browser.call("bridge.ui_settings.update", {
          key: RUNTIME_GROUPING_SETTING_KEY,
          value,
          ...(options?.onlyIfAbsent ? { only_if_absent: true } : {}),
        });
        return { value: answer.value, revision: answer.revision };
      });
      browser.connected = true;
      browser.preference.adopt(
        result.ui[RUNTIME_GROUPING_SETTING_KEY],
        result.revision,
      );
    } else
      await browser.preference.save(step).catch(() => {
        /* A refused save shows the service's value again. */
      });
    browser.busy = false;
  }

  type Action = () => Promise<void>;
  function enabled(): Action[] {
    const actions: Action[] = [];
    browsers.forEach((browser) => {
      const step = browser.spec.script[browser.next];
      // A browser acts once its previous step is answered; it saves only
      // while connected, as the settings control does.
      if (step && !browser.busy && (step === "connect" || browser.connected))
        actions.push(async () => {
          browser.next += 1;
          browser.busy = true;
          // The step runs on; its answers arrive through later actions.
          void runStep(browser, step);
        });

      const request = browser.toService[0];
      if (request) {
        const serve = async (refused: boolean) => {
          browser.toService.shift();
          if (refused) {
            refusals -= 1;
            browser.toBrowser.push({
              kind: "answer",
              deliver: () => request.refuse(new Error("refused")),
            });
            return;
          }
          const before = stored();
          const result = await handler(request.method, request.params);
          if (request.method === "bridge.ui_settings.update") {
            const after = stored();
            if (request.params.only_if_absent) {
              if (before !== undefined && after !== before)
                violations.push(`migration replaced ${before} with ${after}`);
            } else explicit = after;
            for (const other of browsers)
              if (other !== browser)
                other.toBrowser.push({
                  kind: "push",
                  value: (result as { value: unknown }).value,
                  revision: (result as { revision?: number }).revision,
                });
          }
          browser.toBrowser.push({
            kind: "answer",
            deliver: () => request.answer(result),
          });
        };
        actions.push(() => serve(false));
        if (refusals > 0 && request.method === "bridge.ui_settings.update")
          actions.push(() => serve(true));
      }
      // The service sends an answer and its pushes from separate
      // continuations, so a browser may get them in any order.
      browser.toBrowser.forEach((message, at) =>
        actions.push(async () => {
          browser.toBrowser.splice(at, 1);
          if (message.kind === "answer") message.deliver();
          else browser.preference.adopt(message.value, message.revision);
        }),
      );
    });
    return actions;
  }

  for (;;) {
    await settle();
    const actions = enabled();
    if (!actions.length) break;
    await actions[choose(actions.length)]!();
  }

  const value = stored();
  if (explicit !== undefined && value !== explicit)
    violations.push(`service holds ${value}, last explicit choice ${explicit}`);
  browsers.forEach((browser, index) => {
    if (!browser.connected || value === undefined) return;
    const shown = browser.preference.current();
    if (shown !== value)
      violations.push(`browser ${index} shows ${shown}, service ${value}`);
    const cached = browser.storage.getItem(RUNTIME_GROUPING_CACHE_KEY);
    if (cached !== JSON.stringify(value))
      violations.push(`browser ${index} caches ${cached}, service ${value}`);
  });
  return violations;
}

/** Every schedule, depth first: replay a prefix of choices, then branch. */
async function explore(scenario: Scenario) {
  let schedules = 0;
  const failures: string[] = [];
  let prefix: number[] = [];
  for (;;) {
    const counts: number[] = [];
    const taken: number[] = [];
    const violations = await runSchedule(scenario, (count) => {
      const choice = prefix[taken.length] ?? 0;
      counts.push(count);
      taken.push(choice);
      return choice;
    });
    schedules += 1;
    if (violations.length && failures.length < 3)
      failures.push(`[${taken.join(",")}] ${violations.join("; ")}`);
    // Advance the last choice that has an untried alternative.
    let depth = taken.length - 1;
    while (depth >= 0 && taken[depth]! + 1 >= counts[depth]!) depth -= 1;
    if (depth < 0) break;
    prefix = [...taken.slice(0, depth), taken[depth]! + 1];
  }
  return { schedules, failures };
}

const scenarios: Scenario[] = [
  {
    // Review finding: a pending save, an earlier push, then the save's answer.
    name: "two browsers save different values at once",
    stored: "machine",
    browsers: [
      { script: ["connect", "runtime"] },
      { script: ["connect", "machine"] },
    ],
    refusals: 0,
  },
  {
    // Review finding: a delayed migration against an explicit choice.
    name: "an older browser's migration races another browser's choice",
    browsers: [
      { legacy: "runtime", script: ["connect"] },
      { script: ["connect", "machine"] },
    ],
    refusals: 0,
  },
  {
    // Both offer their older choice; the second offer must store nothing.
    name: "two older browsers' migrations race",
    browsers: [
      { legacy: "runtime", script: ["connect"] },
      { legacy: "runtime", script: ["connect"] },
    ],
    refusals: 1,
  },
  {
    name: "a browser changes its mind, one save refused, another watches",
    stored: "machine",
    browsers: [
      { script: ["connect", "runtime", "machine"] },
      { script: ["connect"] },
    ],
    refusals: 1,
  },
];

for (const scenario of scenarios)
  test(`Group runtimes, every schedule: ${scenario.name}`, async () => {
    const { schedules, failures } = await explore(scenario);
    expect(failures).toEqual([]);
    // The exploration really branched.
    expect(schedules).toBeGreaterThan(50);
  }, 30_000);
