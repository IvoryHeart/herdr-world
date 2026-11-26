import { expect, test } from "bun:test";
import { infrastructureFailure } from "./pipeline-retry";

test("retry signatures distinguish unavailable infrastructure from product assertions", () => {
  const job = {
    id: 1,
    name: "native",
    conclusion: "failure",
    runner_name: "runner",
    steps: [{ name: "Run native test", conclusion: "failure" }],
  };
  expect(
    infrastructureFailure(
      { ...job, runner_name: "", steps: [] },
      "not acquired by Runner",
    ),
  ).toBe(true);
  expect(
    infrastructureFailure(job, "expected version 0.3.8 but got 0.3.7"),
  ).toBe(false);
  expect(
    infrastructureFailure(job, "Error: test timed out after 5000 ms"),
  ).toBe(false);
  expect(
    infrastructureFailure(
      {
        ...job,
        steps: [
          { name: "Run oven-sh/setup-bun@pinned", conclusion: "failure" },
        ],
      },
      "HTTP 403",
    ),
  ).toBe(true);
  expect(infrastructureFailure(job, "artifact ENOTFOUND during download")).toBe(
    true,
  );
  expect(
    infrastructureFailure(
      { ...job, conclusion: "success" },
      "artifact ENOTFOUND",
    ),
  ).toBe(false);
});
