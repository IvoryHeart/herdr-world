import { describe, expect, test } from "bun:test";
import {
  isWorkspacePathDrag,
  setWorkspacePathDragData,
  WORKSPACE_PATH_DRAG_TYPE,
  workspacePathFromDrag,
} from "./workspacePathDrag";

function fakeDataTransfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: "uninitialized" as DataTransfer["effectAllowed"],
    get types() {
      return Array.from(values.keys());
    },
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => {
      values.set(type, value);
    },
  };
}

describe("workspace path drag", () => {
  test("carries the path as both the custom type and plain text", () => {
    const data = fakeDataTransfer();
    setWorkspacePathDragData(data, "/repo/AGENTS.md");
    expect(data.effectAllowed).toBe("copy");
    expect(data.getData(WORKSPACE_PATH_DRAG_TYPE)).toBe("/repo/AGENTS.md");
    expect(data.getData("text/plain")).toBe("/repo/AGENTS.md");
    expect(isWorkspacePathDrag(data)).toBe(true);
    expect(workspacePathFromDrag(data)).toBe("/repo/AGENTS.md");
  });

  test("ignores plain text and file drags from elsewhere", () => {
    expect(isWorkspacePathDrag({ types: ["text/plain"] })).toBe(false);
    expect(isWorkspacePathDrag({ types: ["Files"] })).toBe(false);
  });
});
