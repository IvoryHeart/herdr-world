import { removeRuntimeStartGuard } from "./runtime-start-control";
import { expectObservationMismatch } from "./observations";
import { expect, test } from "bun:test";
import { replayRuntimeDrain, type DrainState } from "./runtime-drain";
import { parseTrace } from "./traces";

function scenario(
  kind: number,
  failed: boolean,
  cleanupFirst: boolean,
  backgroundWait: boolean,
  backgroundFailed: boolean,
) {
  let drain: DrainState = {
    kind: -1,
    failed: false,
    cleanupFirst: false,
    phase: "absent",
    gen: 0,
    transportDone: false,
    backgroundWait: false,
    backgroundFailed: false,
    backgroundDone: false,
    cleanupDone: false,
    readySeen: false,
    stage: "empty",
  };
  const states = [{ op: "init", drain }];
  const append = (op: string, change: Partial<DrainState>) => {
    drain = { ...drain, ...change };
    states.push({ op, drain });
  };
  append("choose", {
    kind,
    failed,
    cleanupFirst,
    phase: "connecting",
    gen: 1,
    stage: "starting",
    backgroundWait,
    backgroundFailed,
  });
  if (backgroundWait) append("enterBackground", { transportDone: true });
  append("retire", {
    phase: kind >= 4 ? "error" : "stopping",
    gen: kind === 1 ? 3 : 2,
    transportDone: backgroundWait || kind === 5,
    stage: "draining",
  });
  if (kind !== 5)
    append("finishFirst", {
      cleanupDone: cleanupFirst,
      transportDone: backgroundWait || !cleanupFirst,
      backgroundDone: backgroundWait && !cleanupFirst,
      stage: "half",
    });
  const phase =
    kind === 2 ? "removed" : kind >= 4 || failed ? "error" : "disconnected";
  append("finishSecond", {
    cleanupDone: true,
    transportDone: true,
    backgroundDone: backgroundWait,
    stage: "done",
    phase,
  });
  return parseTrace("runtime-drain", JSON.stringify({ states }));
}

test("every bounded retirement/start/cleanup combination drains its captured lifecycle", async () => {
  let cases = 0;
  const witnesses = new Set<string>();
  for (const kind of [0, 1, 2, 3, 4, 5])
    for (const failed of [false, true])
      for (const cleanupFirst of [false, true])
        for (const backgroundWait of [false, true])
          for (const backgroundFailed of [false, true]) {
            if (
              (backgroundFailed && !backgroundWait) ||
              (kind === 5 && backgroundWait)
            )
              continue;
            if (kind === 5 && cleanupFirst) continue;
            const observed = await replayRuntimeDrain(
              scenario(
                kind,
                failed,
                cleanupFirst,
                backgroundWait,
                backgroundFailed,
              ),
            );
            for (const witness of observed) witnesses.add(witness);
            cases++;
          }
  expect(cases).toBe(62);
  for (const name of [
    "stoppedDuringStart",
    "replacedDuringStart",
    "removedDuringStart",
    "shutdownDuringStart",
    "currentErrorDuringStart",
    "failedStart",
    "cleanupBeforeTransport",
    "transportBeforeCleanup",
    "failedDrain",
    "retiredDuringBackground",
    "failedBackground",
  ])
    expect(witnesses.has(name)).toBe(true);
});

test("each startup currency fence independently rejects its isolated implementation fault", async () => {
  const owner = new URL("../server/src/connections/manager.ts", import.meta.url)
    .pathname;
  const source = await Bun.file(owner).text();
  for (const boundary of ["transport", "background"] as const) {
    const build = await Bun.build({
      entrypoints: [owner],
      target: "bun",
      plugins: [
        {
          name: "isolated-guard",
          setup(builder) {
            builder.onLoad({ filter: /manager\.ts$/ }, ({ path }) =>
              path === owner
                ? {
                    contents: removeRuntimeStartGuard(source, boundary),
                    loader: "ts",
                  }
                : undefined,
            );
          },
        },
      ],
    });
    expect(build.success).toBe(true);
    const subject = await import(
      `data:text/javascript;base64,${Buffer.from(await build.outputs[0]!.text()).toString("base64")}`
    );
    await expectObservationMismatch(
      () =>
        replayRuntimeDrain(
          scenario(0, false, false, boundary === "background", false),
          subject.ConnectionManager,
        ),
      boundary === "background"
        ? ["drain.ready.seen"]
        : ["drain.ready.seen", "drain.background"],
    );
  }
});

test("background retirement cannot skip entering its controlled startup boundary", () => {
  const states = scenario(0, false, false, true, false);
  expect(() =>
    parseTrace(
      "runtime-drain",
      JSON.stringify({
        states: states.filter((state) => state.op !== "enterBackground"),
      }),
    ),
  ).toThrow("invalid drain action precondition");
});
