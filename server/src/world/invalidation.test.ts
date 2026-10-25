import { expect, test } from "bun:test";
import { serializeWorldInvalidation } from "./invalidation";

test("invalidation carries health only for its exact owner and generation", () => {
  const status = { id: "synthetic-a", generation: 3, state: "error" as const };
  expect(
    JSON.parse(
      serializeWorldInvalidation("synthetic-a", 3, 7, {
        has: () => true,
        status: () => status,
      }),
    ).control,
  ).toEqual({
    type: "world_invalidated",
    connection_id: "synthetic-a",
    connection_generation: 3,
    revision: 7,
    connection_state: "error",
  });
  for (const value of [
    { ...status, id: "synthetic-b" },
    { ...status, generation: 4 },
    undefined,
  ])
    expect(
      JSON.parse(
        serializeWorldInvalidation(
          "synthetic-a",
          3,
          7,
          value ? { has: () => true, status: () => value } : undefined,
        ),
      ).control.connection_state,
    ).toBeUndefined();
});
