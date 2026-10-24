import { expect, test } from "bun:test";
import { titleTask } from "./now";

test("the Now task omits a redundant status prefix without changing task words", () => {
  expect(titleTask("✳ Working: Run the tests")).toBe("Run the tests");
  expect(titleTask("Needs you: Choose a target")).toBe("Choose a target");
  expect(titleTask("Working with linked checkouts")).toBe(
    "Working with linked checkouts",
  );
  expect(titleTask(null)).toBeNull();
});
