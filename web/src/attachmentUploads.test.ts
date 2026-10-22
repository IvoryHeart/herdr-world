import { expect, test } from "bun:test";
import {
  attachmentUploads,
  retryAttachmentUpload,
  startAttachmentUploads,
} from "./attachmentUploads";

function deferred() {
  let resolve!: (text: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const file = (name: string) =>
  new File([name], name, { type: "text/plain", lastModified: 1 });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a failed file picked again behind a running upload is queued once", async () => {
  const scope = "test\u0000queued-retry";
  const calls: { name: string; result: ReturnType<typeof deferred> }[] = [];
  const task = (picked: File) => {
    const result = deferred();
    calls.push({ name: picked.name, result });
    return result.promise;
  };
  const failed = startAttachmentUploads(scope, [file("a.txt")], task);
  calls[0]!.result.reject(new Error("disk full"));
  await failed;
  const chip = (name: string) =>
    attachmentUploads(scope).find((upload) => upload.name === name)!;
  expect(chip("a.txt").status).toBe("failed");

  // b.txt runs first; a.txt waits behind it.
  const batch = startAttachmentUploads(
    scope,
    [file("b.txt"), file("a.txt")],
    task,
  );
  await settle();
  expect(calls.map((call) => call.name)).toEqual(["a.txt", "b.txt"]);
  // The waiting file is queued, not failed: Retry is not offered for it,
  // and neither Retry nor picking it again starts another upload.
  expect(chip("a.txt").status).toBe("uploading");
  retryAttachmentUpload(scope, chip("a.txt").id);
  void startAttachmentUploads(scope, [file("a.txt")], task);
  await settle();
  expect(calls.length).toBe(2);

  calls[1]!.result.resolve("/uploads/b.txt ");
  await settle();
  expect(calls.map((call) => call.name)).toEqual(["a.txt", "b.txt", "a.txt"]);
  calls[2]!.result.resolve("/uploads/a.txt ");
  await batch;
  expect(calls.length).toBe(3);
  expect(chip("a.txt").status).toBe("done");
  expect(attachmentUploads(scope).length).toBe(2);
});

test("a second Retry while the first runs is refused", async () => {
  const scope = "test\u0000double-retry";
  const calls: ReturnType<typeof deferred>[] = [];
  const task = () => {
    const result = deferred();
    calls.push(result);
    return result.promise;
  };
  const first = startAttachmentUploads(scope, [file("c.txt")], task);
  calls[0]!.reject(new Error("offline"));
  await first;
  const id = attachmentUploads(scope)[0]!.id;
  retryAttachmentUpload(scope, id);
  retryAttachmentUpload(scope, id);
  await settle();
  expect(calls.length).toBe(2);
  calls[1]!.resolve("/uploads/c.txt ");
});
