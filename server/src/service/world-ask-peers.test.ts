import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorldCliToken } from "../config/session-secret";
import { configureServerLogger } from "../utils/logger";
import {
  askThroughCli,
  browserSocket,
  login,
  startTestService,
  type TestService,
} from "./testing/services";

/**
 * Owner questions across World instances (#1152): two Worlds attached to one
 * synthetic runtime (the same Herdr socket paths) and sharing one instance
 * registry. The World the CLI reached holds the question; the other shows it
 * in Needs you and answers or dismisses it there, exactly once.
 */

beforeAll(() => configureServerLogger("error"));
afterAll(() => configureServerLogger("info"));

const PASSWORD = "world-service-test-password";
const roots: string[] = [];
const running: TestService[] = [];
afterEach(async () => {
  for (const started of running.splice(0))
    await started.service.stop().catch(() => {});
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

type Ask = {
  id: string;
  question: string;
  actor: Record<string, unknown>;
  home?: { name: string; url: string | null };
  answer?: { text: string; by: string };
  dismissed?: { by: string };
};

async function worlds(runtime: "shared" | "separate" = "shared") {
  const root = mkdtempSync(join(tmpdir(), "world-ask-peers-"));
  roots.push(root);
  const registry = join(root, "instances");
  const socket = (name: string) => ({
    socketPath: join(root, `${name}-control.sock`),
    clientSocketPath: join(root, `${name}-render.sock`),
  });
  const start = async (name: string, sockets: ReturnType<typeof socket>) => {
    const started = await startTestService(join(root, name), sockets, {
      HERDR_WORLD_INSTANCE_REGISTRY_DIR: registry,
    });
    running.push(started);
    await started.connected;
    const page = await browserSocket(
      started.base,
      await login(started.base, PASSWORD),
    );
    return { started, page };
  };
  const home = await start("home", socket("herdr"));
  const sibling = await start(
    "sibling",
    socket(runtime === "shared" ? "herdr" : "other"),
  );
  return { home, sibling };
}

const asks = async (page: { call(method: string): Promise<any> }) =>
  ((await page.call("world.asks.get")) as { asks: Ask[] }).asks;

/** Siblings read each other every few seconds; wait for the next read. */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean) {
  const deadline = Date.now() + 12_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(100);
  }
}

async function ask(started: TestService, question: string) {
  const reply = (await (await askThroughCli(started, question)).json()) as {
    result: { id: string };
  };
  return reply.result.id;
}

test("a question asked in one World is answered from another, exactly once", async () => {
  const { home, sibling } = await worlds();
  const id = await ask(home.started, "Ship the release?");
  const [shown] = await until(
    () => asks(sibling.page),
    (list) => list.length === 1,
  );
  const peerId = shown!.id;
  expect(peerId).toMatch(new RegExp(`^peer~[a-f0-9]{24}~${id}$`));
  expect(shown!.question).toBe("Ship the release?");
  expect(shown!.home?.name).toMatch(/^Herdr World on port \d+$/);
  expect(shown!.home?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  // The home's places stay at home.
  expect(shown!.actor.connection_id).toBeUndefined();
  expect(shown!.actor.pane_id).toBeUndefined();

  // The owner answers in both Worlds at once: one answer wins.
  const results = await Promise.allSettled([
    sibling.page.call("world.ask.answer", {
      id: peerId,
      answer: "From the sibling",
    }),
    home.page.call("world.ask.answer", { id, answer: "From home" }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  // The losing answer says the question is closed; nothing else happened.
  const lost = results.find((result) => result.status === "rejected");
  expect(String((lost as PromiseRejectedResult).reason)).toMatch(
    /already|closed/i,
  );
  const winner =
    results[0]!.status === "fulfilled" ? "From the sibling" : "From home";
  const recorded = (await (
    await fetch(`${home.started.base}/api/world/cli`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${readWorldCliToken(home.started.service.paths.sessionSecret)}`,
      },
      body: JSON.stringify({ command: "ask get", params: { id } }),
    })
  ).json()) as { result: { answer?: { text: string; by: string } } };
  expect(recorded.result.answer).toMatchObject({ text: winner, by: "owner" });
  expect(await asks(home.page)).toEqual([]);
  expect(await asks(sibling.page)).toEqual([]);

  // A later answer from either World is refused, not recorded again.
  await expect(
    sibling.page.call("world.ask.answer", { id: peerId, answer: "Again" }),
  ).rejects.toThrow(/closed|not running/);
  await expect(
    home.page.call("world.ask.answer", { id, answer: "Again" }),
  ).rejects.toThrow();
}, 30_000);

test("a dismissal from another World closes the question at home", async () => {
  const { home, sibling } = await worlds();
  await ask(home.started, "Keep the old layout?");
  const [shown] = await until(
    () => asks(sibling.page),
    (list) => list.length === 1,
  );
  await sibling.page.call("world.ask.dismiss", { id: shown!.id });
  expect(await asks(home.page)).toEqual([]);
  expect(await asks(sibling.page)).toEqual([]);
}, 30_000);

test("a World on another runtime does not see the question", async () => {
  const { home, sibling } = await worlds("separate");
  await ask(home.started, "Only for this runtime?");
  // Give the sibling more than one read.
  await Bun.sleep(6_000);
  expect(await asks(sibling.page)).toEqual([]);
  expect((await asks(home.page)).map((entry) => entry.question)).toEqual([
    "Only for this runtime?",
  ]);
}, 30_000);

test("when the home stops, its questions leave the other World", async () => {
  const { home, sibling } = await worlds();
  await ask(home.started, "Still there?");
  const [shown] = await until(
    () => asks(sibling.page),
    (list) => list.length === 1,
  );
  await home.started.service.stop();
  await until(
    () => asks(sibling.page),
    (list) => list.length === 0,
  );
  await expect(
    sibling.page.call("world.ask.answer", { id: shown!.id, answer: "Yes" }),
  ).rejects.toThrow(/not running/);
}, 30_000);
