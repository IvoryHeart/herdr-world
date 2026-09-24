import { describe, expect, test } from "bun:test";
import {
  parseRemoteFileDelete,
  parseRemoteFileDownload,
  parseRemoteFileList,
  parseRemoteFilePreview,
  parseRemoteFileResolutions,
  parseRemoteFileUpload,
} from "./remote-files";

function b64(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

describe("remote file protocol parsers", () => {
  test("parses remote directory listings", () => {
    const result = parseRemoteFileList(
      [
        `ROOT\t${b64("/repo")}`,
        `ENTRY\tfile\t12\t2\t${b64("b.txt")}`,
        `ENTRY\tdirectory\t0\t1\t${b64("src")}`,
        "TRUNCATED",
      ].join("\n"),
      "packages/app",
    );

    expect(result).toEqual({
      root: "/repo",
      path: "packages/app",
      truncated: true,
      entries: [
        {
          name: "src",
          path: "packages/app/src",
          type: "directory",
          size: 0,
          mtime_ms: 1000,
          hidden: false,
        },
        {
          name: "b.txt",
          path: "packages/app/b.txt",
          type: "file",
          size: 12,
          mtime_ms: 2000,
          hidden: false,
        },
      ],
    });
  });

  test("parses text and image previews", () => {
    const text = parseRemoteFilePreview(
      `META\t${b64("/repo")}\t5\t9\t${b64("README.md")}\n${b64("hello")}`,
      "README.md",
    );
    expect(text).toMatchObject({
      root: "/repo",
      path: "README.md",
      text: "hello",
      binary: false,
      size: 5,
      mtime_ms: 9000,
      truncated: false,
    });

    const image = parseRemoteFilePreview(
      `META\t${b64("/repo")}\t3\t1\t${b64("image.png")}\n${b64("png")}`,
      "image.png",
    );
    expect(image).toMatchObject({
      path: "image.png",
      binary: true,
      mime_type: "image/png",
      image_data_url: "data:image/png;base64,cG5n",
    });
  });

  test("parses directory previews without content", () => {
    const directory = parseRemoteFilePreview(
      `META\t${b64("/repo")}\t0\t9\t${b64("packages/app")}\tdirectory`,
      "packages/app",
    );
    expect(directory).toMatchObject({
      root: "/repo",
      path: "packages/app",
      type: "directory",
      size: 0,
      mtime_ms: 9000,
      text: null,
      binary: false,
      truncated: false,
    });
  });

  test("parses resolved remote files", () => {
    expect(
      parseRemoteFileResolutions(
        [`FILE\t${b64("a/b/c.png")}`, `FILE\t${b64("/tmp/image.png")}`].join(
          "\n",
        ),
      ),
    ).toEqual(["a/b/c.png", "/tmp/image.png"]);
  });

  test("parses download, upload, and delete responses", () => {
    expect(
      parseRemoteFileDownload(
        `META\t4\t${b64("dir/a.txt")}\t${b64("a.txt")}\t${b64("text/plain")}\n${b64("data")}`,
        "dir/a.txt",
      ),
    ).toMatchObject({
      filename: "a.txt",
      path: "dir/a.txt",
      size: 4,
      contentType: "text/plain",
    });
    expect(parseRemoteFileUpload(`META\t${b64("dir/a.txt")}\t4\t1`)).toEqual({
      path: "dir/a.txt",
      size: 4,
      overwritten: true,
    });
    expect(parseRemoteFileDelete(`META\t${b64("dir")}\tdirectory`)).toEqual({
      path: "dir",
      type: "directory",
    });
  });

  test("rejects malformed remote protocol responses", () => {
    expect(() => parseRemoteFilePreview("oops", "x")).toThrow("oops");
    expect(() => parseRemoteFileDownload("oops", "x")).toThrow("oops");
    expect(() => parseRemoteFileUpload("oops")).toThrow("oops");
    expect(() => parseRemoteFileDelete("oops")).toThrow("oops");
  });
});
