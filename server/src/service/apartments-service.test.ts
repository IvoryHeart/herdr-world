import { expect, test } from "bun:test";
import { memoryApartmentsPort } from "../storage/apartments";
import { createApartmentsService } from "./apartments-service";

const NOW = 1_800_000_000_000;
const SESSION = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/**
 * A core agent's rows carry no session; the service asks the session Chat
 * knows (a process record, a linked Codex session) while the agent lives.
 */
test("a core agent's session Chat knows is the one its resident keeps", async () => {
  const asked: string[] = [];
  const lease = {};
  const none = {
    has: () => false,
    list: () => [],
    readyRuntimeLease: () => null,
  };
  const service = createApartmentsService({
    port: memoryApartmentsPort([], () => NOW),
    now: () => NOW,
    tui: () => none,
    core: () => ({
      manager: {
        has: (id) => id === "core",
        list: () => [{ id: "core", label: "core host" }],
        readyRuntimeLease: () => lease,
      },
      hostRuntime: () => ({
        agentSessionFiles: {} as never,
        agentSessions: () => ({
          knownSession: async (address, agent) => {
            asked.push(`${address}:${agent}`);
            return { id: SESSION, holder: "1:70" };
          },
        }),
      }),
    }),
    publish: () => {},
    log: () => {},
  });
  const pane = { pane_id: "t1", terminal_id: "t1", agent: "claude" };
  service.fresh(() => {})("core", 1, [pane], NOW - 1000, [], {});
  service.complete(() => {})("core", 1, []);
  await service.apartments.settled();
  expect(asked).toEqual(["t1:claude"]);
  expect(service.apartments.list().residents[0]).toMatchObject({
    runtime: "herdr-core",
    connection_label: "core host",
    session_id: SESSION,
  });
});
