import { createRoot } from "react-dom/client";
import { STARTER_PROFILES } from "../../../shared/agentProfile";
import { bridge } from "../api";
import { FeatureHosts } from "../features/FeatureHosts";
import { openApartments } from "./apartments/apartmentsStore";
import { setApartmentsClient } from "./apartments/useApartments";
import { fixtureHost, fixtureWorld } from "./board/boardFixture";
import { openMemoryLibrary } from "./memory/memoryEvents";
import { setMemoryFixtureForTests } from "./memory/memoryFixture";
import { fixtureApartmentsClient } from "./testing/apartmentsFixture";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";

// The "dialogs" feature slot as AgentDialogs mounts it, real CSS in real
// Chrome: Apartments and the Memory Library still open from their events and
// close again. Synthetic residents, starter profiles and the memory fixture.

const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};

Object.assign(bridge, {
  call: async (method: string) => {
    if (method === "world.profiles.get")
      return {
        version: 1,
        revision: 1,
        profiles: STARTER_PROFILES,
        assignments: [],
        chimes: {},
        town_master: null,
      };
    throw new Error(`Unavailable in the feature hosts fixture: ${method}`);
  },
  onControl: () => () => undefined,
  onStatus: () => () => undefined,
});
setApartmentsClient(fixtureApartmentsClient(Date.now()));
setMemoryFixtureForTests(true);

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);
async function until(test: () => unknown, what: string) {
  const deadline = performance.now() + 8_000;
  while (!test()) {
    if (performance.now() > deadline) throw new Error(`timed out: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const closeButton = (label: string) =>
  $(`button[aria-label="${label}"]`)?.click();

async function run() {
  const host = document.createElement("div");
  document.body.append(host);
  const world = fixtureWorld([
    fixtureHost("local", [{ label: "alpha", tabs: [] }]),
  ]);
  createRoot(host).render(
    <FeatureHosts slot="dialogs" world={world} onOpen={() => undefined} />,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  check(!$(".apartments-dialog") && !$(".memory-library"), "opened unasked");

  openApartments("ada");
  await until(() => $(".apartments-dialog"), "Apartments to open");
  await until(() => $("button.apartments-row"), "Apartments' residents");
  check(
    $<HTMLInputElement>('input[aria-label="Search residents"]')?.value ===
      "ada",
    "Apartments lost its search",
  );
  closeButton("Close apartments");
  await until(() => !$(".apartments-dialog"), "Apartments to close");

  openMemoryLibrary({ connectionId: "memory-fixture", agentId: "p1" });
  await until(() => $(".memory-library"), "the Memory Library to open");
  closeButton("Close library");
  await until(() => !$(".memory-library"), "the Memory Library to close");
}

run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
