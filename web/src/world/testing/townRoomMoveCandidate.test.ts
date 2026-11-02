import { expect, test } from "bun:test";
import { isTownRoomMoveCandidate } from "./townRoomMoveCandidate";

test("a valid bus send is not a cross-room move candidate", () => {
  expect(
    isTownRoomMoveCandidate(true, "bin", "Send Move task 1 to the bus stop"),
  ).toBe(false);
  expect(isTownRoomMoveCandidate(true, "move", "Move task 1 to harbor")).toBe(
    true,
  );
});

test("room selection retains invalid, reorder and group exclusions", () => {
  expect(isTownRoomMoveCandidate(false, "move", "Move task 1 to harbor")).toBe(
    false,
  );
  expect(
    isTownRoomMoveCandidate(true, "reorder", "Put task 1 in task 2’s place"),
  ).toBe(false);
  expect(
    isTownRoomMoveCandidate(true, "reorder", "Put task 1 last of orbit"),
  ).toBe(false);
  expect(isTownRoomMoveCandidate(true, "ungroup", "Leave the team")).toBe(
    false,
  );
});
