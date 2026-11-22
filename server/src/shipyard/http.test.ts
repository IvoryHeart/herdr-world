import { expect, test } from "bun:test";
import {
  createShipyardHttp,
  handleShipyardCli,
  SHIPYARD_CLI_PATH,
  SHIPYARD_PATH,
} from "./http";
import { ShipyardService } from "./service";
import { githubFixture } from "./testing/fixture";

function setup() {
  const fixture = githubFixture();
  const service = new ShipyardService({
    run: fixture.run,
    source: () => ({ enabled: true, generation: 0 }),
    projects: async () => ({ projects: [], pending: 0, omitted: 0 }),
    instances: () => ({ items: [], complete: true, detail: null }),
  });
  return { fixture, service, http: createShipyardHttp(service) };
}
const request = (suffix = "", init?: RequestInit) =>
  new Request(`http://localhost${SHIPYARD_PATH}${suffix}`, init);

test("catalog, pipeline and refresh expose the shared contract and no-store", async () => {
  const { service, http } = setup();
  const catalog = await http(request(), SHIPYARD_PATH);
  expect((await catalog!.json()).instances.items).toEqual([]);
  const pipeline = await http(
    request("?repo=example-org/widgets"),
    SHIPYARD_PATH,
  );
  expect(pipeline!.headers.get("cache-control")).toBe("no-store");
  const body = await pipeline!.json();
  expect(body.data.waiting.pullRequests[0].number).toBe(42);
  const refresh = await http(
    request("/refresh?repo=example-org/widgets", { method: "POST" }),
    `${SHIPYARD_PATH}/refresh`,
  );
  expect((await refresh!.json()).lastSuccessAt).toBe(body.lastSuccessAt);
  service.close();
});

test("invalid repositories, extra input, methods and mutations refuse before gh", async () => {
  const { service, fixture, http } = setup();
  for (const suffix of [
    "?repo=--help",
    "?repo=a/b&repo=c/d",
    "?host=example.com",
    "?repo=a/b&create=true",
  ])
    expect((await http(request(suffix), SHIPYARD_PATH))!.status).toBe(400);
  expect(
    (await http(
      request("/refresh", { method: "POST" }),
      `${SHIPYARD_PATH}/refresh`,
    ))!.status,
  ).toBe(400);
  expect(
    (await http(
      request("/refresh?repo=a/b", { method: "POST", body: "{}" }),
      `${SHIPYARD_PATH}/refresh`,
    ))!.status,
  ).toBe(400);
  expect(
    (await http(
      request("/release", { method: "POST" }),
      `${SHIPYARD_PATH}/release`,
    ))!.status,
  ).toBe(404);
  expect(
    (await http(request("?repo=a/b", { method: "PUT" }), SHIPYARD_PATH))!
      .status,
  ).toBe(405);
  expect(fixture.calls).toEqual([]);
  service.close();
});

test("CLI route enforces local-only, no-Origin, token admission and read-only verbs", async () => {
  const { service, fixture } = setup();
  const cliRequest = (body: unknown, headers: Record<string, string> = {}) =>
    new Request(`http://localhost${SHIPYARD_CLI_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const deps = {
    service,
    serverPort: 19091,
    bearerAuth: (req: Request) =>
      req.headers.get("authorization") === "Bearer synthetic-token"
        ? (true as const)
        : null,
  };
  const local = { address: "127.0.0.1", port: 19092 };
  expect(
    (await handleShipyardCli(cliRequest({ command: "list" }), local, deps))
      .status,
  ).toBe(401);
  expect(
    (
      await handleShipyardCli(
        cliRequest(
          { command: "list" },
          {
            authorization: "Bearer synthetic-token",
            origin: "http://localhost",
          },
        ),
        local,
        deps,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleShipyardCli(
        cliRequest(
          { command: "list" },
          { authorization: "Bearer synthetic-token" },
        ),
        { ...local, address: "192.0.2.1" },
        deps,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleShipyardCli(
        cliRequest(
          { command: "tag", params: { repo: "a/b" } },
          { authorization: "Bearer synthetic-token" },
        ),
        local,
        deps,
      )
    ).status,
  ).toBe(400);
  expect(fixture.calls).toEqual([]);
  const reply = await handleShipyardCli(
    cliRequest(
      { command: "show", params: { repo: "example-org/widgets" } },
      { authorization: "Bearer synthetic-token" },
    ),
    local,
    deps,
  );
  expect(reply.status).toBe(200);
  expect((await reply.json()).result.data.waiting.complete).toBe(true);
  service.close();
});
