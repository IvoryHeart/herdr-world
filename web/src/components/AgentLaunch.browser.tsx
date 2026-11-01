import { useState } from "react";
import { STARTER_PROFILES } from "../../../shared/agentProfile";
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
    profiles: STARTER_PROFILES,
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
          return {
            kinds: [
              "codex",
              ...Array.from({ length: 27 }, (_, index) => `absent-${index}`),
            ],
            skills: [],
            readiness: [
              "codex",
              ...Array.from({ length: 27 }, (_, index) => `absent-${index}`),
            ].map((kind) => ({
              kind,
              installed: kind === "codex",
              logged_in: kind === "codex",
              can_log_in: false,
              probe: {
                source: "world-harness-probe",
                state: "ok",
                reason: "complete",
                observed_at: 0,
              },
            })),
          };
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
        status === "uncertain"
          ? 'button[aria-label="Start Reviewer"]'
          : ".agent-launcher-kind",
      )!;
      check(Boolean(start), `${status}: Codex must be offered`);
      start.click();
      start.click();
      await settle();
      check(
        start.disabled && container.textContent?.includes("Starting") === true,
        `${status}: retain the pending launch and prevent a duplicate start`,
      );
      const visibleStatus = () => {
        const dialog = container
          .querySelector(".agent-launcher")!
          .getBoundingClientRect();
        const status = container
          .querySelector(".agent-launcher-status")!
          .getBoundingClientRect();
        return (
          status.height > 0 &&
          status.top >= dialog.top &&
          status.bottom <= dialog.bottom
        );
      };
      check(
        visibleStatus(),
        `${status}: pending status must be visible without scrolling past harness probes`,
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
          start.disabled,
          `${status}: an existing attempt must not re-arm any start choice`,
        );
        start.click();
        await settle();
        check(
          starts === before + 1,
          `${status}: clicking again must not create a second agent`,
        );
        check(
          visibleStatus(),
          `${status}: outcome and Open its tab must be visible without scrolling`,
        );
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
