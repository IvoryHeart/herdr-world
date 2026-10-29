import { expect, test } from "bun:test";
import { fixtureHost, fixtureWorld } from "../board/boardFixture";
import { projectWorldOffice } from "../herdrOfficeProjection";
import { townReceptionVisitors } from "./townReception";

test("a watcher question keeps a visible reception slot ahead of six finishes", () => {
  const projection = projectWorldOffice(
    fixtureWorld([
      fixtureHost("alpha", [
        {
          label: "Demo",
          tabs: [
            {
              label: "Team",
              panes: [
                ["blocked"],
                ["done"],
                ["done"],
                ["done"],
                ["done"],
                ["done"],
                ["done"],
                ["idle", false],
              ],
            },
          ],
        },
      ]),
    ]),
    0,
  );
  const watcher = projection.paneRoster.find(
    ({ device }) => !device.agentKey,
  )!.device;
  expect(watcher.key).not.toBe(watcher.nodeId);
  const visitors = townReceptionVisitors(
    projection.roster.map(({ agent }) => agent),
    [watcher],
    new Set([watcher.nodeId]),
  );
  expect(visitors[0]).toMatchObject({ semanticStatus: "blocked" });
  expect(visitors[1]).toBe(watcher);
  expect(visitors.slice(0, 6)).toContain(watcher);
});
