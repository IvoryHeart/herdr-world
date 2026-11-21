import { describe, expect, test } from "bun:test";
import type {
  WorldLeafObject,
  WorldObject,
  WorldSpaceObject,
} from "../worldObject";
import { codeProjects, displayFolder, projectFolder } from "./codeProjects";

const space = (
  id: string,
  connectionId: string,
  label: string,
  cwd: string | undefined,
  extra: Partial<WorldSpaceObject> = {},
) =>
  ({
    id,
    kind: "space",
    connectionId,
    generation: 3,
    hostLabel: connectionId === "local" ? "This computer" : "devbox",
    label,
    stale: false,
    children: [],
    workspace: { cwd },
    ...extra,
  }) as unknown as WorldSpaceObject;

const leaf = (
  id: string,
  connectionId: string,
  parentId: string,
  cwd: string,
  kind: "agent" | "terminal" = "agent",
  name = id,
) =>
  ({
    id,
    kind,
    connectionId,
    generation: 3,
    hostLabel: connectionId === "local" ? "This computer" : "devbox",
    parentId,
    label: name,
    agentName: kind === "agent" ? name : undefined,
    stale: false,
    status: "idle",
    pane: { cwd },
  }) as unknown as WorldLeafObject;

const world = (spaces: WorldSpaceObject[], leaves: WorldLeafObject[]) =>
  ({ spaces, leaves }) as unknown as WorldObject;

describe("codeProjects", () => {
  test("a room's folder is a project with its agents, terminals first by kind then name", () => {
    const room = space("s1", "local", "api", "/srv/example/api");
    const projects = codeProjects(
      world(
        [room],
        [
          leaf("t1", "local", "s1", "/srv/example/api", "terminal", "shell"),
          leaf("a2", "local", "s1", "/srv/example/api/web", "agent", "zed"),
          leaf("a1", "local", "s1", "/srv/example/api", "agent", "ada"),
        ],
      ),
    );
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      connectionId: "local",
      generation: 3,
      folder: "/srv/example/api",
      label: "api",
    });
    expect(projects[0]!.leaves.map((entry) => entry.id)).toEqual([
      "a1",
      "a2",
      "t1",
    ]);
  });

  test("a linked checkout wins over the room's working directory", () => {
    const room = space("s1", "local", "api", "/srv/example/api", {
      workspace: {
        cwd: "/srv/example/api",
        worktree: {
          checkout_path: "/srv/example/api-feature",
          repo_name: "api",
          is_linked_worktree: true,
        },
      },
    } as Partial<WorldSpaceObject>);
    const [project] = codeProjects(world([room], []));
    expect(project!.folder).toBe("/srv/example/api-feature");
    expect(project!.label).toBe("api · api-feature");
  });

  test("an agent outside every room's folder adds its own project; terminals do not", () => {
    const room = space("s1", "local", "api", "/srv/example/api");
    const projects = codeProjects(
      world(
        [room],
        [
          leaf("a1", "local", "s1", "/srv/example/other"),
          leaf("t1", "local", "s1", "/srv/example/scratch", "terminal"),
        ],
      ),
    );
    expect(projects.map((project) => project.folder).sort()).toEqual([
      "/srv/example/api",
      "/srv/example/other",
    ]);
    // The room still lists its own terminal even outside its folder.
    const api = projects.find((p) => p.folder === "/srv/example/api")!;
    expect(api.leaves.map((entry) => entry.id).sort()).toEqual(["a1", "t1"]);
  });

  test("the same folder on two connections is two projects, never merged", () => {
    const projects = codeProjects(
      world(
        [
          space("s1", "local", "api", "/srv/example/api"),
          space("s2", "ssh-1", "api", "/srv/example/api"),
        ],
        [
          leaf("a1", "local", "s1", "/srv/example/api"),
          leaf("a2", "ssh-1", "s2", "/srv/example/api"),
        ],
      ),
    );
    expect(projects).toHaveLength(2);
    for (const project of projects)
      expect(
        project.leaves.every(
          (entry) => entry.connectionId === project.connectionId,
        ),
      ).toBe(true);
  });

  test("stale projects sort last and relative or control-character folders are refused", () => {
    const projects = codeProjects(
      world(
        [
          space("s1", "local", "old", "/srv/example/old", { stale: true }),
          space("s2", "local", "new", "/srv/example/new"),
          space("s3", "local", "rel", "relative/path"),
          space("s4", "local", "bad", "/srv/example/\u0007bell"),
        ],
        [],
      ),
    );
    expect(projects.map((project) => project.label)).toEqual(["new", "old"]);
  });
});

test("projectFolder trims trailing slashes and keeps the root", () => {
  expect(projectFolder("/srv/example/api/")).toBe("/srv/example/api");
  expect(projectFolder("/")).toBe("/");
  expect(projectFolder("~/api")).toBeNull();
  expect(projectFolder(undefined)).toBeNull();
});

test("displayFolder shortens only the home part", () => {
  expect(displayFolder("/home/example/api")).toBe("~/api");
  expect(displayFolder("/Users/example")).toBe("~");
  expect(displayFolder("/srv/home/example")).toBe("/srv/home/example");
});
