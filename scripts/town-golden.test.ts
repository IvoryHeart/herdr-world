import { expect, test } from "bun:test";
import { comparePixels } from "../web/src/world/testing/town-golden/pixels";
import { townGoldenViewports, runTownGolden } from "./town-golden";
import { resumeViewports } from "../web/src/world/testing/resumeVisualCapture";
import {
  includesBrowserSuites,
  worldBrowserSuites,
} from "./world-browser-suites";
import {
  installTestClock,
  type ClockTarget,
} from "../web/src/world/testing/testClock";
import { resolve } from "node:path";
import {
  townVisualMutant,
  verifyVisualControl,
} from "./town-golden-negative-control";

test("goldens cover the five PR screenshot viewports at bounded size", () => {
  expect(townGoldenViewports).toEqual(
    resumeViewports.map(({ name, width, height }) => ({ name, width, height })),
  );
  expect(
    townGoldenViewports.reduce((sum, v) => sum + v.width * v.height, 0),
  ).toBeLessThan(12_000_000);
  expect(includesBrowserSuites(["scripts/town-golden.browser.test.ts"])).toBe(
    true,
  );
  expect(worldBrowserSuites).not.toContain(
    "scripts/town-golden.browser.test.ts",
  );
});

test("stored PNG dimensions equal the declared DPR-1 viewports", async () => {
  for (const viewport of townGoldenViewports) {
    const png = Buffer.from(
      await Bun.file(
        new URL(
          `../web/src/world/testing/town-golden/images/${viewport.name}.png`,
          import.meta.url,
        ),
      ).arrayBuffer(),
    );
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(viewport.width);
    expect(png.readUInt32BE(20)).toBe(viewport.height);
  }
});

test("a one-channel, one-level pixel change fails, including alpha", () => {
  const original = new Uint8ClampedArray([20, 30, 40, 255, 50, 60, 70, 255]);
  expect(comparePixels(original, original, 2, 1).changed).toBe(0);
  for (let channel = 0; channel < 4; channel++) {
    const changed = original.slice();
    changed[4 + channel]!--;
    const result = comparePixels(original, changed, 2, 1);
    expect(result.changed).toBe(1);
    expect([...result.diff.slice(4)]).toEqual([255, 0, 255, 255]);
  }
  expect(() => comparePixels(original, original, 1, 1)).toThrow("dimensions");
});

test("a fixed clock origin makes loading time irrelevant", async () => {
  const target = {} as ClockTarget;
  const time = { now: () => 123456 };
  const clock = installTestClock(target, time, { startAt: 0 });
  expect(clock.now()).toBe(0);
  await clock.advance(32);
  expect(time.now()).toBe(32);
});

test("invalid run counts fail before launching Chrome", async () => {
  await expect(
    runTownGolden({ chrome: "", directory: "", runs: 21 }),
  ).rejects.toThrow("between 1 and 20");
});

test("report output cannot overwrite the stored references", async () => {
  await expect(
    runTownGolden({
      chrome: "",
      directory: resolve("web/src/world/testing/town-golden/images"),
    }),
  ).rejects.toThrow("separate from stored goldens");
});

test("the report workflow stays advisory and retains diagnostic artifacts", async () => {
  type Step = {
    name?: string;
    uses?: string;
    if?: string;
    run?: string;
    env?: Record<string, string>;
  };
  const workflow = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/town-golden.yml", import.meta.url),
    ).text(),
  ) as {
    jobs: {
      report: {
        "continue-on-error": boolean;
        "timeout-minutes": string;
        steps: Step[];
      };
    };
  };
  expect(workflow.jobs.report["continue-on-error"]).toBe(true);
  expect(workflow.jobs.report["timeout-minutes"]).toContain("&& 40 || 15");
  const steps = workflow.jobs.report.steps;
  expect(steps.find((s) => s.name === "Compare five viewports")!.run).toBe(
    "bun run test scripts/town-golden.browser.test.ts",
  );
  expect(
    steps.find((s) => s.name === "Compare five viewports")!.env
      ?.TOWN_GOLDEN_RUNS,
  ).toContain("&& '20' || '1'");
  const control = steps.find(
    (s) => s.name === "Verify a production visual mutant and restored baseline",
  )!;
  expect(control.if).toContain("inputs.stability");
  expect(control.run).toBe(
    "bun run test scripts/town-golden-negative.browser.test.ts",
  );
  expect(
    includesBrowserSuites(["scripts/town-golden-negative.browser.test.ts"]),
  ).toBe(true);
  expect(
    steps.find((s) => s.uses?.startsWith("actions/upload-artifact"))!.if,
  ).toBe("always()");
  const ci = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/ci.yml", import.meta.url),
    ).text(),
  ) as {
    jobs: { delivery: { needs: string[] } };
  };
  expect(ci.jobs.delivery.needs).not.toContain("town-golden");
});

test("the negative control changes exactly the production paint site", () => {
  const source = 'before\ng.fillStyle = "#5c9a48";\nafter';
  expect(townVisualMutant(source)).toBe(
    'before\ng.fillStyle = "#e05a9b";\nafter',
  );
  expect(() => townVisualMutant("missing")).toThrow("one production");
  expect(() => townVisualMutant(source + source)).toThrow("one production");
});

test("the full-path negative control rejects startup errors and false positive restores", () => {
  const receipts = Array.from({ length: 5 }, (_, i) => ({
    name: "viewport-" + i,
    changedPixels: 1,
    gpu: "SwiftShader",
  }));
  const mutant = {
    browserVersion: "Chrome",
    failures: ["Run 1, phone: 1 pixels differ"],
    receipts,
  };
  const restored = {
    browserVersion: "Chrome",
    failures: [],
    receipts: receipts.map((r) => ({ ...r, changedPixels: 0 })),
  };
  expect(() => verifyVisualControl(mutant, 1, restored, 0)).not.toThrow();
  expect(() =>
    verifyVisualControl(
      { ...mutant, failures: ["CDP timed out"] },
      1,
      restored,
      0,
    ),
  ).toThrow("specifically on changed pixels");
  expect(() => verifyVisualControl(mutant, 0, restored, 0)).toThrow(
    "specifically on changed pixels",
  );
  expect(() => verifyVisualControl(mutant, 1, mutant, 0)).toThrow(
    "Restored production",
  );
});
