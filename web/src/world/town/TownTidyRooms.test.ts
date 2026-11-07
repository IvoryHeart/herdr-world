import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import type { TownRoomActions } from "./townRoomActions";
import { TownTidyRooms } from "./TownTidyRooms";

const actions = (canTidy: boolean, tidied: string[]) =>
  ({
    canTidyRooms: () => canTidy,
    onTidyRooms: (hostKey: string) => tidied.push(hostKey),
  }) as unknown as TownRoomActions;

test("the building sign names Tidy rooms, and a tap tidies that building", () => {
  const tidied: string[] = [];
  const props = {
    hostKey: "a",
    hostLabel: "Alpha",
    roomActions: actions(true, tidied),
    named: true,
  };
  const html = renderToStaticMarkup(createElement(TownTidyRooms, props));
  expect(html).toContain('aria-label="Tidy rooms in Alpha"');
  expect(html).toContain("town-tidy-rooms-named");
  expect(html).toContain("Tidy rooms</button>");
  const button = TownTidyRooms(props) as ReactElement<{
    onClick(event: { stopPropagation(): void }): void;
    onPointerDown(event: { stopPropagation(): void }): void;
  }>;
  let stopped = 0;
  const event = { stopPropagation: () => stopped++ };
  button.props.onPointerDown(event);
  button.props.onClick(event);
  expect(tidied).toEqual(["a"]);
  // The press stays on the sign: the canvas does not pan under it.
  expect(stopped).toBe(2);
});

test("no Tidy rooms where the host cannot change its rooms", () => {
  const html = renderToStaticMarkup(
    createElement(TownTidyRooms, {
      hostKey: "a",
      hostLabel: "Alpha",
      roomActions: actions(false, []),
    }),
  );
  expect(html).toBe("");
});
