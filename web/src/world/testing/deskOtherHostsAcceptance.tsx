import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { DeskOtherHosts } from "../DeskOtherHosts";
import type { WorldLeafObject, WorldObject } from "../worldObject";

/** A rendered summary must keep the occupant originally offered to the operator. */
export async function checkDeskOtherHosts(
  check: (value: boolean, message: string) => void,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const target = {
    id: "remote",
    connectionId: "beta",
    generation: 7,
    kind: "agent",
    terminalId: "same",
    workspaceId: "same",
    tabId: "same",
    pane: { pane_id: "same" },
    label: "Synthetic agent",
    hostLabel: "Synthetic beta",
    status: "done",
    actionable: true,
    stale: false,
    agentSessionFingerprint: "a".repeat(64),
  } as WorldLeafObject;
  let opens = 0;
  const render = (leaf: WorldLeafObject | null, fail = false) =>
    flushSync(() =>
      root.render(
        <DeskOtherHosts
          world={
            {
              leaves: leaf ? [leaf] : [],
              nodeById: new Map(leaf ? [[leaf.id, leaf]] : []),
            } as unknown as WorldObject
          }
          filtered={{ hosts: [{ connectionId: "alpha" }] } as WorldObject}
          label="Synthetic alpha"
          onReveal={async () => {
            opens++;
            if (fail)
              throw new Error("Captured session unavailable on Synthetic beta");
          }}
        />,
      ),
    );
  const expand = () =>
    flushSync(() =>
      container.querySelector<HTMLButtonElement>("button.desk-host")!.click(),
    );
  const action = () =>
    container.querySelector<HTMLButtonElement>(".desk-host-agents li button")!;
  try {
    for (const change of [
      { agentSessionFingerprint: "b".repeat(64) },
      { generation: 8 },
      { actionable: false },
      { stale: true },
      null,
    ]) {
      render(target);
      expand();
      check(
        !action().disabled,
        "Current summary agent is disabled before retirement",
      );
      render(change === null ? null : { ...target, ...change });
      check(
        action().disabled,
        "Expanded summary silently retargeted its captured occupant",
      );
      check(
        !!container.querySelector(".desk-host-agents li span"),
        "Retired summary lacks an explanation",
      );
      action().click();
      check(opens === 0, "Retired summary dispatched an open");
      flushSync(() =>
        container
          .querySelector<HTMLButtonElement>(".desk-host-heading button")!
          .click(),
      );
    }
    render(target, true);
    expand();
    action().click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    check(
      container
        .querySelector('[role="alert"]')
        ?.textContent?.includes("Synthetic beta") === true,
      "Live admission failure lacks its destination-host explanation",
    );
    check(action().disabled, "Rejected captured session remained actionable");
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}
