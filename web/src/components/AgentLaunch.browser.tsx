import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { STARTER_PROFILES } from "../../../shared/agentProfile";
import { bridge } from "../api";
import { store } from "../store";
import { AgentLauncherDialog } from "../world/AgentLauncherDialog";
import type { LaunchOutcome } from "../world/agentProfiles";
import { buildWorldObject, type WorldObject } from "../world/worldObject";
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
/** The room as World observes it; `uncertain` is a ready host whose latest
 * observation was invalidated in flight (stale, not actionable). */
const observedWorld = (uncertain: boolean) =>
  buildWorldObject(
    [
      {
        connectionId: "alpha",
        label: "Demo host",
        source: "startup-config",
        isDefault: true,
        state: "ready",
        generation: 7,
        snapshotGeneration: 7,
        stale: uncertain,
        actionable: !uncertain,
        snapshot: {
          workspaces: [
            {
              workspace_id: "room",
              number: 1,
              label: "Demo room",
              focused: true,
              pane_count: 1,
              tab_count: 1,
              agent_status: "idle",
            },
          ],
          tabs: [
            {
              tab_id: "tab",
              workspace_id: "room",
              number: 1,
              label: "Shell",
              focused: true,
              pane_count: 1,
              agent_status: "idle",
            },
          ],
          panes: [
            {
              pane_id: "pane",
              workspace_id: "room",
              tab_id: "tab",
              terminal_id: "terminal",
              focused: true,
              agent_status: "idle",
              revision: 1,
            },
          ],
          agents: [],
        },
      },
    ] as Parameters<typeof buildWorldObject>[0],
    "alpha",
  );
async function run() {
  const previous = {
    connection: bridge.connection,
    call: bridge.call,
    create: store.createQualifiedTab,
  };
  const lastStart: { params: { kind?: string; profile_id?: string } | null } = {
    params: null,
  };
  const startedWith = () => lastStart.params;
  let starts = 0,
    catalogs = 0,
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
          lastStart.params = (params ?? null) as typeof lastStart.params;
          return answer.promise;
        }
        if (method === "launcher.login") return login.promise;
        if (method !== "launcher.catalog") throw Error(`Unexpected ${method}`);
        catalogs++;
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
  let showWorld: (next: WorldObject) => void = () => {};
  function Harness({ initialWorld = world }: { initialWorld?: WorldObject }) {
    const [open, setOpen] = useState(true);
    const [shown, setShown] = useState(initialWorld);
    showWorld = setShown;
    return (
      <>
        <button id="reopen" onClick={() => setOpen(true)}>
          Reopen
        </button>
        {open ? (
          <AgentLauncherDialog
            world={shown}
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
    // One uncertain observation while a start is pending (World invalidated
    // its in-flight snapshot) keeps the room and form; the launcher closes
    // exactly once, when the start is confirmed, and never comes back. Both
    // entry points: a harness, and a profile (Reviewer starts Codex with a
    // brief, as the owner did).
    for (const [path, selector] of [
      ["harness", ".agent-launcher-kind"],
      ["Reviewer profile", '[aria-label="Start Reviewer"]'],
    ] as const) {
      answer = Promise.withResolvers();
      opened.length = 0;
      lastStart.params = null;
      const certified = observedWorld(false);
      const uncertain = observedWorld(true);
      root.render(
        <Harness
          key={`uncertain-observation-${path}`}
          initialWorld={certified}
        />,
      );
      await settle();
      const presence: boolean[] = [];
      let collapsed = false;
      const watch = new MutationObserver(() => {
        const dialog = host.querySelector(".agent-launcher");
        if (presence[presence.length - 1] !== !!dialog) presence.push(!!dialog);
        if (
          dialog &&
          (!dialog.querySelector("select") ||
            /create a room first|room is unavailable/.test(
              dialog.textContent ?? "",
            ))
        )
          collapsed = true;
      });
      watch.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      flushSync(() => showWorld(uncertain));
      check(
        host.querySelector<HTMLButtonElement>(selector)?.disabled === true,
        `${path}: an uncertain room keeps its choice but cannot start an agent`,
      );
      flushSync(() => showWorld(certified));
      await settle();
      const catalogsBefore = catalogs;
      button(selector).click();
      await settle();
      flushSync(() => showWorld(uncertain));
      await settle();
      flushSync(() => showWorld(certified));
      await settle();
      answer.resolve({ status: "started", terminal_id: "observed-terminal" });
      await settle();
      await settle();
      watch.disconnect();
      const started = startedWith();
      check(
        path === "harness"
          ? started?.kind === "codex" && !started.profile_id
          : started?.profile_id === "reviewer",
        `${path}: started the chosen entry point: ${JSON.stringify(started)}`,
      );
      check(
        !collapsed,
        `${path}: an uncertain observation collapsed the launcher's form`,
      );
      check(
        catalogs === catalogsBefore,
        `${path}: an uncertain observation refetched the catalog`,
      );
      check(
        presence.length === 2 && presence[0] && !presence[1],
        `${path}: the launcher closes exactly once and never reopens: ${JSON.stringify(presence)}`,
      );
      check(
        opened.length === 1 && opened[0]?.terminalId === "observed-terminal",
        `${path}: the confirmed start opens its terminal once`,
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
