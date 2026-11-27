import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resetCoreInstallFake } from "../coreInstall";
import { Confirm, CoreInstallPanel } from "./CoreInstall";

const globals = globalThis as Record<string, unknown>;

afterEach(() => {
  delete globals.location;
  delete globals.history;
  resetCoreInstallFake();
});

function page(href: string) {
  globals.location = { href };
  globals.history = { state: null, replaceState() {} };
}

const panel = () =>
  renderToStaticMarkup(
    createElement(CoreInstallPanel, {
      host: { type: "ssh", destination: "dev.example.com" },
      onClose() {},
    }),
  );

const confirm = (simulated: boolean, core: string | null = null) =>
  renderToStaticMarkup(
    createElement(Confirm, {
      where: "dev.example.com",
      probe: {
        target: "linux-x86_64",
        core,
        herdr: null,
        dir: "~/.local/bin",
        login: "systemd",
      },
      version: "0.1.22",
      session: "default",
      simulated,
      onConfirm() {},
      onCancel() {},
    }),
  );

test("the testing switch labels every install panel, real SSH hosts included", () => {
  page("https://world.example.com/?coreInstall=error");
  expect(panel()).toContain(
    "Test mode: nothing is installed, and this result is simulated.",
  );
  expect(confirm(true)).toContain("Simulate install and start (test)");
  expect(confirm(true, "/x/herdr-core")).toContain(
    "Simulate start and connect (test)",
  );
});

test("without the switch there are no test labels", () => {
  page("https://world.example.com/");
  expect(panel()).not.toContain("Test mode");
  const real = confirm(false);
  expect(real).toContain("Install and start");
  expect(real).not.toContain("Simulate");
});
