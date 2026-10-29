import { expect, test } from "bun:test";
import { TownBuildingSigns } from "./townBuildingSigns";

const sign = () => ({ style: { opacity: "", visibility: "" } });

test("only committed signs request a frame and receive the current roof alpha", () => {
  let frames = 0;
  const signs = new TownBuildingSigns(() => frames++);
  const attach = signs.ref("synthetic-a");
  const seen: string[] = [];
  signs.update((key) => {
    seen.push(key);
    return 1;
  });
  expect(frames).toBe(0);
  expect(seen).toEqual([]);
  const node = sign();
  attach(node);
  expect(frames).toBe(1);
  signs.update((key) => {
    seen.push(key);
    return 0.876;
  });
  expect(seen).toEqual(["synthetic-a"]);
  expect(node.style).toEqual({ opacity: "0.88", visibility: "visible" });
});

test("normal roof fades hide and reveal each host independently", () => {
  const signs = new TownBuildingSigns(() => {});
  const stale = sign();
  const healthy = sign();
  signs.ref("synthetic-stale")(stale);
  signs.ref("synthetic-healthy")(healthy);
  signs.update((key) => (key === "synthetic-stale" ? 0 : 1));
  expect(stale.style).toEqual({ opacity: "0", visibility: "hidden" });
  expect(healthy.style).toEqual({ opacity: "1", visibility: "visible" });
  signs.update((key) => (key === "synthetic-stale" ? 1 : 0.004));
  expect(stale.style).toEqual({ opacity: "1", visibility: "visible" });
  expect(healthy.style).toEqual({ opacity: "0", visibility: "hidden" });
});

test("culled signs detach and their replacement requests its own frame", () => {
  let frames = 0;
  const signs = new TownBuildingSigns(() => frames++);
  const attach = signs.ref("synthetic-a");
  const old = sign();
  attach(old);
  attach(null);
  signs.update(() => {
    throw new Error("a culled node must not receive a frame");
  });
  const next = sign();
  attach(next);
  signs.update(() => 1);
  expect(frames).toBe(2);
  expect(old.style.opacity).toBe("");
  expect(next.style.opacity).toBe("1");
  attach(null);
  attach(null);
  signs.update(() => {
    throw new Error("repeated cleanup must leave no node");
  });
});

test("a late retiring ref cannot delete the replacement for the same host", () => {
  const signs = new TownBuildingSigns(() => {});
  const oldRef = signs.ref("synthetic-a");
  const newRef = signs.ref("synthetic-a");
  const old = sign();
  const next = sign();
  oldRef(old);
  newRef(next);
  oldRef(null);
  signs.update(() => 1);
  expect(next.style.opacity).toBe("1");
  expect(old.style.opacity).toBe("");
  newRef(null);
  signs.update(() => {
    throw new Error("the final committed ref must be gone");
  });
});

test("an uncommitted competing ref cannot unregister a committed node", () => {
  const signs = new TownBuildingSigns(() => {});
  const node = sign();
  signs.ref("synthetic-a")(node);
  const abandoned = signs.ref("synthetic-a");
  abandoned(null);
  signs.update(() => 1);
  expect(node.style.opacity).toBe("1");
});

test("ref replacement on the same DOM node retains the new registration", () => {
  const signs = new TownBuildingSigns(() => {});
  const node = sign();
  const oldRef = signs.ref("synthetic-a");
  const newRef = signs.ref("synthetic-a");
  oldRef(node);
  newRef(node);
  oldRef(null);
  signs.update(() => 1);
  expect(node.style.opacity).toBe("1");
});
