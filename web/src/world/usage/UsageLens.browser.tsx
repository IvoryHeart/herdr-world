import { clock as fixtureTime } from "../testing/installTestClock";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { bridge } from "../../api";
import { UsageLens } from "./UsageLens";
import "../../styles/tokens.css";
import "../../styles/base.css";
import "../worldFonts.css";
import "../town/town.css";

/*
 * Usage (#1029) keeps every tab inside its frame on a phone (360 px) and on
 * a desktop (1024 px), its hour charts draw all 24 columns, and the testing
 * switch leaves the address at once. The busy fixture: synthetic runs only.
 */

const failures: string[] = [];
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
bridge.call = (async () => {
  throw new Error("no service in this test");
}) as typeof bridge.call;
history.replaceState(null, "", "/?usageFixture=busy");

const advance = () =>
  act(async () => {
    await fixtureTime.advance(0);
  });

/** Every drawn element sits inside the lens; tables may scroll in their wrap. */
function checkInside(lens: HTMLElement, label: string) {
  const box = lens.getBoundingClientRect();
  const panel = lens.querySelector<HTMLElement>(".usage-panel")!;
  if (panel.scrollWidth > panel.clientWidth + 1)
    failures.push(
      `${label}: content is ${panel.scrollWidth}px wide in a ${panel.clientWidth}px panel`,
    );
  for (const element of lens.querySelectorAll<HTMLElement>("*")) {
    if (element.closest(".usage-table-wrap > *")) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    if (rect.left < box.left - 0.5 || rect.right > box.right + 0.5)
      failures.push(
        `${label}: ${element.className || element.tagName} "${element.textContent?.slice(0, 24)}" spans ${rect.left.toFixed(1)}–${rect.right.toFixed(1)}, the lens ${box.left.toFixed(1)}–${box.right.toFixed(1)}`,
      );
  }
}

async function run() {
  await document.fonts.ready;
  for (const [width, height] of [
    [360, 740],
    [1024, 720],
  ] as const) {
    const host = document.createElement("div");
    host.className = "town-world";
    host.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:hidden`;
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(<UsageLens initialTab="budget" onClose={() => {}} />),
    );
    await advance();
    if (location.search)
      failures.push(`the switch stayed in the address: ${location.search}`);
    const lens = host.querySelector<HTMLElement>(".usage-lens")!;
    const tab = (name: string) =>
      [...lens.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (button) => button.textContent === name,
      )!;
    if (lens.querySelectorAll(".usage-card").length !== 2)
      failures.push(`${width}px: expected two budget cards`);
    checkInside(lens, `Budget at ${width}px`);

    await act(async () => tab("Runs at once").click());
    for (const plot of lens.querySelectorAll<HTMLElement>(".usage-plot")) {
      const cols = [...plot.querySelectorAll<HTMLElement>(".usage-col")];
      if (cols.length !== 24)
        failures.push(`${width}px: a chart has ${cols.length} hour columns`);
      if (cols.some((col) => col.getBoundingClientRect().width < 4))
        failures.push(`${width}px: hour columns are too narrow to see`);
    }
    checkInside(lens, `Runs at once at ${width}px`);
    const toggle = [...lens.querySelectorAll("button")].find(
      (button) => button.textContent === "Show as table",
    );
    await act(async () => toggle?.click());
    checkInside(lens, `Runs at once as a table at ${width}px`);

    await act(async () => tab("Tokens").click());
    await advance();
    if (!lens.querySelector(".usage-flag"))
      failures.push(`${width}px: no run stands out as waste`);
    checkInside(lens, `Tokens at ${width}px`);
    await act(async () => root.unmount());
    host.remove();
  }
}

run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", {
      method: "POST",
      body: JSON.stringify(failures.slice(0, 30)),
    }),
  );
