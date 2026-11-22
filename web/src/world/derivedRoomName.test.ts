import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BoardRoomName } from "./board/BoardRoomName";
import type { BoardWorkspace } from "./board/boardModel";
import { derivedRoomNameHint } from "./derivedRoomName";

test("a derived room name says which evidence named it; a given one says nothing", () => {
  expect(derivedRoomNameHint({ label_derived_from: "folder" })).toBe(
    "Named from its folder; the space has no name",
  );
  expect(derivedRoomNameHint({ label_derived_from: "tab" })).toBe(
    "Named from its tab; the space has no name",
  );
  expect(derivedRoomNameHint({ label_derived_from: "agent" })).toBe(
    "Named from its first agent; the space has no name",
  );
  expect(derivedRoomNameHint({})).toBeNull();
  expect(derivedRoomNameHint(undefined)).toBeNull();
});

test("a Board card shows the same name, marked when World derived it", () => {
  const card = (workspace: object) =>
    renderToStaticMarkup(
      createElement(BoardRoomName, {
        space: {
          label: "docs",
          space: { workspace },
        } as unknown as BoardWorkspace,
      }),
    );
  expect(card({ label_derived_from: "folder" })).toBe(
    '<span class="board-label is-derived" title="docs: Named from its folder; the space has no name">docs</span>',
  );
  expect(card({})).toBe('<span class="board-label">docs</span>');
});
