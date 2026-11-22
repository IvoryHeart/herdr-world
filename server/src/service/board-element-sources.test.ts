import { expect, test } from "bun:test";
import { boardElementProject } from "./board-element-sources";
import type { RpcServices } from "../rpc/context";

test.each(["herdr", "herdr-core"])(
  "%s source reads require the exact named ready generation, never another host",
  (runtime) => {
    let current = true,
      acquisitions = 0;
    const files = {
      readWorkspaceFile: async () => {
        throw new Error("unused");
      },
      listWorkspaceFiles: async () => {
        throw new Error("unused");
      },
    };
    const lease = {
      generation: 7,
      isCurrent: () => current,
      runtime: { files },
    };
    const manager = {
      has: (id: string) => id === "studio",
      readyRuntimeLease: (id: string) => {
        acquisitions++;
        expect(id).toBe("studio");
        return lease;
      },
    };
    const services = {
      connectionManager: runtime === "herdr" ? manager : { has: () => false },
      coreControl:
        runtime === "herdr-core"
          ? { manager, hostRuntime: () => ({ files }) }
          : undefined,
    } as unknown as RpcServices;
    const source = {
      connection_id: "studio",
      workspace_id: "project-a",
      path: "MEMORY.md",
    };
    expect(() =>
      boardElementProject(services, { ...source, connection_id: "absent" }, 7),
    ).toThrow("named connection");
    expect(acquisitions).toBe(0);
    expect(() => boardElementProject(services, source, 6)).toThrow(
      "generation",
    );
    const project = boardElementProject(services, source, 7);
    expect(project.files).toBe(files);
    current = false;
    expect(project.isCurrent()).toBe(false);
    expect(() => boardElementProject(services, source, 7)).toThrow(
      "generation",
    );
  },
);
