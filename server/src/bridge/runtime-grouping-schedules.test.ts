import { expect, test } from "bun:test";
import { createUiSettingsRpcHandler } from "./settings-rpc";
import { defaultGuiSettings, type GuiSettings } from "../config/gui-settings";
import {
  RUNTIME_GROUPING_SETTING_KEY,
  type RuntimeGrouping,
} from "../../../shared/hostGrouping";
import {
  createSettingCommands,
  type SettingCommandRecord,
} from "../world/setting-commands";
import { createRuntimeGroupingMigration } from "../../../web/src/world/runtimeGrouping";
import { OFFICE_PREFERENCES_KEY } from "../../../web/src/world/officePreferences";

/**
 * Bounded exhaustive check of World's "Group runtimes" setting (#1307,
 * #1397): every order in which browsers' requests reach the service, the
 * service's answers and publications reach each browser, and browsers act,
 * with the real UI-settings handler (settings-rpc.ts), the real World
 * setting command (world/setting-commands.ts) and the real browser offer of
 * an older Town choice (web/src/world/runtimeGrouping.ts). An explicit
 * choice is a `world.command`; the older choice is an only-if-absent
 * settings write. Each commit is published to every browser under its
 * revision; a browser's replica adopts only a newer revision, whatever order
 * publications and answers arrive in (late replies included). Every
 * schedule is replayed from the start.
 *
 * Checked in every schedule, once nothing is left to do:
 * - every connected browser shows the value the service holds;
 * - a browser's one-time migration never replaces a value already stored;
 * - once a browser's explicit choice is stored, the service ends on the
 *   last explicit choice it stored;
 * - each stored explicit choice leaves exactly one history record with the
 *   value before and after it; the migration leaves none.
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
  /** How many writes the service may refuse in one schedule. */
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
  | { kind: "publication"; value: unknown; revision: number };

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
  let revision = 0;
  const handler = createUiSettingsRpcHandler({
    readSettings: async () => settings,
    updateSettings: async (update) => {
      settings = await update(settings);
      revision += 1;
      return settings;
    },
  });
  const stored = () => settings.ui[RUNTIME_GROUPING_SETTING_KEY];
  const violations: string[] = [];
  /** The last explicit choice the service stored, if any. */
  let explicit: unknown;
  let refusals = scenario.refusals;
  const history: SettingCommandRecord[] = [];
  /** Explicit choices stored, as the settings saw them around each commit. */
  const choices: Array<{ before: unknown; after: unknown }> = [];

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
    const browser = {
      spec,
      migration: createRuntimeGroupingMigration(storage),
      /** The replica: the newest publication this browser adopted. */
      replica: { revision: -1, value: undefined as unknown },
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
      /** world/runtimeStore.ts: an older revision never replaces a newer. */
      adopt(value: unknown, at: number) {
        if (at < browser.replica.revision) return;
        browser.replica = { revision: at, value };
        // store/uiSettings.ts hands each publication to the offer.
        browser.migration.adopt(value);
      },
    };
    return browser;
  });

  /** Every commit is published to every browser (world_invalidated). */
  const publish = () => {
    for (const browser of browsers)
      browser.toBrowser.push({
        kind: "publication",
        value: stored(),
        revision,
      });
  };
  const commands = createSettingCommands({
    now: () => 0,
    write: async (key, value) => {
      const result = (await handler("bridge.ui_settings.update", {
        key,
        value,
      })) as { before: unknown; value: unknown };
      return { before: result.before, value: result.value };
    },
    publish,
    record: async (record) => void history.push(record),
    log: () => {},
  });

  type Simulated = (typeof browsers)[number];
  async function runStep(browser: Simulated, step: Step) {
    if (step === "connect") {
      const result = await browser.call("bridge.ui_settings.get", {});
      // store/uiSettings.ts: install the offer's write path, then adopt.
      browser.migration.connect((value) =>
        browser.call("bridge.ui_settings.update", {
          key: RUNTIME_GROUPING_SETTING_KEY,
          value,
          only_if_absent: true,
        }),
      );
      browser.connected = true;
      browser.adopt(result.ui[RUNTIME_GROUPING_SETTING_KEY], result.revision);
    }
    // The Settings control: a World command naming the value it shows.
    else
      await browser
        .call("world.command", {
          id: `choice-${browser.next}`,
          entity: { kind: "setting", key: RUNTIME_GROUPING_SETTING_KEY },
          field: "value",
          expected: browser.replica.value ?? null,
          value: step,
        })
        .catch(() => {
          /* A refused command changes nothing; the publication stays. */
        });
    browser.busy = false;
  }

  type Action = () => Promise<void>;
  function enabled(): Action[] {
    const actions: Action[] = [];
    browsers.forEach((browser) => {
      const step = browser.spec.script[browser.next];
      // A browser acts once its previous step is answered; it chooses only
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
        const writes = request.method !== "bridge.ui_settings.get";
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
          let result: unknown;
          if (request.method === "world.command") {
            const record = await commands.submit(request.params as never);
            if (record.state === "stored") {
              explicit = stored();
              choices.push({ before, after: stored() });
            }
            result = record;
          } else {
            result = await handler(request.method, request.params);
            if (writes) {
              const after = stored();
              if (before !== undefined && after !== before)
                violations.push(`migration replaced ${before} with ${after}`);
              publish();
            }
          }
          browser.toBrowser.push({
            kind: "answer",
            deliver: () => request.answer(result),
          });
        };
        actions.push(() => serve(false));
        if (refusals > 0 && writes) actions.push(() => serve(true));
      }
      // Answers and publications reach a browser in any order.
      browser.toBrowser.forEach((message, at) =>
        actions.push(async () => {
          browser.toBrowser.splice(at, 1);
          if (message.kind === "answer") message.deliver();
          else browser.adopt(message.value, message.revision);
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
    if (browser.replica.value !== value)
      violations.push(
        `browser ${index} shows ${browser.replica.value}, service ${value}`,
      );
  });
  const recorded = history.map(({ before, observed }) => ({
    before,
    after: observed,
  }));
  if (
    JSON.stringify(recorded) !==
    JSON.stringify(
      choices.map(({ before, after }) => ({
        before: before ?? null,
        after,
      })),
    )
  )
    violations.push(
      `history ${JSON.stringify(recorded)}, choices ${JSON.stringify(choices)}`,
    );
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
