import { afterEach, expect, test } from "bun:test";
import {
  coreInstallFake,
  coreInstallHosts,
  resetCoreInstallFake,
} from "./coreInstall";

const globals = globalThis as Record<string, unknown>;

afterEach(() => {
  delete globals.location;
  delete globals.history;
  resetCoreInstallFake();
});

function page(href: string) {
  const replaced: string[] = [];
  globals.location = { href };
  globals.history = {
    state: null,
    replaceState: (_state: unknown, _title: string, url: URL) =>
      replaced.push(String(url)),
  };
  return replaced;
}

test("the testing switch is read once and dropped from the address", () => {
  const replaced = page(
    "https://world.example.com/?coreInstall=error&view=town",
  );
  expect(coreInstallFake()).toBe("error");
  expect(replaced).toEqual(["https://world.example.com/?view=town"]);
  globals.location = { href: "https://world.example.com/?view=town" };
  expect(coreInstallFake()).toBe("error");
  resetCoreInstallFake();
  page("https://world.example.com/?coreInstall");
  expect(coreInstallFake()).toBe("ok");
  resetCoreInstallFake();
  expect(page("https://world.example.com/")).toEqual([]);
  expect(coreInstallFake()).toBe(false);
});

test("hosts: this computer and each Unix SSH host once, minus ready cores", () => {
  const ssh = (destination: string, remote_platform?: "windows") => ({
    type: "ssh" as const,
    ssh_destination: destination,
    remote_platform,
  });
  expect(
    coreInstallHosts(
      [
        ssh("dev.example.com"),
        ssh("win.example.com", "windows"),
        {
          type: "local",
          ssh_destination: undefined,
          remote_platform: undefined,
        },
      ],
      [
        { ...ssh("dev.example.com"), state: "error" },
        { ...ssh("box.example.com"), state: "ready" },
      ],
    ),
  ).toEqual([
    { type: "local" },
    { type: "ssh", destination: "dev.example.com" },
  ]);
  expect(coreInstallHosts([], [{ type: "local", state: "ready" }])).toEqual([]);
});
