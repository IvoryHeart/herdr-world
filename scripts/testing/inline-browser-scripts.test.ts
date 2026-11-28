import { expect, test } from "bun:test";
import { inlineBrowserScripts } from "./inline-browser-scripts";
import { scanSource } from "../check-test-waits";

test("HTML browser waits are checked without treating JSON payloads as programs", () => {
  const scripts = inlineBrowserScripts(
    "a.test.ts",
    'const html = `<script type="module">await new Promise(resolve => setTimeout(resolve, 50)); const value = ${value};</script><script type="application/json">{"data":true}</script>`;',
  );
  expect(scripts).toHaveLength(1);
  expect(
    inlineBrowserScripts(
      "a.ts",
      `const html = "<SCRIPT>Date.now();</SCRIPT>";`,
    ),
  ).toEqual(["Date.now();"]);
  expect(scripts[0]).toContain("__herdrTemplateValue");
  expect(scanSource("inline.browser.ts", scripts[0]!).pauses).toEqual([1]);
  expect(
    inlineBrowserScripts(
      "a.test.ts",
      'const text = "Date.now(); setTimeout(resolve, 50)";',
    ),
  ).toEqual([]);
});
