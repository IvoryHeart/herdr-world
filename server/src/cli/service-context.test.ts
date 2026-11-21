import { expect, test } from "bun:test";
import { basename } from "node:path";
import {
  resolveServicePaths,
  resolveServicePlatform,
} from "../config/service-definitions";
import { changeConnectionServiceState } from "./service-context";
import { createTestCli } from "./test-context";

for (const platform of ["linux", "darwin", "win32"]) {
  test(`${platform} connection restart splits managed stop and start`, () => {
    const cli = createTestCli({
      runtime: { platform, uid: 1000 },
      runCommand: () => 0,
    });
    try {
      expect(changeConnectionServiceState(cli.context, "stop")).toBe(0);
      expect(changeConnectionServiceState(cli.context, "start")).toBe(0);
      const paths = resolveServicePaths(
        resolveServicePlatform(platform),
        cli.home,
      );
      if (platform === "linux") {
        expect(cli.commands).toEqual(
          ["stop", "start"].map((action) => [
            "systemctl",
            "--user",
            action,
            basename(paths.definition),
          ]),
        );
      } else if (platform === "darwin") {
        expect(cli.commands).toEqual([
          [
            "launchctl",
            "bootout",
            `gui/1000/${basename(paths.definition, ".plist")}`,
          ],
          ["launchctl", "bootstrap", "gui/1000", paths.definition],
        ]);
      } else {
        expect(cli.commands).toEqual([
          ["schtasks.exe", "/End", "/TN", paths.taskName!],
          ["schtasks.exe", "/Run", "/TN", paths.taskName!],
        ]);
      }
    } finally {
      cli.cleanup();
    }
  });
}
