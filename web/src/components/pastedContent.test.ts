import { expect, test } from "bun:test";
import { unwrapPastedContent } from "./pastedContent";

test("unwraps Claude Code's pasted_content blocks", () => {
  expect(
    unwrapPastedContent(
      '<pasted_content id="4821">\nPlease check:\n- the build\n</pasted_content id="4821">',
    ),
  ).toEqual({ text: "Please check:\n- the build", pasted: true });
  expect(
    unwrapPastedContent(
      'Before <pasted_content id="a1">one</pasted_content id="a1"> and <pasted_content id="b2">two</pasted_content id="b2">',
    ),
  ).toEqual({ text: "Before one and two", pasted: true });
  // Tags whose ids differ are not one block.
  expect(
    unwrapPastedContent('<pasted_content id="a">x</pasted_content id="b">')
      .pasted,
  ).toBe(false);
  expect(unwrapPastedContent("Plain words")).toEqual({
    text: "Plain words",
    pasted: false,
  });
});
