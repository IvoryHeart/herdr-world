import * as layoutPreferences from "./layoutPreferences";
import { describe, expect, spyOn, test } from "bun:test";
import {
  downloadFileFromUrl,
  chooseFileDownloadStrategy,
  filenameFromContentDisposition,
  isIosDevice,
  isStandaloneDisplay,
} from "./downloadFile";
import type { ConnectionClient } from "./api";

test("retired native-share downloads neither publish a blob nor reopen the request", async () => {
  const descriptors = ["navigator", "window"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const originalFetch = globalThis.fetch;
  const mobile = spyOn(layoutPreferences, "isMobileLayout").mockReturnValue(
    true,
  );
  const decoding = Promise.withResolvers<void>();
  const body = Promise.withResolvers<Blob>();
  let current = true;
  let publications = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: "iPhone",
      maxTouchPoints: 5,
      canShare: () => true,
      share: async () => {
        publications++;
      },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      matchMedia: () => ({ matches: false }),
      open: () => {
        publications++;
      },
    },
  });
  const response = new Response("synthetic", {
    headers: {
      "X-Herdr-Connection-Id": "alpha",
      "X-Herdr-Connection-Generation": "7",
    },
  });
  response.blob = () => {
    decoding.resolve();
    return body.promise;
  };
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
  const client = {
    connectionId: "alpha",
    generation: 10,
    serverRuntimeGeneration: 7,
    isCurrent: () => current,
    acceptsServerGeneration: () => true,
    call: async () => undefined,
  } satisfies ConnectionClient;
  try {
    const pending = downloadFileFromUrl({
      url: "/api/connections/alpha/file/download?connection_generation=7",
      filename: "synthetic.txt",
      client,
    });
    await decoding.promise;
    current = false;
    body.resolve(new Blob(["synthetic"]));
    await expect(pending).rejects.toThrow();
    expect(publications).toBe(0);
  } finally {
    mobile.mockRestore();
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test.each(["healthy", "retired", "mismatched", "rejected", "cancelled"])(
  "qualified native-share fallback: %s",
  async (scenario) => {
    const descriptors = ["navigator", "window"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
    );
    const previousFetch = globalThis.fetch;
    const mobile = spyOn(layoutPreferences, "isMobileLayout").mockReturnValue(
      true,
    );
    let current = true;
    const opened: string[] = [];
    let shares = 0;
    const url = "/api/connections/alpha/file/download?connection_generation=7";
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent: "iPhone",
        maxTouchPoints: 5,
        canShare: () => true,
        share: async () => {
          shares++;
          if (scenario === "retired") current = false;
          throw scenario === "cancelled"
            ? new DOMException("Dismissed", "AbortError")
            : new TypeError("Cannot share actual file");
        },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        matchMedia: () => ({ matches: false }),
        open: (path: string) => {
          opened.push(path);
          return {};
        },
      },
    });
    globalThis.fetch = (async () =>
      new Response("synthetic", {
        status: scenario === "rejected" ? 404 : 200,
        headers: {
          "X-Herdr-Connection-Id": scenario === "mismatched" ? "beta" : "alpha",
          "X-Herdr-Connection-Generation": "7",
        },
      })) as unknown as typeof fetch;
    const client: ConnectionClient = {
      connectionId: "alpha",
      generation: 10,
      serverRuntimeGeneration: 7,
      isCurrent: () => current,
      acceptsServerGeneration: () => true,
      call: async () => undefined,
    };
    try {
      const pending = downloadFileFromUrl({
        url,
        filename: "synthetic.txt",
        client,
      });
      if (scenario === "healthy") {
        expect(await pending).toBe("opened");
        expect(opened).toEqual([url]);
      } else if (scenario === "cancelled") {
        expect(await pending).toBe("shared");
        expect(opened).toEqual([]);
      } else {
        await expect(pending).rejects.toThrow();
        expect(opened).toEqual([]);
      }
      expect(shares).toBe(
        scenario === "mismatched" || scenario === "rejected" ? 0 : 1,
      );
    } finally {
      mobile.mockRestore();
      globalThis.fetch = previousFetch;
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  },
);

describe("isIosDevice", () => {
  test("detects iPhones, iPads, and iPads reporting as Macintosh", () => {
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  test("rejects desktop browsers", () => {
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });
});

describe("isStandaloneDisplay", () => {
  test("accepts the media query or the iOS navigator flag", () => {
    expect(isStandaloneDisplay(true, undefined)).toBe(true);
    expect(isStandaloneDisplay(false, true)).toBe(true);
    expect(isStandaloneDisplay(false, false)).toBe(false);
    expect(isStandaloneDisplay(false, undefined)).toBe(false);
  });
});

describe("filenameFromContentDisposition", () => {
  test("prefers the extended UTF-8 filename", () => {
    expect(
      filenameFromContentDisposition(
        `attachment; filename="fallback.jsonl"; filename*=UTF-8''${encodeURIComponent("会话 1.jsonl")}`,
      ),
    ).toBe("会话 1.jsonl");
  });

  test("falls back to the quoted filename and rejects junk", () => {
    expect(
      filenameFromContentDisposition('attachment; filename="a.jsonl"'),
    ).toBe("a.jsonl");
    expect(filenameFromContentDisposition("attachment")).toBeNull();
    expect(filenameFromContentDisposition(null)).toBeNull();
    expect(filenameFromContentDisposition(undefined)).toBeNull();
    // Malformed percent-encoding falls through instead of throwing.
    expect(
      filenameFromContentDisposition("filename*=UTF-8''%E0%A4%A"),
    ).toBeNull();
  });
});

describe("chooseFileDownloadStrategy", () => {
  test("prefers the native share sheet on iOS when files can be shared", () => {
    for (const env of [
      { canShareFiles: true, standalone: true, ios: true },
      { canShareFiles: true, standalone: false, ios: true },
    ]) {
      expect(chooseFileDownloadStrategy(env)).toBe("share");
    }
  });

  test("opens a new browsing context on iOS or in a PWA without share", () => {
    for (const env of [
      { canShareFiles: false, standalone: true, ios: false },
      { canShareFiles: false, standalone: false, ios: true },
      { canShareFiles: false, standalone: true, ios: true },
    ]) {
      expect(chooseFileDownloadStrategy(env)).toBe("new-context");
    }
  });

  test("keeps the non-iOS standalone fallback when Mobile layout is forced", () => {
    // Layout gating is covered by downloadFile.browser.test.ts. This helper
    // handles device fallbacks only after the app has selected Mobile layout.
    expect(
      chooseFileDownloadStrategy({
        canShareFiles: true,
        standalone: true,
        ios: false,
      }),
    ).toBe("new-context");
  });

  test("keeps the anchor fallback for non-iOS mobile browsers", () => {
    expect(
      chooseFileDownloadStrategy({
        canShareFiles: false,
        standalone: false,
        ios: false,
      }),
    ).toBe("anchor");
  });

  test("does not add sharing to non-iOS browsers in Mobile layout", () => {
    // macOS Safari reports navigator.canShare support for files; the share
    // sheet is still not the expected desktop download path.
    expect(
      chooseFileDownloadStrategy({
        canShareFiles: true,
        standalone: false,
        ios: false,
      }),
    ).toBe("anchor");
  });
});
