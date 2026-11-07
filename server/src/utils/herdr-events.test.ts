import { expect, test } from "bun:test";
import { createPaneActivityClassifier } from "./herdr-events";

function update(patch: Record<string, unknown> = {}, event = "pane_updated") {
  return {
    event,
    data: {
      type: event,
      pane: {
        pane_id: "pane-1",
        tab_id: "tab-1",
        cwd: "/example/project",
        agent_status: "working",
        focused: false,
        revision: 1,
        terminal_title: "Working ⠋",
        terminal_title_stripped: "Working",
        scroll: { offset: 0 },
        ...patch,
      },
    },
  };
}

test.each(["pane_updated", "pane.updated"])(
  "%s first update is a change; repaints and repeats are activity",
  (event) => {
    const classifier = createPaneActivityClassifier();
    expect(classifier.classify(update({}, event))).toBeUndefined();
    expect(classifier.classify(update({}, event))).toBe("activity");
    expect(
      classifier.classify(
        update(
          {
            revision: 2,
            terminal_title: "Working ⠴",
            terminal_title_stripped: "Working again",
            scroll: { offset: 20 },
          },
          event,
        ),
      ),
    ).toBe("activity");
  },
);

test.each([
  { agent_status: "idle" },
  { focused: true },
  { tab_id: "tab-2" },
  { cwd: "/example/other" },
  { future_field: { state: "changed" } },
])("semantic or unknown pane changes stay hard: %j", (patch) => {
  const classifier = createPaneActivityClassifier();
  classifier.classify(update());
  const changed = update({
    ...patch,
    revision: 2,
    terminal_title: "Working ⠴",
  });
  expect(classifier.classify(changed)).toBeUndefined();
  expect(classifier.classify(changed)).toBe("activity");
});

test("removing a semantic field is a change, regardless of payload key order", () => {
  const classifier = createPaneActivityClassifier();
  const first = update();
  classifier.classify(first);
  const reordered = {
    event: first.event,
    data: {
      pane: Object.fromEntries(Object.entries(first.data.pane).reverse()),
    },
  };
  expect(classifier.classify(reordered)).toBe("activity");
  delete reordered.data.pane.cwd;
  expect(classifier.classify(reordered)).toBeUndefined();
});

test("repaint classification ignores nested object key order but retains values and array order", () => {
  const classifier = createPaneActivityClassifier();
  const metadata = {
    state_labels: { status: "working", task: "Tests" },
    tokens: { task: "Tests", role: "builder" },
    future_field: [{ context: { first: 1, second: 2 } }, "tail"],
  };
  expect(classifier.classify(update(metadata))).toBeUndefined();
  const reordered = {
    state_labels: { task: "Tests", status: "working" },
    tokens: { role: "builder", task: "Tests" },
    future_field: [{ context: { second: 2, first: 1 } }, "tail"],
    revision: 2,
    terminal_title: "Working ⠴",
  };
  expect(classifier.classify(update(reordered))).toBe("activity");
  expect(
    classifier.classify(
      update({ ...reordered, tokens: { role: "reviewer", task: "Tests" } }),
    ),
  ).toBeUndefined();
  expect(classifier.classify(update(reordered))).toBeUndefined();
  expect(classifier.classify(update(reordered))).toBe("activity");
  expect(
    classifier.classify(
      update({
        ...reordered,
        future_field: [...reordered.future_field].reverse(),
      }),
    ),
  ).toBeUndefined();
});

test("other events forget all panes, even if their payload contains a pane", () => {
  const classifier = createPaneActivityClassifier();
  classifier.classify(update());
  classifier.classify(update({ pane_id: "pane-2" }));
  expect(classifier.classify(update({}, "tab.renamed"))).toBeUndefined();
  expect(classifier.classify(update())).toBeUndefined();
  expect(classifier.classify(update({ pane_id: "pane-2" }))).toBeUndefined();
});

test("a subscription reset forgets the last payload", () => {
  const classifier = createPaneActivityClassifier();
  classifier.classify(update());
  classifier.reset();
  expect(classifier.classify(update({ revision: 2 }))).toBeUndefined();
  expect(classifier.classify(update({ revision: 3 }))).toBe("activity");
});

test("interleaved panes keep independent baselines", () => {
  const classifier = createPaneActivityClassifier();
  expect(classifier.classify(update())).toBeUndefined();
  expect(
    classifier.classify(update({ pane_id: "pane-2", agent_status: "idle" })),
  ).toBeUndefined();
  expect(classifier.classify(update({ revision: 2 }))).toBe("activity");
  expect(
    classifier.classify(
      update({ pane_id: "pane-2", agent_status: "idle", revision: 3 }),
    ),
  ).toBe("activity");
});

test("data.type envelopes also classify pane activity", () => {
  const classifier = createPaneActivityClassifier();
  const { data } = update();
  expect(classifier.classify({ data })).toBeUndefined();
  expect(classifier.classify({ data })).toBe("activity");
});

test.each(
  [
    null,
    [],
    {},
    { event: "pane_updated", data: {} },
    { event: "pane_updated", data: { pane: [] } },
    { event: "pane_updated", data: { pane: {} } },
    update({ pane_id: "" }),
    update({ pane_id: 7 }),
  ].map((event) => ({ event })),
)("malformed updates are hard and forget earlier payloads: %j", ({ event }) => {
  const classifier = createPaneActivityClassifier();
  classifier.classify(update());
  expect(classifier.classify(event)).toBeUndefined();
  expect(classifier.classify(update())).toBeUndefined();
});
