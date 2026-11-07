import { describe, expect, test } from "bun:test";
import { townReceptionName, townRoomCardMeta } from "./townNameplates";

describe("reception chip names", () => {
  test("an agent known only by its harness is named by its room", () => {
    expect(
      townReceptionName({ displayLabel: "claude" }, "harbor", "api"),
    ).toEqual({ name: "harbor", title: "claude in harbor › api" });
  });

  test("a named agent keeps its name, and the tooltip says where", () => {
    expect(
      townReceptionName(
        { displayLabel: "reviewer", agentName: "reviewer" },
        "harbor",
        "api",
      ),
    ).toEqual({ name: "reviewer", title: "reviewer in harbor › api" });
  });

  test("without a room the label stays as it was", () => {
    expect(
      townReceptionName({ displayLabel: "claude" }, undefined, undefined),
    ).toEqual({ name: "claude", title: "claude" });
  });
});

describe("room card meta", () => {
  test("activity (busy, as on the Town board) comes before the desk count", () => {
    expect(townRoomCardMeta({ desks: 15, working: 7 }, 0)).toBe(
      "7 busy · 15 desks",
    );
    expect(townRoomCardMeta({ desks: 15, working: 7 }, 3)).toBe(
      "7 busy · 15 desks · +3 more",
    );
  });
});
