import { afterEach, expect, test } from "bun:test";
import { cleanupDeliveries, setup } from "./crew-round-delivery-fixture";
import { input, config, NOW, SHA } from "./gate/cases";
import { evaluate } from "./gate/predicate";
import { marks, plan, SETTINGS_DEFAULTS } from "./crew/plan";
import { uiTrialAction } from "./crew/ui-trial";
afterEach(cleanupDeliveries);
const settings = {
  ...SETTINGS_DEFAULTS,
  readyAsk: false,
  readySeat: "steward",
};
const gate = { ...config, reviewers: { default: ["rev2"] } };
function clean(pending = false) {
  const v = input({
    checks: pending
      ? [{ name: "Delivery checks", state: "pending", required: true }]
      : undefined,
    head: SHA.reviewed,
    posts: [
      { reviewer: "rev2", commit: SHA.reviewed, result: "1/1 resolved, 0 new" },
    ],
  });
  v.item!.pr!.uiChange = true;
  v.item!.pr!.images = 2;
  return v;
}
test("clean current UI raises one steward Try handoff even while CI is pending; no owner plumbing ask", () => {
  const f = setup({ settings: { readyAsk: false, readySeat: "steward" } });
  const original = f.deps.run;
  f.deps.run = (argv) =>
    argv.join(" ") === "herdr agent list"
      ? {
          code: 0,
          stderr: "",
          stdout: JSON.stringify({
            result: { agents: [{ name: "steward", agent_status: "working" }] },
          }),
        }
      : original(argv);
  const v = clean(true);
  f.passInput(v);
  f.passInput(v, NOW + 1);
  const sent = f.calls.filter((a) =>
    a.join(" ").startsWith("herdr agent prompt steward "),
  );
  expect(sent).toHaveLength(1);
  expect(sent[0]!.at(-1)).toContain("owner's Try");
  expect(sent[0]!.at(-1)).toContain("Merge gates still pending");
  expect(f.calls.some((a) => a[0] === "herdr-world")).toBe(false);
  expect(
    marks(evaluate(v, gate, NOW), v, settings, []).find(
      (m) => m.context === "crew/needs-owner",
    ),
  ).toMatchObject({ state: "pending", description: "Owner Try via steward" });
});
test("default owner readiness remains supported and readyAsk false alone remains silent", () => {
  const v = clean(),
    verdict = evaluate(v, gate, NOW);
  expect(plan(verdict, v, SETTINGS_DEFAULTS, [])[0]?.target).toBe("owner");
  expect(
    plan(verdict, v, { ...SETTINGS_DEFAULTS, readyAsk: false }, []),
  ).toEqual([]);
});
test("old-head, open, held, non-UI and unfinished crew reviews cannot raise a Try", () => {
  for (const kind of ["old", "open", "held", "non-ui", "crew"]) {
    const v = clean();
    if (kind === "old") v.item!.pr!.reviewers[0]!.commit = SHA.other;
    if (kind === "open") v.item!.pr!.reviewers[0]!.outcome = "open";
    if (kind === "held") v.labels.push("on-hold");
    if (kind === "non-ui") v.item!.pr!.uiChange = false;
    const verdict = evaluate(v, gate, NOW);
    if (kind === "crew")
      verdict.conditions.push({
        id: "crew-round",
        state: "waiting",
        detail: "fresh results outstanding",
      });
    expect(uiTrialAction(verdict, v, settings)).toBeNull();
  }
});
