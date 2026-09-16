import { describe, expect, test } from "bun:test";
import { parseWorkspaceAgentLayout } from "./workspaceAgentLayout";

describe("workspace Agent layout preference", () => {
  test("defaults to nested and accepts the separate and compact modes", () => {
    expect(parseWorkspaceAgentLayout(null)).toBe("nested");
    expect(parseWorkspaceAgentLayout("nested")).toBe("nested");
    expect(parseWorkspaceAgentLayout("invalid")).toBe("nested");
    expect(parseWorkspaceAgentLayout("separate")).toBe("separate");
    expect(parseWorkspaceAgentLayout("compact")).toBe("compact");
  });
});
