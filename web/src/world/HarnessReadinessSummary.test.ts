import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { unknownHarnessReadiness } from "../../../shared/harnessReadiness";
import { parseLauncherCatalog, readinessNote } from "./agentProfiles";
import { HarnessReadinessSummary } from "./HarnessReadinessSummary";

test("unknown evidence names retry/configuration and safe source/time", () => {
  const catalog = parseLauncherCatalog({
    kinds: ["codex"],
    readiness: [
      {
        ...unknownHarnessReadiness("codex", "probe-failed", 1_700_000_000_000),
        account: "dev@example.com",
      },
    ],
  });
  const html = renderToStaticMarkup(
    createElement(HarnessReadinessSummary, { catalog }),
  );
  expect(html).toContain("Readiness unknown");
  expect(html).toContain("Check again");
  expect(html).toContain("Edit profiles");
  expect(html).toContain("World harness probe");
  expect(html).toContain('dateTime="2023-11-14T22:13:20.000Z"');
  expect(html).not.toContain("example.com");
  expect(html).not.toContain("Not installed");
  expect(readinessNote("codex", catalog)?.blocked).toBe(false);
});

test("older missing evidence does not fabricate a check time", () => {
  const html = renderToStaticMarkup(
    createElement(HarnessReadinessSummary, {
      catalog: parseLauncherCatalog({ kinds: ["codex"] }),
    }),
  );
  expect(html).toContain("Time unknown");
  expect(html).not.toContain("dateTime");
});
