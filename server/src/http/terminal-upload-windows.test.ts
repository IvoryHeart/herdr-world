import { expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerminalUploadHandler } from "./terminal-upload";
import {
  WINDOWS_UPLOAD_PATH,
  windowsRemoteCleanupCommand,
  windowsRemoteUploadCommand,
  windowsUploadPath,
} from "./terminal-upload-windows";

/** The PowerShell script inside a `powershell.exe -EncodedCommand` line. */
function script(command: string): string {
  const match = command.match(
    /^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/,
  );
  expect(match).not.toBeNull();
  return Buffer.from(match![1]!, "base64").toString("utf16le");
}

test("the Windows upload is one fixed script whose only inputs are a base64 name and the retention", () => {
  const command = windowsRemoteUploadCommand("shot.png", 1440);
  expect(command.length).toBeLessThanOrEqual(8191);
  const text = script(command);
  // The name is never quoted into the script: base64 only.
  expect(text).not.toContain("shot.png");
  expect(text).toContain(
    `FromBase64String('${Buffer.from("shot.png").toString("base64")}')`,
  );
  expect(text).toContain("AddMinutes(-1440)");
  // A private root per user: a protected ACL for this user alone, and an
  // existing root checked for reparse points, owner and grants.
  expect(text).toContain("'herdr-world-uploads-'+$u.Value");
  expect(text).toContain("SetAccessRuleProtection($true,$false)");
  expect(text).toContain("$i.Attributes -band 1024");
  expect(text).toContain("'S-1-5-18','S-1-5-32-544'");
  // A new file in a new directory, raw stdin; nothing is run.
  expect(text).toContain("'CreateNew','Write','None'");
  expect(text).toContain("[Console]::OpenStandardInput().CopyTo($f,65536)");
  expect(text).not.toMatch(/Start-Process|Invoke-Expression|iex |& /);
  // Never `$input`: PowerShell would then read stdin as objects.
  expect(text).not.toMatch(/\$input\b/i);
  // The path goes back as base64 of UTF-8, never in the console's code page.
  expect(text).toContain(
    "[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p)))",
  );
  expect(text).not.toContain("[Console]::Out.Write($p)");
  const cleanup = script(windowsRemoteCleanupCommand(60));
  expect(cleanup).toContain("AddMinutes(-60)");
  expect(cleanup).not.toContain("OpenStandardInput");
});

test.each(["../x", "a b.txt", "", "x".repeat(121), "C:\\x"])(
  "the Windows upload refuses the unsanitized name %p",
  (name) => {
    expect(() => windowsRemoteUploadCommand(name, 60)).toThrow(
      "invalid upload name",
    );
  },
);

test("only a staged path under the private root is accepted", () => {
  const ok =
    "C:\\Users\\agent\\AppData\\Local\\Temp\\herdr-world-uploads-S-1-5-21-9-1001\\upload-a1b2c3d4e5f\\notes.txt";
  expect(WINDOWS_UPLOAD_PATH.test(ok)).toBe(true);
  for (const path of [
    "/tmp/herdr-world-uploads-1000/upload-x/notes.txt",
    "\\\\server\\share\\herdr-world-uploads-S-1-5\\upload-a\\n.txt",
    `${ok}\r\n`,
    ok.replace("notes.txt", "..\\evil.txt"),
    ok.replace("upload-a1b2c3d4e5f", "other"),
  ])
    expect(WINDOWS_UPLOAD_PATH.test(path)).toBe(false);
});

test("a Windows SSH upload that prints no staged path fails and keeps nothing", async () => {
  const temp = await mkdtemp(join(tmpdir(), "terminal-upload-win-"));
  const originalSpawn = Bun.spawn;
  type SpawnOptions = NonNullable<Parameters<typeof Bun.spawn>[1]>;
  const commands: string[] = [];
  const spawn = spyOn(Bun, "spawn").mockImplementation(((
    command: string[],
    options: SpawnOptions,
  ) => {
    commands.push(command[command.length - 1]!);
    return originalSpawn(
      [process.execPath, "-e", "process.stdout.write('/tmp/elsewhere')"],
      options,
    );
  }) as typeof Bun.spawn);
  try {
    const handle = createTerminalUploadHandler({
      sshHost: () => "windows.example.invalid",
      remoteWindows: true,
      tempRoot: () => temp,
    });
    const response = await handle(
      new Request("http://localhost/api/terminal-upload", {
        method: "POST",
        body: "payload",
      }),
      "CON.txt",
    );
    expect(response.status).toBe(502);
    // Named for Windows: a reserved device name gets a prefix.
    expect(script(commands[0]!)).toContain(
      Buffer.from("_CON.txt").toString("base64"),
    );
    expect(
      await readdir(
        join(temp, `herdr-world-uploads-${process.getuid?.() ?? "user"}`),
      ),
    ).toEqual([]);
  } finally {
    spawn.mockRestore();
    await rm(temp, { recursive: true, force: true });
  }
});

const NON_ASCII_STAGED =
  "C:\\Users\\J\u00f6rg\\AppData\\Local\\Temp\\herdr-world-uploads-S-1-5-21-9-1001\\upload-a1b2c3d4e5f\\shot.png";

test("the staged path is read only as base64 of valid UTF-8 under the private root", () => {
  const encode = (text: string) => Buffer.from(text, "utf8").toString("base64");
  expect(windowsUploadPath(encode(NON_ASCII_STAGED))).toBe(NON_ASCII_STAGED);
  for (const output of [
    // The raw path, as Console.Out printed it before.
    NON_ASCII_STAGED,
    // The same path in code page 437, as a UTF-8 reader would see it.
    NON_ASCII_STAGED.replace("\u00f6", "\ufffd"),
    `${encode(NON_ASCII_STAGED)}\r\n`,
    encode(NON_ASCII_STAGED).replace(/=+$/, ""),
    Buffer.from([0x43, 0x3a, 0x5c, 0x94]).toString("base64"),
    encode("C:\\Users\\agent\\elsewhere\\shot.png"),
    "",
  ])
    expect(windowsUploadPath(output)).toBeUndefined();
});

test("a Windows SSH upload under a non-ASCII profile returns the exact staged path", async () => {
  const temp = await mkdtemp(join(tmpdir(), "terminal-upload-win-"));
  const originalSpawn = Bun.spawn;
  type SpawnOptions = NonNullable<Parameters<typeof Bun.spawn>[1]>;
  const printed = Buffer.from(NON_ASCII_STAGED, "utf8").toString("base64");
  const spawn = spyOn(Bun, "spawn").mockImplementation(((
    _command: string[],
    options: SpawnOptions,
  ) =>
    originalSpawn(
      [
        process.execPath,
        "-e",
        `await new Response(Bun.stdin.stream()).arrayBuffer(); process.stdout.write(${JSON.stringify(printed)})`,
      ],
      options,
    )) as typeof Bun.spawn);
  try {
    const handle = createTerminalUploadHandler({
      sshHost: () => "windows.example.invalid",
      remoteWindows: true,
      tempRoot: () => temp,
    });
    const response = await handle(
      new Request("http://localhost/api/terminal-upload", {
        method: "POST",
        body: "payload",
      }),
      "shot.png",
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { path: string }).path).toBe(
      NON_ASCII_STAGED,
    );
  } finally {
    spawn.mockRestore();
    await rm(temp, { recursive: true, force: true });
  }
});
