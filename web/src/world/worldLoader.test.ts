import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WORLD_LOADER_LONGER_MS,
  WorldLoader,
  worldLoaderLonger,
} from "./WorldLoader";

test("taking longer is real elapsed time past the threshold, nothing else", () => {
  expect(worldLoaderLonger(1000, 1000)).toBe(false);
  expect(worldLoaderLonger(1000, 1000 + WORLD_LOADER_LONGER_MS - 1)).toBe(
    false,
  );
  expect(worldLoaderLonger(1000, 1000 + WORLD_LOADER_LONGER_MS)).toBe(true);
  expect(worldLoaderLonger(0, 5, 5)).toBe(true);
});

const render = (since: number, live?: boolean) =>
  renderToStaticMarkup(
    createElement(WorldLoader, {
      since,
      live,
      label: "Starting Codex…",
      longerLabel: "Taking longer than usual: still starting Codex…",
      detail: "Creating its tab.",
    }),
  );

test("a fresh wait is busy, announces its label and shows no percentage", () => {
  const html = render(Date.now());
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('role="status"');
  expect(html).toContain("Starting Codex…");
  expect(html).toContain("Creating its tab.");
  expect(html).not.toContain("Taking longer");
  expect(html).not.toContain("%");
});

test("an old wait says it is taking longer", () => {
  const html = render(Date.now() - WORLD_LOADER_LONGER_MS - 1);
  expect(html).toContain("Taking longer than usual: still starting Codex…");
  expect(html).toContain("is-longer");
});

test("inside an existing live region it adds no second status role", () => {
  expect(render(Date.now(), false)).not.toContain('role="status"');
});
