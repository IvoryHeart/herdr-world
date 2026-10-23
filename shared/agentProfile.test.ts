import { describe, expect, test } from "bun:test";
import {
  STARTER_PROFILES,
  agentNameFor,
  fillBrief,
  launchPlan,
  parseProfile,
  type AgentProfile,
} from "./agentProfile";

const builder = STARTER_PROFILES.find((p) => p.id === "builder")!;
const reviewer = STARTER_PROFILES.find((p) => p.id === "reviewer")!;
const with_ = (patch: Partial<AgentProfile>) => ({ ...builder, ...patch });

describe("Profile mapping per harness", () => {
  test("Claude Code gets an inline subagent definition and runs as it", () => {
    const plan = launchPlan(
      with_({ tools: ["Read", "Grep"], skills: ["code-review"] }),
      "builder",
    );
    expect(plan.preamble).toBe("");
    const at = plan.args.indexOf("--agents");
    expect(JSON.parse(plan.args[at + 1]!)).toEqual({
      builder: {
        description: expect.stringMatching(/^You implement one change/),
        prompt: builder.role,
        tools: ["Read", "Grep"],
        model: "sonnet",
        skills: ["code-review"],
      },
    });
    expect(plan.args.slice(at + 2)).toEqual([
      "--agent",
      "builder",
      "--permission-mode",
      "acceptEdits",
    ]);
  });

  test("an empty choice leaves the harness's default alone", () => {
    const plan = launchPlan(with_({ model: "", permission: "" }), "b");
    expect(plan.args).not.toContain("--permission-mode");
    expect(JSON.parse(plan.args[1]!).b).not.toHaveProperty("model");
  });

  test("Codex gets its options and the role as developer instructions", () => {
    const plan = launchPlan(reviewer, "reviewer");
    expect(plan.args).toEqual([
      "-a",
      "on-request",
      "-s",
      "read-only",
      "-c",
      'model_reasoning_effort="high"',
      "-c",
      `developer_instructions=${JSON.stringify(`${reviewer.role}\n\nUse these skills when they apply: code-review.`)}`,
    ]);
    expect(launchPlan({ ...reviewer, tools: ["Edit"] }, "r").args).toContain(
      "workspace-write",
    );
  });

  test("another kind starts plainly with the role in its first prompt", () => {
    const plan = launchPlan(with_({ harness: "pi" }), "b");
    expect(plan.args).toEqual([]);
    expect(plan.preamble).toBe(builder.role);
  });
});

describe("Profile rules", () => {
  test("starters are valid profiles", () => {
    for (const profile of STARTER_PROFILES)
      expect(parseProfile(profile)).toEqual(profile);
  });

  test("a credential is refused, never stored", () => {
    expect(() =>
      parseProfile(with_({ role: "Use sk-abcdefghijklmnopqrstuvwxyz123456" })),
    ).toThrow(/credential/);
    expect(() => parseProfile(with_({ model: "--dangerously" }))).toThrow();
    expect(() =>
      parseProfile(
        with_({ look: { ...builder.look, outfit: "cape" as never } }),
      ),
    ).toThrow(/outfit/);
  });

  test("agent names follow Herdr's pattern and stay unique", () => {
    expect(agentNameFor("FirstMate")).toBe("firstmate");
    expect(agentNameFor("Plan the migration!")).toBe("plan-the-migration");
    expect(agentNameFor("42 ways")).toBe("ways");
    expect(agentNameFor("!!!")).toBe("agent");
    expect(agentNameFor("Reviewer", new Set(["reviewer", "reviewer-2"]))).toBe(
      "reviewer-3",
    );
  });

  test("the brief fills its known fields and leaves the rest", () => {
    expect(
      fillBrief("{{name}} in {{room}}: {{task}} ({{branch}})", {
        name: "builder",
        room: "harbor",
        task: "Fix retries",
        spawned_by: "you",
      }),
    ).toBe("builder in harbor: Fix retries ({{branch}})");
  });
});
