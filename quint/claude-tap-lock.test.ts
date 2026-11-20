import { expect, test } from "bun:test";
import { replayTapLockSchedule, tapBoundaries } from "./claude-tap-lock";
import { claudeTapLockFixture } from "../shared/testing/claude-tap-lock-fixture";

for (const boundary of tapBoundaries) {
  for (const stopped of [false, true]) {
    test(`tap paused at ${boundary} (${stopped ? "dead" : "live"}) preserves committed maxima`, () => {
      const commits = replayTapLockSchedule(boundary, stopped).commits;
      expect(commits).toEqual(
        stopped
          ? boundary === "release"
            ? [20, 22, 23, 23]
            : [20, 23, 23]
          : boundary === "acquire"
            ? [20, 23, 23, 23]
            : [20, 22, 23],
      );
    });
  }
}

test("the owner preview histories match actual final-rename schedules", () => {
  for (const scenario of ["live", "dead"] as const)
    expect(
      replayTapLockSchedule("commit", scenario === "dead").commits,
    ).toEqual(claudeTapLockFixture[scenario].commits);
});
