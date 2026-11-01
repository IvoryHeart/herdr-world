import { expect, test } from "bun:test";
import { createWorldCli, type WorldCliDeps } from "../world/world-cli";

test("CLI missing acknowledgements and unknown verbs never acquire a host", async () => {
  let acquisitions = 0;
  const cli = createWorldCli({
    hosts: () => {
      acquisitions++;
      throw new Error("unexpected acquisition");
    },
  } as unknown as WorldCliDeps);
  for (const [command, params] of [
    ["town desk move", { target: "tab:t" }],
    ["group add", { group: "Example", agent: "one", replace: true }],
    ["group import", {}],
    ["group delete", { group: "Example" }],
  ] as const) {
    expect(await cli.handle({ command, params }, null)).toMatchObject({
      ok: false,
      code: "refused",
      command_evidence: { stage: "refused" },
    });
  }
  for (const command of [
    "pull-request merge",
    "pane close",
    "workspace close",
    "unregistered",
  ])
    expect(await cli.handle({ command }, null)).toMatchObject({
      ok: false,
      code: "usage",
    });
  expect(acquisitions).toBe(0);
});

test("CLI memory-only replies report accepted and unverified agents retain their limits", async () => {
  const cli = createWorldCli({ hosts: () => [] } as unknown as WorldCliDeps);
  expect(await cli.handle({ command: "whoami" }, null)).toMatchObject({
    ok: true,
    actor: { verified: false },
    command_evidence: { stage: "accepted" },
  });
  for (const [command, params] of [
    ["spawned-by", { parent: "w1:p2" }],
    ["ask answer", { id: "q-example", answer: "Example" }],
    ["ask withdraw", { id: "q-example" }],
  ] as const)
    expect(await cli.handle({ command, params }, null)).toMatchObject({
      ok: false,
      code: "refused",
    });
});
