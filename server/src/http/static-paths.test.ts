import { describe, expect, test } from "bun:test";
import {
  canonicalStaticPathname,
  decodeStaticPathname,
  isStaticRequestMethod,
  resolvePublicFilePath,
  shouldServeSpaEntry,
} from "./static-paths";

describe("static file paths", () => {
  test("normalizes the entry document and decodes asset paths", () => {
    expect(decodeStaticPathname("/")).toBe("/index.html");
    expect(decodeStaticPathname("/assets/app%20icon.svg")).toBe(
      "/assets/app icon.svg",
    );
  });

  test("canonical paths name the resolved file and refuse escapes", () => {
    const root = "/srv/world/public";
    expect(canonicalStaticPathname(root, "/assets/app.js")).toBe(
      "/assets/app.js",
    );
    expect(canonicalStaticPathname(root, "/assets/../index.html")).toBe(
      "/index.html",
    );
    expect(canonicalStaticPathname(root, "/assets/./x/../app.js")).toBe(
      "/assets/app.js",
    );
    expect(canonicalStaticPathname(root, "/assets/../../outside.js")).toBe(
      null,
    );
  });

  test("rejects malformed encoding and NUL bytes", () => {
    expect(decodeStaticPathname("/%E0%A4%A")).toBeNull();
    expect(decodeStaticPathname("/asset%00.js")).toBeNull();
  });

  test("keeps resolved files inside the public directory", () => {
    expect(resolvePublicFilePath("/srv/public", "/assets/app.js")).toBe(
      "/srv/public/assets/app.js",
    );
    expect(resolvePublicFilePath("/srv/public", "/../secret")).toBeNull();
  });

  test("uses the SPA entry only for browser page navigations", () => {
    expect(shouldServeSpaEntry("GET", "text/html,application/xhtml+xml")).toBe(
      true,
    );
    expect(shouldServeSpaEntry("HEAD", "text/html")).toBe(true);
    expect(shouldServeSpaEntry("GET", "*/*")).toBe(false);
    expect(shouldServeSpaEntry("POST", "text/html")).toBe(false);
  });

  test("only serves static content for read-only HTTP methods", () => {
    expect(isStaticRequestMethod("GET")).toBe(true);
    expect(isStaticRequestMethod("HEAD")).toBe(true);
    expect(isStaticRequestMethod("POST")).toBe(false);
  });
});
