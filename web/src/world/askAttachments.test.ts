import { expect, test } from "bun:test";
import type { ConnectionClient, ConnectionSummary } from "../api";
import { answerWithAttachments, askAttachmentClient } from "./askAttachments";

test("an answer lists its stored files after its text, one path per line", () => {
  expect(answerWithAttachments("  Looks wrong here  ", [])).toBe(
    "Looks wrong here",
  );
  expect(
    answerWithAttachments("Looks wrong here", [
      "/tmp/example/upload-a/screen.png",
      "/tmp/example/upload-b/log.txt",
    ]),
  ).toBe(
    "Looks wrong here\n\nAttached files:\n/tmp/example/upload-a/screen.png\n/tmp/example/upload-b/log.txt",
  );
  // Files alone are an answer too.
  expect(answerWithAttachments(" ", ["/tmp/example/upload-a/screen.png"])).toBe(
    "Attached files:\n/tmp/example/upload-a/screen.png",
  );
});

const summary = (
  id: string,
  type: "local" | "ssh",
  state: ConnectionSummary["state"],
  isDefault = false,
  generation = 3,
) =>
  ({
    id,
    label: id,
    source: "profile",
    is_default: isDefault,
    state,
    generation,
    type,
  }) as ConnectionSummary;

const opener = () => {
  const opened: string[] = [];
  const connect = (id: string, generation: number) => {
    opened.push(`${id}@${generation}`);
    return { connectionId: id, isCurrent: () => true } as ConnectionClient;
  };
  return { opened, connect };
};

const unplaced = { actor: { label: "pane-1", verified: false } };

test("an asker World never placed stores on the World host's ready local connection", () => {
  const { opened, connect } = opener();
  expect(
    askAttachmentClient(
      unplaced,
      null,
      [
        summary("remote", "ssh", "ready", true),
        summary("stopped", "local", "error"),
        summary("other-local", "local", "ready"),
        summary("main-local", "local", "ready", true),
      ],
      connect,
    )?.connectionId,
  ).toBe("main-local");
  expect(opened).toEqual(["main-local@3"]);
  // No ready local connection: nowhere to store the file.
  expect(
    askAttachmentClient(
      unplaced,
      null,
      [summary("remote", "ssh", "ready")],
      connect,
    ),
  ).toBeNull();
});

test("a remote asker whose leaf is gone keeps its own host, never the World host", () => {
  const { opened, connect } = opener();
  const remote = {
    actor: {
      label: "agent",
      verified: true,
      connection_id: "remote",
      pane_id: "pane-1",
      connection_generation: 2,
    },
  };
  // The SSH connection reconnected with a new generation: the same host.
  expect(
    askAttachmentClient(
      remote,
      null,
      [
        summary("main-local", "local", "ready", true),
        summary("remote", "ssh", "ready", false, 5),
      ],
      connect,
    )?.connectionId,
  ).toBe("remote");
  expect(opened).toEqual(["remote@5"]);
  // Its host is down: no upload rather than World-local paths it cannot open.
  for (const state of ["error", "connecting"] as const)
    expect(
      askAttachmentClient(
        remote,
        null,
        [
          summary("main-local", "local", "ready", true),
          summary("remote", "ssh", state, false, 5),
        ],
        connect,
      ),
    ).toBeNull();
  expect(
    askAttachmentClient(
      remote,
      null,
      [summary("main-local", "local", "ready", true)],
      connect,
    ),
  ).toBeNull();
  expect(opened).toEqual(["remote@5"]);
});
