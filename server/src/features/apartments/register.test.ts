import { expect, test } from "bun:test";
import { memoryApartmentsPort } from "../../storage/apartments";
import { testFeatureKernel } from "../../testing/features";
import { composeFeatures } from "../compose";
import type { FeatureKernel, FeatureRpcHandler } from "../contract";
import { apartmentsKey } from "./register";

test("discovered Apartments handlers retain list, history, eviction and error replies", async () => {
  const features = composeFeatures(
    testFeatureKernel({
      storage: {
        apartments: memoryApartmentsPort([], () => 0),
      } as FeatureKernel["storage"],
    }),
  );
  const service = features.get(apartmentsKey);
  const replies: unknown[] = [],
    errors: unknown[] = [];
  const call = (operation: string, params = {}) =>
    features.rpc.get(`world.apartments.${operation}`)!({
      id: operation,
      method: `world.apartments.${operation}`,
      params,
      sendReply: (reply, context) => {
        replies.push([reply, context]);
      },
      sendError: (context, error) => {
        errors.push([context, (error as Error).message]);
      },
    } as Parameters<FeatureRpcHandler>[0]);
  await call("list");
  expect(replies.at(-1)).toEqual([
    { id: "list", result: service.apartments.list() },
    "world-apartments",
  ]);
  const history = {
    status: "unavailable" as const,
    detail: "Connect the original host",
    messages: [],
    truncated: false,
    report: null,
  };
  service.history = async (id) => {
    expect(id).toBe("resident-a");
    return history;
  };
  await call("history", { id: "resident-a" });
  expect(replies.at(-1)).toEqual([
    { id: "history", result: history },
    "world-apartments",
  ]);
  const evicted: string[][] = [];
  service.apartments.evict = async (ids) => {
    evicted.push([...ids]);
    return service.apartments.list();
  };
  await call("evict", { ids: ["resident-a", "resident-b"] });
  expect(evicted).toEqual([["resident-a", "resident-b"]]);
  expect(replies.at(-1)).toEqual([
    { id: "evict", result: service.apartments.list() },
    "world-apartments",
  ]);
  service.history = async () => {
    throw new Error("That resident has moved out.");
  };
  await call("history", { id: "gone" });
  expect(errors).toEqual([
    ["world-apartments-error", "That resident has moved out."],
  ]);
  await features.stop("close");
});
