import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { bridge, type ConnectionClient } from "../api";
import * as connectionHook from "../useConnectionClient";
import {
  parseWorldIntegrations,
  worldChangePrompt,
  type WorldIntegration,
} from "../worldIntegrations";
import { AgentIntegrationsSettings } from "./AgentIntegrationsSettings";

const codex: WorldIntegration = {
  harness: "codex",
  state: "not_installed",
  path: "~/.agents/skills/herdr-world/SKILL.md",
  available_version: 1,
  shared_with: ["pi", "kimi"],
};
const omp: WorldIntegration = {
  harness: "omp",
  state: "unsupported",
  reason: "no documented skill folder",
  available_version: 1,
  shared_with: [],
};
const labels: Record<string, string> = {
  codex: "Codex",
  pi: "Pi",
  kimi: "Kimi",
};

if (process.env.HERDR_WORLD_INTEGRATION_DOM_TEST !== "1") {
  test("uninstalling the shared file names every harness that loses it", () => {
    const label = (name: string) => labels[name] ?? name;
    const current = { ...codex, state: "current" as const, version: 1 };
    expect(worldChangePrompt(current, "uninstall", label)).toBe(
      "Uninstall World's skill for Codex?\n\nThis deletes ~/.agents/skills/herdr-world/SKILL.md." +
        " Codex, Pi and Kimi share this file, so Pi and Kimi lose it too." +
        " Herdr's own integration is not changed.",
    );
    expect(
      worldChangePrompt(
        { ...current, harness: "claude", shared_with: [] },
        "uninstall",
        label,
      ),
    ).not.toContain("share");
    expect(parseWorldIntegrations({ integrations: [codex, omp] })).toEqual([
      codex,
      omp,
    ]);
    expect(() =>
      parseWorldIntegrations({ integrations: [{ ...codex, path: undefined }] }),
    ).toThrow();
    expect(() =>
      parseWorldIntegrations({ integrations: [{ ...omp, state: "gone" }] }),
    ).toThrow();
  });

  test("World skill rows in an isolated DOM runtime", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, HERDR_WORLD_INTEGRATION_DOM_TEST: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
  }, 15_000);
} else {
  let root: Root | undefined;
  let host: HTMLDivElement;
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    host?.remove();
    mock.restore();
  });

  const herdr = (target: string, label: string) => ({
    target,
    label,
    command: target,
    available: true,
    state: "not_installed",
  });
  const client = {
    connectionId: "synthetic",
    generation: 1,
    serverRuntimeGeneration: 1,
    call: async () => ({
      integrations: [
        herdr("codex", "Codex"),
        herdr("omp", "OMP"),
        herdr("pi", "Pi"),
        herdr("kimi", "Kimi"),
      ],
    }),
    isCurrent: () => true,
    acceptsServerGeneration: (value: number) => value === 1,
  } as unknown as ConnectionClient;

  // The preloaded DOM has no confirm(); install one per test.
  const confirm = (answer: (text: string) => boolean) =>
    Object.defineProperty(window, "confirm", {
      value: (text?: string) => answer(text ?? ""),
      configurable: true,
      writable: true,
    });

  async function render(sshDestination?: string) {
    spyOn(connectionHook, "useConnectionClient").mockReturnValue(client);
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () =>
      root!.render(
        createElement(AgentIntegrationsSettings, {
          connectionLabel: "Synthetic host",
          sshDestination,
        }),
      ),
    );
  }

  test("each Herdr harness row carries World's status, path and actions", async () => {
    let installed = false;
    const calls: unknown[][] = [];
    spyOn(bridge, "call").mockImplementation((async (
      method: string,
      params?: unknown,
    ) => {
      calls.push([method, params]);
      if (method === "world.integration.install") installed = true;
      if (method === "world.integration.uninstall") installed = false;
      const shared = (harness: string) => ({
        ...codex,
        harness,
        shared_with: ["codex", "pi", "kimi"].filter((name) => name !== harness),
        ...(installed ? { state: "current", version: 1 } : {}),
      });
      return {
        integrations: [shared("codex"), omp, shared("pi"), shared("kimi")],
      };
    }) as typeof bridge.call);
    const prompts: string[] = [];
    confirm((text) => {
      prompts.push(text);
      return true;
    });
    await render();
    const row = (label: string) =>
      [...host.querySelectorAll("li")].find(
        (li) => li.querySelector("strong")?.textContent === label,
      )!;
    const world = (label: string) =>
      row(label).querySelector(".agent-integrations-world")!;
    expect(world("Codex").textContent).toContain("Not installed");
    expect(world("Codex").textContent).toContain(
      "~/.agents/skills/herdr-world/SKILL.md",
    );
    expect(world("Codex").textContent).toContain("Shared with Pi and Kimi");
    expect(world("OMP").textContent).toContain(
      "Unsupported: no documented skill folder",
    );
    expect(world("OMP").querySelector("button")).toBeNull();

    await act(async () =>
      world("Codex")
        .querySelector<HTMLButtonElement>(
          '[aria-label="Install World skill for Codex"]',
        )!
        .click(),
    );
    expect(calls).toContainEqual([
      "world.integration.install",
      { harness: "codex" },
    ]);
    expect(world("Codex").textContent).toContain("Current (v1)");
    expect(world("Kimi").textContent).toContain("Current (v1)");

    await act(async () =>
      world("Kimi")
        .querySelector<HTMLButtonElement>(
          '[aria-label="Uninstall World skill for Kimi"]',
        )!
        .click(),
    );
    expect(prompts[prompts.length - 1]).toContain(
      "so Codex and Pi lose it too",
    );
    expect(calls).toContainEqual([
      "world.integration.uninstall",
      { harness: "kimi" },
    ]);
    expect(world("Codex").textContent).toContain("Not installed");
  });

  test("a refused confirmation changes nothing; SSH hosts show no World rows", async () => {
    const call = spyOn(bridge, "call").mockImplementation((async () => ({
      integrations: [codex, omp],
    })) as typeof bridge.call);
    confirm(() => false);
    await render();
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Install World skill for Codex"]',
        )!
        .click(),
    );
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      "world.integration.list",
    ]);
    await act(async () => root!.unmount());
    root = undefined;
    host.remove();
    call.mockClear();
    await render("synthetic.example");
    expect(call).not.toHaveBeenCalled();
    expect(host.querySelector(".agent-integrations-world")).toBeNull();
    expect(host.textContent).toContain("local host only");
  });
}
