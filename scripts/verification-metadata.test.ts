import { expect, test } from "bun:test";
import { runVerificationMetadata } from "./verification-process";

const unixTest = process.platform === "win32" ? test.skip : test;

unixTest(
  "cold metadata startup can exceed five seconds and retain its identity",
  async () => {
    const result = await runVerificationMetadata([
      process.execPath,
      "-e",
      'await Bun.sleep(5500); console.log("synthetic-node-version"); console.error("synthetic-java-version")',
    ]);
    expect(result.stdout.trim()).toBe("synthetic-node-version");
    expect(result.stderr.trim()).toBe("synthetic-java-version");
  },
  15000,
);

unixTest(
  "unsuccessful metadata reports the exact probe and refuses evidence",
  async () => {
    await expect(
      runVerificationMetadata([
        process.execPath,
        "-e",
        'console.error("synthetic refusal"); process.exit(7)',
      ]),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        `Verification metadata command ${process.execPath} -e`,
      ),
      cause: expect.objectContaining({ message: "exit 7: synthetic refusal" }),
    });
  },
);

unixTest("metadata cancellation remains a labelled failure", async () => {
  const controller = new AbortController();
  await expect(
    runVerificationMetadata(
      [
        process.execPath,
        "-e",
        'console.log("ready"); setInterval(()=>{},1000)',
      ],
      {
        signal: controller.signal,
        onOutput: () => controller.abort(),
      },
    ),
  ).rejects.toMatchObject({
    message: expect.stringContaining("Verification metadata command"),
    cause: expect.objectContaining({ reason: "aborted" }),
  });
});
