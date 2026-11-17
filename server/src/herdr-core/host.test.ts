import { describe, expect, test } from "bun:test";
import {
  resolveCoreExecutable,
  WINDOWS_EXECUTABLE_MARKER,
  windowsExecutableScript,
  type CoreHost,
} from "./host";

const windows = (stdout: string, code = 0): CoreHost => ({
  windows: true,
  run: async () => ({ code, stdout }),
});
const found = (path: string) => `${WINDOWS_EXECUTABLE_MARKER}${path}\r\n`;

describe("a harness's executable on a Windows core host", () => {
  test("the script takes only a validated name, encoded, and runs nothing", () => {
    const script = windowsExecutableScript("claude");
    expect(script).toContain(Buffer.from("claude").toString("base64"));
    expect(script).not.toContain("'claude'");
    expect(script).not.toMatch(/Start-Process|Invoke-|&\s*\$|iex/i);
    for (const bad of ["clau*de", "a b", "../x", "", "x;y"])
      expect(() => windowsExecutableScript(bad)).toThrow();
  });

  test("an absolute drive path to an .exe or npm .cmd is accepted", async () => {
    const exe = "C:\\Users\\example\\.local\\bin\\claude.exe";
    expect(
      await resolveCoreExecutable(windows(`motd\r\n${found(exe)}`), "claude"),
    ).toBe(exe);
    const cmd = "D:\\Tools\\npm\\codex.cmd";
    expect(await resolveCoreExecutable(windows(found(cmd)), "codex")).toBe(cmd);
  });

  test("anything else is not an executable World starts", async () => {
    for (const stdout of [
      "",
      "C:\\Tools\\claude.exe\r\n", // no marker
      found("claude.exe"), // relative
      found("\\\\server\\share\\claude.exe"), // a network share
      found("C:\\Tools\\claude.ps1"),
      found('C:\\To"ols\\claude.exe'),
      found("C:\\Tools\\..\\claude.exe:stream"),
    ])
      await expect(
        resolveCoreExecutable(windows(stdout), "claude"),
      ).rejects.toThrow("no claude executable");
    await expect(
      resolveCoreExecutable(windows(found("C:\\a\\claude.exe"), 1), "claude"),
    ).rejects.toThrow("no claude executable");
  });
});
