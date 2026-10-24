import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeInstallerFixture } from "./installer-upgrade";
import { withNativePluginFixture } from "./plugin-native-fixture";

test("native fixture waits for its body and cleanup before reporting success", async () => {
  const calls: string[] = [];
  let release!: () => void;
  let started!: () => void;
  const cleanupStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const cleanupReleased = new Promise<void>((resolve) => {
    release = resolve;
  });
  let settled = false;
  const task = withNativePluginFixture(
    "synthetic-root",
    async () => {
      await Bun.sleep(0);
      calls.push("body complete");
      return 7;
    },
    async (root) => {
      calls.push(`cleanup ${root}`);
      started();
      await cleanupReleased;
      calls.push("cleanup complete");
    },
  ).then((value) => {
    settled = true;
    return value;
  });
  try {
    await cleanupStarted;
    expect(calls).toEqual(["body complete", "cleanup synthetic-root"]);
    expect(settled).toBe(false);
  } finally {
    release();
  }
  expect(await task).toBe(7);
  expect(calls.at(-1)).toBe("cleanup complete");
});

test("native fixture preserves a body failure after successful cleanup", async () => {
  const failure = new Error("synthetic body failure");
  let cleaned = false;
  await expect(
    withNativePluginFixture(
      "synthetic-root",
      () => {
        throw failure;
      },
      async () => {
        cleaned = true;
      },
    ),
  ).rejects.toBe(failure);
  expect(cleaned).toBe(true);
});

test.each(["EBUSY", "EINVAL"])(
  "native fixture propagates cleanup %s without adding another retry policy",
  async (code) => {
    const failure = Object.assign(new Error("synthetic cleanup failure"), {
      code,
    });
    let calls = 0;
    await expect(
      withNativePluginFixture(
        "synthetic-root",
        () => "body complete",
        async () => {
          calls++;
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    expect(calls).toBe(1);
  },
);

test.each([new Error("synthetic assertion failure"), undefined])(
  "native fixture retains both body and cleanup failures (%s)",
  async (bodyFailure) => {
    const cleanupFailure = Object.assign(new Error("synthetic locked root"), {
      code: "EBUSY",
    });
    let failure: unknown;
    try {
      await withNativePluginFixture(
        "synthetic-root",
        async () => {
          throw bodyFailure;
        },
        async () => {
          throw cleanupFailure;
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    const errors = (failure as AggregateError).errors;
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBe(bodyFailure);
    expect(errors[1]).toBe(cleanupFailure);
    expect((failure as AggregateError).cause).toBe(cleanupFailure);
  },
);

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "native fixture yields until a transient filesystem lock releases and rejects persistent denial",
  async () => {
    for (const transient of [true, false]) {
      const root = mkdtempSync(join(tmpdir(), "native-plugin-cleanup-"));
      const nested = join(root, "nested");
      const file = join(nested, "held.txt");
      mkdirSync(nested);
      writeFileSync(file, "synthetic fixture");
      chmodSync(nested, 0o500);
      let release: ReturnType<typeof setTimeout> | undefined;
      try {
        if (transient) {
          release = setTimeout(() => chmodSync(nested, 0o700), 150);
          expect(await withNativePluginFixture(root, () => 7)).toBe(7);
          expect(existsSync(root)).toBe(false);
        } else {
          await expect(
            withNativePluginFixture(root, () => 7),
          ).rejects.toHaveProperty("code", "EACCES");
          expect(existsSync(file)).toBe(true);
        }
      } finally {
        if (release) clearTimeout(release);
        if (existsSync(nested)) chmodSync(nested, 0o700);
        await removeInstallerFixture(root);
      }
    }
  },
  5_000,
);
