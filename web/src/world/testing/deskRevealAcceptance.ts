import { worldLocalStorage } from "../../browserStorage";
import { store } from "../../store";
import { writeHostsFilter } from "../hostsFilter";
import { worldObjectId } from "../worldObject";

type Evidence = {
  check(value: boolean, message: string): void;
  waitFor(condition: () => boolean, message: string): Promise<void>;
  frame(): Promise<void>;
  calls: string[];
  dispatches: Array<{ connectionId: string; method: string }>;
  inspectorForHost(element: Element | null, id: string): boolean;
};

/** Real shell, qualified focus queue and Inspector consumers on desktop and phone. */
export async function runDeskRevealAcceptance({
  check,
  waitFor,
  frame,
  calls,
  dispatches,
  inspectorForHost,
}: Evidence) {
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((value) =>
      value.textContent?.includes(text),
    );
  button("Agents")!.click();
  await frame();
  document
    .querySelector<HTMLButtonElement>(
      `[data-desk-card="${CSS.escape(worldObjectId("alpha", "terminal", "shared"))}"]`,
    )!
    .click();
  await waitFor(
    () => calls.includes("attached:alpha"),
    "Desk did not open the original alpha Inspector",
  );
  // Return from the full-screen phone Inspector to Desk without closing it.
  if (window.innerWidth <= 720) {
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Back to Desk"]')
      ?.click();
    await frame();
  }
  writeHostsFilter(["alpha"]);
  await waitFor(
    () => !!button("Synthetic beta · quiet"),
    "Outside-filter beta summary is missing",
  );
  const alphaAttachments = calls.filter(
    (value) => value === "attached:alpha",
  ).length;
  const betaReadsBefore = dispatches.filter(
    (value) => value.connectionId === "beta" && value.method === "pane.get",
  ).length;
  button("Synthetic offline")!.click();
  await frame();
  check(
    !!document
      .querySelector(".desk-host-agents")
      ?.textContent?.includes("Cached observation"),
    "Cached outside-filter agents lack an explanation",
  );
  check(
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".desk-host-agents li button",
      ),
    ].every((value) => value.disabled),
    "Cached summary exposed an actionable agent",
  );
  button("Synthetic beta · quiet")!.click();
  await frame();
  const reveal = document.querySelector<HTMLButtonElement>(
    ".desk-host-agents li button",
  );
  check(
    !!reveal &&
      !reveal.disabled &&
      reveal.textContent!.includes("on Synthetic beta"),
    `Fresh summary does not offer a host-named reveal/open action: ${document.querySelector(".desk-host-agents")?.textContent}`,
  );
  check(
    worldLocalStorage.getItem("worldHostsFilter.v1") === '["alpha"]',
    "Reading a summary changed the filter",
  );
  check(
    dispatches.filter(
      (value) => value.connectionId === "beta" && value.method === "pane.get",
    ).length === betaReadsBefore,
    "Reading a summary admitted the hidden agent",
  );
  reveal!.click();
  await waitFor(
    () => calls.includes("attached:beta"),
    "Reveal did not open beta's own Inspector",
  );
  await frame();
  check(
    worldLocalStorage.getItem("worldHostsFilter.v1") === '["alpha","beta"]',
    "Reveal did not preserve alpha while adding beta to Hosts",
  );
  check(
    store.get().activeConnectionId === "alpha",
    "Reveal retargeted the Spaces owner",
  );
  check(
    calls.filter((value) => value === "attached:alpha").length ===
      alphaAttachments,
    "Reveal replaced alpha's terminal resource",
  );
  check(
    [...document.querySelectorAll("[data-window-id]")].some((value) =>
      inspectorForHost(value, "beta"),
    ),
    "Revealed Inspector is not owned by beta",
  );
  if (window.innerWidth > 720)
    check(
      [...document.querySelectorAll("[data-window-id]")].some((value) =>
        inspectorForHost(value, "alpha"),
      ),
      "Reveal discarded the existing alpha Inspector",
    );
}
