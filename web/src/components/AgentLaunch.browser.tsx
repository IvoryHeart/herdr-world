import { useState } from "react";
import { createRoot } from "react-dom/client";
import { STARTER_PROFILES } from "../../../shared/agentProfile";
import { bridge } from "../api";
import { store } from "../store";
import { AgentLauncherDialog } from "../world/AgentLauncherDialog";
import type { LaunchOutcome } from "../world/agentProfiles";
import type { WorldObject } from "../world/worldObject";
import "../styles/tokens.css";
import "../styles/base.css";

const failures: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 160));
const initial = { connectionId: "alpha", generation: 7, workspaceId: "room" };
const world = {
  spaces: [
    {
      ...initial,
      id: "alpha:room",
      nativeId: "room",
      label: "Demo room",
      hostLabel: "Demo host",
      actionable: true,
    },
  ],
} as unknown as WorldObject;
async function run() {
  const previous = {
    connection: bridge.connection,
    call: bridge.call,
    create: store.createQualifiedTab,
  };
  let starts = 0,
    includeLogin = false;
  let answer = Promise.withResolvers<LaunchOutcome>();
  let login = Promise.withResolvers<{ terminal_id: string; command: string }>();
  const opened: Array<{
    connectionId: string;
    runtimeGeneration: number;
    terminalId: string;
  }> = [];
  bridge.call = async () => ({
    version: 1,
    revision: 1,
    profiles: STARTER_PROFILES,
    assignments: [],
    chimes: {},
    town_master: null,
  });
  bridge.connection = (id, generation) => {
    check(
      id === "alpha" && generation === 7,
      "Every operation retains its captured host/runtime",
    );
    return {
      connectionId: id!,
      generation: 1,
      serverRuntimeGeneration: generation ?? null,
      isCurrent: () => true,
      acceptsServerGeneration: () => true,
      call: async (method, params) => {
        check(
          params?.workspace_id === "room",
          "Every operation retains its room",
        );
        if (method === "launcher.start") {
          starts++;
          return answer.promise;
        }
        if (method === "launcher.login") return login.promise;
        if (method !== "launcher.catalog") throw Error(`Unexpected ${method}`);
        const kinds = [
          "codex",
          ...(includeLogin ? ["claude"] : []),
          ...Array.from({ length: 27 }, (_, i) => `absent-${i}`),
        ];
        return {
          kinds,
          skills: [],
          readiness: kinds.map((kind) => ({
            kind,
            installed: kind === "codex" || kind === "claude",
            logged_in: kind === "codex",
            can_log_in: kind === "claude",
            probe: {
              source: "world-harness-probe",
              state: "ok",
              reason: "complete",
              observed_at: 0,
            },
          })),
        };
      },
    };
  };
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button id="reopen" onClick={() => setOpen(true)}>
          Reopen
        </button>
        {open ? (
          <AgentLauncherDialog
            world={world}
            initial={initial}
            onOpen={(target) => opened.push(target)}
            onEditProfiles={() => {}}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </>
    );
  }
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const button = (selector: string) =>
    host.querySelector<HTMLButtonElement>(selector)!;
  const start = () => button(".agent-launcher-kind").click();
  const render = async (key: string) => {
    root.render(<Harness key={key} />);
    await settle();
  };
  const openTab = () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("Open its tab"))!
      .click();
  const visibleStatus = () => {
    const a = host.querySelector(".agent-launcher")!.getBoundingClientRect(),
      b = host.querySelector(".agent-launcher-status")!.getBoundingClientRect();
    return b.height > 0 && b.top >= a.top && b.bottom <= a.bottom;
  };
  const reopen = async () => {
    button('[aria-label="Close new agent"]').click();
    await settle();
    button("#reopen").click();
    await settle();
  };
  try {
    for (const status of ["started", "sent", "uncertain", "failed"] as const) {
      includeLogin = status === "failed";
      answer = Promise.withResolvers();
      opened.length = 0;
      const before = starts;
      await render(status);
      const choice = button(
        status === "uncertain"
          ? '[aria-label="Start Reviewer"]'
          : ".agent-launcher-kind",
      );
      choice.click();
      choice.click();
      await settle();
      check(
        starts === before + 1 && choice.disabled && visibleStatus(),
        `${status}: one pending submit with visible progress`,
      );
      answer.resolve({
        status,
        terminal_id: "new-terminal",
        message: `${status} fixture`,
      });
      await settle();
      const confirmed = status === "started" || status === "sent";
      check(
        !!host.querySelector(".agent-launcher") === !confirmed,
        `${status}: close only confirmed starts`,
      );
      if (!confirmed) {
        check(
          visibleStatus() && opened.length === 0,
          `${status}: show the outcome without opening automatically`,
        );
        check(
          choice.disabled === (status === "uncertain"),
          `${status}: retry only definite failure`,
        );
        if (status === "failed") {
          check(
            !button(".agent-launcher-login-row button").disabled &&
              !button(".agent-launcher-section-head button").disabled,
            "Failure permits login and profile editing",
          );
          answer = Promise.withResolvers();
          choice.click();
          choice.click();
          await settle();
          check(starts === before + 2, "A deliberate retry submits once");
          answer.resolve({
            status: "uncertain",
            terminal_id: "new-terminal",
            message: "Retry uncertain",
          });
          await settle();
          check(choice.disabled, "An uncertain retry stays locked");
        } else {
          choice.click();
          await settle();
          check(starts === before + 1, "Uncertainty cannot submit twice");
        }
        openTab();
        await settle();
        check(
          !host.querySelector(".agent-launcher"),
          "Explicit Open closes the launcher",
        );
      }
      check(
        opened.length === 1 &&
          opened[0]?.connectionId === "alpha" &&
          opened[0]?.runtimeGeneration === 7 &&
          opened[0]?.terminalId === "new-terminal",
        "Open only the captured runtime/terminal",
      );
    }
    // Both async creation paths must ignore a dismissed dialog's completion.
    for (const kind of ["agent", "terminal"]) {
      answer = Promise.withResolvers();
      const terminal = Promise.withResolvers<void>();
      opened.length = 0;
      store.createQualifiedTab = async (owner, room) => {
        check(
          owner.connectionId === "alpha" &&
            owner.runtimeGeneration === 7 &&
            room === "room",
          "Terminal retains its owner",
        );
        await terminal.promise;
      };
      await render(`dismissed-${kind}`);
      button(
        kind === "agent" ? ".agent-launcher-kind" : ".agent-launcher-card",
      ).click();
      await settle();
      await reopen();
      if (kind === "agent")
        answer.resolve({ status: "started", terminal_id: "old-terminal" });
      else terminal.resolve();
      await settle();
      check(
        opened.length === 0 && !!host.querySelector(".agent-launcher"),
        `${kind}: old completion cannot open a terminal or close the reopened dialog`,
      );
    }
    // Login finishes before a deliberate start can own the result.
    includeLogin = true;
    login = Promise.withResolvers();
    answer = Promise.withResolvers();
    await render("login");
    const before = starts;
    button(".agent-launcher-login-row button").click();
    start();
    await settle();
    check(starts === before, "Pending login blocks start");
    login.resolve({ terminal_id: "login-terminal", command: "example login" });
    await settle();
    check(
      !button(".agent-launcher-kind").disabled,
      "Login completion restores choices",
    );
    start();
    await settle();
    answer.resolve({
      status: "uncertain",
      terminal_id: "after-login",
      message: "Agent uncertainty remains",
    });
    await settle();
    check(
      starts === before + 1 &&
        host
          .querySelector(".agent-launcher-status")
          ?.textContent?.includes("Agent uncertainty remains") === true,
      "Login cannot overwrite the new launch outcome",
    );
  } finally {
    root.unmount();
    host.remove();
    bridge.connection = previous.connection;
    bridge.call = previous.call;
    store.createQualifiedTab = previous.create;
  }
}
run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
