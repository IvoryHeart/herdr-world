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

test("an unplaced asker's files go to the World host's ready local connection", () => {
  const summary = (
    id: string,
    type: "local" | "ssh",
    state: ConnectionSummary["state"],
    isDefault = false,
  ) =>
    ({
      id,
      label: id,
      source: "profile",
      is_default: isDefault,
      state,
      generation: 3,
      type,
    }) as ConnectionSummary;
  const opened: string[] = [];
  const connect = (id: string, generation: number) => {
    opened.push(`${id}@${generation}`);
    return { connectionId: id, isCurrent: () => true } as ConnectionClient;
  };
  expect(
    askAttachmentClient(
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
    askAttachmentClient(null, [summary("remote", "ssh", "ready")], connect),
  ).toBeNull();
});
