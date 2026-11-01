import { useState } from "react";
import { createRoot } from "react-dom/client";
import { bridge } from "../api";
import { AgentLauncherDialog } from "../world/AgentLauncherDialog";
import type { WorldObject } from "../world/worldObject";
import type { LaunchOutcome } from "../world/agentProfiles";
import "../styles/tokens.css";
import "../styles/base.css";

const failures: string[] = [];
const check = (value: boolean, message: string) => {
  if (!value) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
const world = {
  spaces: [
    {
      id: "alpha:room",
      connectionId: "alpha",
      generation: 7,
      nativeId: "room",
      label: "Demo room",
      hostLabel: "Demo host",
      actionable: true,
      stale: false,
    },
  ],
  leaves: [],
} as unknown as WorldObject;
const initial = { connectionId: "alpha", generation: 7, workspaceId: "room" };

async function run() {
  const originalConnection = bridge.connection;
  const originalCall = bridge.call;
  const opened: { connectionId: string; terminalId: string }[] = [];
  const targets: unknown[] = [];
  let starts = 0;
  let answer = Promise.withResolvers<LaunchOutcome>();
  bridge.call = async () => ({
    version: 1,
    revision: 1,
    profiles: [],
    assignments: [],
    chimes: {},
    town_master: null,
  });
  bridge.connection = (connectionId, generation) => {
    targets.push([connectionId, generation]);
    return {
      connectionId: connectionId!,
      generation: 1,
      serverRuntimeGeneration: generation ?? null,
      isCurrent: () => true,
      acceptsServerGeneration: () => true,
      call: async (method, params) => {
        check(
          params?.workspace_id === "room",
          `${method} must use the captured room`,
        );
        if (method === "launcher.catalog")
          return { kinds: ["codex"], skills: [], readiness: [] };
        if (method === "launcher.start") {
          starts++;
          return answer.promise;
        }
        throw new Error(`Unexpected ${method}`);
      },
    };
  };
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? (
      <AgentLauncherDialog
        world={world}
        initial={initial}
        onOpen={(terminal) => opened.push(terminal)}
        onEditProfiles={() => {}}
        onClose={() => setOpen(false)}
      />
    ) : (
      <p>Launcher closed</p>
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    for (const status of ["started", "sent", "uncertain", "failed"] as const) {
      answer = Promise.withResolvers<LaunchOutcome>();
      opened.length = 0;
      const before = starts;
      root.render(<Harness key={status} />);
      await settle();
      await settle();
      const start = container.querySelector<HTMLButtonElement>(
        ".agent-launcher-kind",
      )!;
      check(Boolean(start), `${status}: Codex must be offered`);
      start.click();
      await settle();
      check(
        start.disabled &&
          container.textContent?.includes("Starting Codex") === true,
        `${status}: retain the pending launch and prevent a duplicate start`,
      );
      answer.resolve({
        status,
        terminal_id: "new-terminal",
        message: `${status} fixture`,
      });
      await settle();
      await settle();
      const confirmed = status === "started" || status === "sent";
      check(
        Boolean(container.querySelector(".agent-launcher")) === !confirmed,
        `${status}: close only on a confirmed start`,
      );
      check(starts === before + 1, `${status}: start exactly once`);
      if (!confirmed) {
        check(
          container.textContent?.includes(`${status} fixture`) === true,
          `${status}: retain the reason`,
        );
        check(
          opened.length === 0,
          `${status}: do not automatically open an unconfirmed launch`,
        );
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent?.includes("Open its tab"))!
          .click();
        await settle();
        check(
          !container.querySelector(".agent-launcher"),
          `${status}: explicitly opening its tab closes the launcher`,
        );
      }
      check(
        JSON.stringify(opened) ===
          JSON.stringify([
            { connectionId: "alpha", terminalId: "new-terminal" },
          ]),
        `${status}: open only the returned terminal on its captured host`,
      );
    }
    check(
      targets.every((target) => JSON.stringify(target) === '["alpha",7]'),
      "Every catalog/start must retain its host and runtime generation",
    );
  } finally {
    root.unmount();
    container.remove();
    bridge.connection = originalConnection;
    bridge.call = originalCall;
  }
}
run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
