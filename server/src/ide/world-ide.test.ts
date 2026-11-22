import { expect, test } from "bun:test";
import { STARTUP_DEFAULT_CONNECTION_ID } from "../connections/types";
import { ideConnection } from "./world-ide";

/** How a connection list entry reads for the Code view. */
test("a local entry stays local", () => {
  expect(
    ideConnection(
      { id: "local", label: "Laptop", type: "local", generation: 3 },
      undefined,
    ),
  ).toEqual({ id: "local", label: "Laptop", type: "local", generation: 3 });
});

test("an SSH entry carries its destination; Windows is marked", () => {
  expect(
    ideConnection(
      {
        id: "box",
        label: "Box",
        type: "ssh",
        generation: 1,
        ssh_destination: "dev@devbox.example.test",
        remote_platform: "windows",
      },
      undefined,
    ),
  ).toEqual({
    id: "box",
    label: "Box",
    type: "ssh",
    generation: 1,
    sshDestination: "dev@devbox.example.test",
    remotePlatform: "windows",
  });
});

test("the startup connection started with --ssh is an SSH connection", () => {
  const entry = {
    id: STARTUP_DEFAULT_CONNECTION_ID,
    label: "Default",
    type: "local",
    generation: 2,
  };
  expect(ideConnection(entry, "devbox.example.test")).toMatchObject({
    type: "ssh",
    sshDestination: "devbox.example.test",
  });
  expect(ideConnection(entry, undefined).type).toBe("local");
});
