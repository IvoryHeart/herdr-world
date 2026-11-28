import { expect, test } from "bun:test";
import { agentInputFailureNotice } from "./agentInput";

test("refused agent input offers the original text as Copy without native codes", () => {
  const text = "Review feedback:\n`src/example.ts`\n> quote\nPlease fix this";
  for (const code of ["agent_not_ready", "agent_input_unavailable"])
    expect(
      agentInputFailureNotice(text, new Error(`${code}: Nothing was sent.`)),
    ).toEqual({
      kind: "error",
      message: "Not sent",
      detail: "Nothing was sent.",
      actionLabel: "Copy",
      actionClipboardText: text,
    });
});
