import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorldCliToken } from "../config/session-secret";
import { configureServerLogger } from "../utils/logger";
import { SHIPYARD_CLI_PATH, SHIPYARD_PATH } from "../shipyard/http";
import { shipyardTransport } from "../cli/shipyard";
import { createTestCli } from "../cli/test-context";
import { login, startTestService } from "./testing/services";

afterAll(() => configureServerLogger("info"));

test("composed service exposes authenticated catalog, real bound ports and the CLI transport", async () => {
  configureServerLogger("error");
  const root = mkdtempSync(join(tmpdir(), "shipyard-service-"));
  const cli = createTestCli();
  // Its own registry: parallel test files share the isolated home's default
  // one, and this test counts the instances it lists.
  const { service, base, connected } = await startTestService(
    root,
    {},
    { HERDR_WORLD_INSTANCE_REGISTRY_DIR: join(root, "instances") },
  );
  try {
    await connected;
    expect((await fetch(`${base}${SHIPYARD_PATH}`)).status).toBe(401);
    const cookie = await login(base, "world-service-test-password");
    expect(
      (
        await fetch(`${base}${SHIPYARD_PATH}`, {
          headers: { cookie, origin: "https://example.com" },
        })
      ).status,
    ).toBe(403);
    const response = await fetch(`${base}${SHIPYARD_PATH}`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const catalog = await response.json();
    expect(catalog.instances.items).toHaveLength(1);
    expect(catalog.instances.items[0].port).toBe(service.port);
    expect(catalog.instances.items[0].version).toBe("0.0.0-test");
    expect(catalog.instances.items[0].openUrl).toBe(`${base}/`);
    const body = JSON.stringify(catalog);
    for (const secret of [
      root,
      "missing-control.sock",
      "world-service-test-password",
      '"pid"',
    ])
      expect(body).not.toContain(secret);
    const token = readWorldCliToken(join(root, "session-secret.json"))!;
    cli.context.runtime.env = {
      HERDR_WORLD_URL: base,
      HERDR_WORLD_TOKEN: token,
    };
    const reply = await shipyardTransport(cli.context, "list", {});
    expect(reply.ok).toBe(true);
    expect(reply.result).toEqual(
      expect.objectContaining({
        instances: expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ port: service.port }),
          ]),
        }),
      }),
    );
    expect(
      (
        await fetch(`${base}${SHIPYARD_CLI_PATH}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, origin: base },
          body: JSON.stringify({ command: "list" }),
        })
      ).status,
    ).toBe(403);
  } finally {
    await service.stop();
    cli.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
