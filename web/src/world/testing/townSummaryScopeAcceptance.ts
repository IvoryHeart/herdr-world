import { writeHostsFilter } from "../hostsFilter";

/** Colliding native IDs on two live hosts; beta/shared is already pinned. */
export function townSummaryScopeSnapshot() {
  const statuses = ["working", "blocked", "done"];
  return {
    revision: 100,
    observed_at: Date.now(),
    connections: ["alpha", "beta", "offline"].map((id) => ({
      connection_id: id,
      label: `Synthetic ${id}`,
      source: "saved-profile",
      is_default: id === "alpha",
      state: id === "offline" ? "disconnected" : "ready",
      generation: 7,
      snapshot_generation: id === "offline" ? null : 7,
      stale: false,
      actionable: id !== "offline",
      snapshot:
        id === "offline"
          ? null
          : {
              workspaces: [
                {
                  workspace_id: "shared",
                  number: 1,
                  label: "Synthetic Studio",
                  focused: true,
                  pane_count: 3,
                  tab_count: 1,
                  agent_status: "working",
                },
              ],
              tabs: [
                {
                  tab_id: "shared",
                  workspace_id: "shared",
                  number: 1,
                  label: "Synthetic table",
                  focused: true,
                  pane_count: 3,
                  agent_status: "working",
                },
              ],
              panes: statuses.map((status, index) => ({
                pane_id: index === 0 ? "shared" : status,
                terminal_id: index === 0 ? "shared" : status,
                workspace_id: "shared",
                tab_id: "shared",
                focused: index === 0,
                agent: "codex",
                agent_status: status,
                display_agent: `Synthetic ${id} ${status}`,
                revision: 1,
              })),
              agents: [],
              coverage: {
                workspaces: 1,
                tabs: 1,
                panes: 3,
                agent_panes: 3,
                status: {
                  working: 1,
                  blocked: 1,
                  done: 1,
                  idle: 0,
                  unknown: 0,
                },
                by_workspace: [
                  {
                    workspace_id: "shared",
                    tabs: 1,
                    panes: 3,
                    agent_panes: 3,
                    status: {
                      working: 1,
                      blocked: 1,
                      done: 1,
                      idle: 0,
                      unknown: 0,
                    },
                  },
                ],
              },
            },
    })),
  };
}

/** Exercise useWorldObservation → WorldControlPlane → TownView, with no summary mocks. */
export async function checkTownSummaryScope({
  check,
  waitFor,
  invokeCommand,
}: {
  check(value: boolean, message: string): void;
  waitFor(condition: () => boolean, message: string): Promise<void>;
  invokeCommand(key: string): Promise<void>;
}) {
  const panel = () =>
    document.querySelector<HTMLElement>(".world-panel-body .town-summary");
  const chip = () =>
    document.querySelector<HTMLButtonElement>(".town-board-chip");
  const expectCounts = async (
    working: number,
    blocked: number,
    done: number,
    context: string,
  ) => {
    try {
      await waitFor(
        () =>
          chip()?.getAttribute("aria-label") ===
          `Town summary: ${working} working, ${blocked} need you, ${done} done`,
        `${context}: phone summary chip has the wrong scope`,
      );
    } catch (error) {
      throw new Error(
        `${String(error)}; actual chip=${chip()?.getAttribute("aria-label")}`,
        { cause: error },
      );
    }
    check(
      [...document.querySelectorAll(".town-board dl dd")]
        .map((el) => el.textContent)
        .join(",") === [working, blocked, done].join(","),
      `${context}: desktop board differs from the phone chip`,
    );
  };
  const expectLists = async (
    hosts: string[],
    context: string,
    roomCount = hosts.length,
  ) => {
    await waitFor(
      () =>
        panel()?.querySelectorAll(".town-summary-item").length ===
        hosts.length * 2,
      `${context}: Summary attention lists have the wrong scope`,
    );
    const items = [
      ...panel()!.querySelectorAll(".town-summary-item strong"),
    ].map((el) => el.textContent);
    check(
      hosts.every((host) =>
        ["blocked", "done"].every((status) =>
          items.some((text) => text?.includes(`Synthetic ${host} ${status}`)),
        ),
      ),
      `${context}: Summary omits a host's blocked or finished agent`,
    );
    check(
      panel()!.querySelectorAll(".town-summary-room").length === roomCount,
      `${context}: Summary omits rooms or includes filtered rooms`,
    );
    check(
      panel()!.querySelector("#town-summary-needs span")?.textContent ===
        String(hosts.length) &&
        panel()!.querySelector("#town-summary-finished span")?.textContent ===
          String(hosts.length),
      `${context}: Summary totals differ from its lists`,
    );
  };
  // The operational selection is beta. All hosts must still include alpha.
  writeHostsFilter(null);
  await expectCounts(2, 2, 2, "All hosts");
  const launcher =
    innerWidth <= 640
      ? chip()
      : document.querySelector<HTMLButtonElement>(".town-board-open");
  launcher!.click();
  await waitFor(() => panel() !== null, "Town Summary did not open");
  await expectLists(["alpha", "beta"], "All hosts");

  writeHostsFilter(["alpha"]);
  await expectCounts(1, 1, 1, "Hosts filter alpha");
  await expectLists(["alpha"], "Hosts filter alpha");
  // Only beta's working agent is pinned, so alpha + pinned-only is empty.
  await invokeCommand("visual-pinned-only");
  await waitFor(
    () => chip() === null && panel() === null,
    "An excluded pin should leave Town empty",
  );
  writeHostsFilter(null);
  await expectCounts(1, 0, 0, "Pinned beta only");
  await expectLists([], "Pinned beta only", 1);
  check(
    panel()!.textContent?.includes("Synthetic beta") === true,
    "Pinned-only Summary lost beta's host",
  );

  await invokeCommand("visual-pinned-only");
  await expectCounts(2, 2, 2, "Restored All hosts");
  await expectLists(["alpha", "beta"], "Restored All hosts");
}
