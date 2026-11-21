import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { shipyardStore } from "./shipyard/shipyardStore";
import {
  FIXTURE_UNRELEASED,
  shipyardFixtureCatalog,
  shipyardFixtureSnapshot,
  type ShipyardFixtureMode,
} from "./shipyard/shipyardFixture";
import { TownShipyard } from "./town/TownShipyard";
import { TownCamera } from "./town/townCamera";
import { townHarbourLot, townLanesShown } from "./town/townHarbour";
import { layoutTown, townShapeFor } from "./town/townLayout";
import { townPhoneShape } from "./town/townLots";
import "../styles/tokens.css";
import "../styles/base.css";
import "./town/town.css";

// Town's harbour in real Chrome with its real CSS (#1148): every lane's
// lighthouse lamp is the topmost thing where it shines, at the camera's
// widest, home and closest zoom, on a phone and a desktop, even with a ship
// pushed over it (a release sailing in passes the pier head). Synthetic
// projects from the Shipyard fixture only.

const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};
const query = new URLSearchParams(location.search);
const mode = (query.get("mode") ?? "many") as ShipyardFixtureMode;

const frame = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
async function until(test: () => boolean, what: string) {
  for (let i = 0; i < 200; i += 1) {
    if (test()) return;
    await frame();
  }
  throw new Error(`timed out: ${what}`);
}

async function run() {
  const width = innerWidth;
  const height = innerHeight;
  // The shape Town itself takes at this size (TownCanvas).
  const shape = townShapeFor(width, height);
  const phone = townPhoneShape(shape);
  if (phone !== query.has("phone"))
    throw new Error(
      `a ${width}×${height} page took ${phone ? "" : "not "}the phone shape`,
    );
  // `large`: eight hosts with six rooms each, a town whose widest zoom is
  // far below the usual two hosts' (the review case for #1148).
  const large = query.has("large");
  const hosts = Array.from({ length: large ? 8 : 2 }, (_, index) => ({
    key: `h${index}`,
    displayOrder: index,
  }));
  const layout = layoutTown(
    {
      hosts,
      rooms: hosts.flatMap((host) =>
        Array.from({ length: large ? 6 : 3 }, (_, order) => ({
          key: `${host.key}/${order}`,
          hostKey: host.key,
          order,
          deskKeys: [`${host.key}/${order}/0`, `${host.key}/${order}/1`],
        })),
      ),
    },
    shape,
  ).layout;
  shipyardStore.useFetch((input) => {
    const repo = new URL(String(input), location.href).searchParams.get("repo");
    const now = Date.now();
    return Promise.resolve(
      Response.json(
        repo
          ? shipyardFixtureSnapshot(mode, now, repo)
          : shipyardFixtureCatalog(mode, now),
      ),
    );
  });
  const stage = document.createElement("div");
  stage.style.cssText = "position:fixed;inset:0;overflow:hidden";
  const world = document.createElement("div");
  world.className = "town-world";
  stage.append(world);
  document.body.append(stage);
  // Hit-test by what is painted on top: the harbour's art lets presses
  // through to the town, so make every part of it a target here.
  const style = document.createElement("style");
  style.textContent = ".town-world * { pointer-events: auto !important; }";
  document.head.append(style);
  createRoot(world).render(
    createElement(TownShipyard, { layout, renderer: { current: null } }),
  );

  const lot = townHarbourLot(layout);
  const released = shipyardFixtureCatalog(mode, Date.now()).repositories.filter(
    (repo) => repo !== FIXTURE_UNRELEASED,
  );
  const shown = townLanesShown(lot, released.length);
  const lamps = () => [
    ...world.querySelectorAll<HTMLElement>(".town-harbour-lamp"),
  ];
  await until(
    () =>
      lamps().length === shown &&
      world.querySelector(".town-harbour-ship") !== null,
    `${shown} lanes with ships`,
  );
  const more = released.length > shown ? 1 : 0;
  check(
    world.querySelectorAll(".town-harbour-pier").length === shown + more,
    `${world.querySelectorAll(".town-harbour-pier").length} piers for ${shown + more} lanes`,
  );
  check(
    !world.querySelector(`[aria-label="Shipping lane ${FIXTURE_UNRELEASED}"]`),
    "a project with no release has a lane",
  );

  const camera = new TownCamera();
  camera.reducedMotion = true;
  camera.configure(layout, {
    width,
    height,
    inset: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const limits = camera.limits!;
  const place = () => {
    const tx = width / 2 - camera.x * camera.z;
    const ty = height / 2 - camera.y * camera.z;
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${camera.z})`;
    world.style.setProperty("--z", String(camera.z));
    world.style.setProperty("--iz", String(1 / camera.z));
  };
  const zooms = { widest: limits.min, home: limits.home, closest: limits.max };
  for (const [name, z] of Object.entries(zooms))
    for (const lamp of lamps()) {
      const lane = lamp.closest<HTMLElement>(".town-harbour-lane")!;
      const label = `${phone ? "phone" : "desktop"} ${name} zoom, ${lane.getAttribute("aria-label")}`;
      const tower = lamp.parentElement!;
      const left = Number.parseFloat(tower.style.left);
      const top = Number.parseFloat(tower.style.top);
      camera.jumpTo(left + 10, top + 6, z);
      place();
      await frame();
      const box = lamp.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (x < 0 || y < 0 || x > width || y > height) {
        failures.push(
          `${label}: the lamp cannot be brought on screen (${x}, ${y})`,
        );
        continue;
      }
      check(
        box.width >= 8 && box.height >= 3,
        `${label}: the lamp is ${box.width.toFixed(1)}×${box.height.toFixed(1)} px on screen`,
      );
      const hit = () => document.elementFromPoint(x, y);
      check(hit() === lamp, `${label}: ${describe(hit())} covers the lamp`);
      // A ship over the pier head (sailing in) still passes under the light.
      const ship = lane.querySelector<HTMLElement>(".town-harbour-ship");
      if (!ship) continue;
      const kept = { left: ship.style.left, top: ship.style.top };
      ship.style.left = `${left - 24}px`;
      ship.style.top = `${top - 12}px`;
      await frame();
      check(
        hit() === lamp,
        `${label}: a ship over it covers the lamp (${describe(hit())})`,
      );
      Object.assign(ship.style, kept);
    }
}

const describe = (element: Element | null) =>
  element
    ? `${element.tagName.toLowerCase()}.${[...element.classList].join(".")}`
    : "nothing";

run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", {
      method: "POST",
      body: JSON.stringify(failures.slice(0, 30)),
    }),
  );
