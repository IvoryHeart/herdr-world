import { afterEach, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { worldCliToken } from "../config/session-secret";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "./command";
import { createConnectionsCommand } from "./connections";
import { runCli } from "./index";
import { createTestCli, type TestCli } from "./test-context";

let cli: TestCli;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
afterEach(() => {
  fetchSpy?.mockRestore();
  cli?.cleanup();
});

function fixture(
  lock: unknown = {
    pid: process.pid,
    port: 19041,
    host: "127.0.0.1",
    tls: false,
  },
) {
  cli = createTestCli();
  cli.writeConfig("HOST=127.0.0.1\nPORT=19040\n");
  const root = join(cli.home, "preview-data");
  mkdirSync(root, { mode: 0o700 });
  cli.context.runtime.env = {
    HERDR_WORLD_DATA_DIR: root,
    HERDR_WORLD_URL: "http://127.0.0.1:19040",
    HERDR_WORLD_TOKEN: "ignored-agent-token",
  };
  if (lock !== null)
    writeFileSync(join(root, "instance.lock"), JSON.stringify(lock));
  writeFileSync(
    join(root, "session-secret.json"),
    JSON.stringify({
      version: 1,
      secret: "a".repeat(64),
      credentialFingerprint: "b".repeat(64),
    }),
  );
  const path = join(root, "connections.json");
  return {
    root,
    path,
    command: (args: string[], probe = async () => false) =>
      runCli(["connections", ...args], cli.context, [
        createConnectionsCommand({ probe, herdrInstalled: async () => false }),
      ]),
  };
}

test.each(["add", "remove", "set-default"])(
  "%s uses the live registry owner's address and token, ignoring agent overrides",
  async (command) => {
    const f = fixture();
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
      input,
      init,
    ) => {
      expect(String(input)).toBe("http://127.0.0.1:19041/api/connections/cli");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${worldCliToken("a".repeat(64))}`,
      );
      expect(JSON.parse(String(init?.body))).toMatchObject({
        command,
        params: { id: "core-test", registry_path: f.path },
      });
      return Response.json({ ok: true });
    }) as typeof fetch);
    expect(
      await f.command([
        command,
        "core-test",
        ...(command === "add" ? ["--core"] : []),
      ]),
    ).toBe(EXIT_OK);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(existsSync(f.path)).toBe(false); // Only the live service may save.
  },
);

test.each([
  [401, "unauthorized", "authentication"],
  [403, "forbidden", "refused"],
  [503, "unavailable", "unavailable"],
  [503, '{"ok":true}', "unavailable"],
  [302, "redirect", "not accepted"],
  [404, "<html>not found</html>", "not accepted"],
  [204, null, "unreadable"],
  [200, "not-json", "unreadable"],
  [200, "{}", "confirm"],
])(
  "HTTP %s with %s gives an actionable service error",
  async (status, body, reason) => {
    const f = fixture();
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body === null ? null : String(body), {
        status: Number(status),
      }),
    );
    expect(
      await f.command(["add", "core-test", "--core"], async () => true),
    ).toBe(EXIT_FAILURE);
    expect(cli.errors.join("\n")).toContain("http://127.0.0.1:19041");
    expect(cli.errors.join("\n")).toContain(`HTTP ${status}`);
    expect(cli.errors.join("\n")).toContain(String(reason));
    expect(cli.errors.join("\n")).toContain("No offline write was attempted");
    expect(cli.errors.join("\n")).not.toMatch(
      /JSON Parse|SyntaxError|Unexpected/,
    );
    expect(existsSync(f.path)).toBe(false);
  },
);

test("a missing local token names the service and how to restore it", async () => {
  const f = fixture();
  rmSync(join(f.root, "session-secret.json"));
  fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("must not send without token"),
  );
  expect(await f.command(["add", "core-test", "--core"])).toBe(EXIT_FAILURE);
  expect(cli.errors[0]).toContain("http://127.0.0.1:19041");
  expect(cli.errors[0]).toContain("HERDR_WORLD_DATA_DIR");
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(existsSync(f.path)).toBe(false);
});

test("a legacy port-only lock still selects the separate instance", async () => {
  const f = fixture({ pid: process.pid, port: 19041 });
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ ok: true }),
  );
  expect(await f.command(["add", "core-test", "--core"])).toBe(EXIT_OK);
  expect(String(fetchSpy.mock.calls[0]![0])).toBe(
    "http://127.0.0.1:19041/api/connections/cli",
  );
});

test.each([
  ["0.0.0.0", true, "https://127.0.0.1:19041/api/connections/cli"],
  ["::", false, "http://[::1]:19041/api/connections/cli"],
])(
  "the recorded %s bind uses its own TLS setting and loopback address",
  async (host, tls, endpoint) => {
    const f = fixture({ pid: process.pid, port: 19041, host, tls });
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ ok: true }),
    );
    expect(await f.command(["add", "core-test", "--core"])).toBe(EXIT_OK);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(endpoint);
  },
);

test("a starting owner without a bound port refuses offline writes", async () => {
  const f = fixture({ pid: process.pid, port: 0 });
  fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("must not send before bind"),
  );
  expect(await f.command(["add", "core-test", "--core"])).toBe(EXIT_FAILURE);
  expect(cli.errors[0]).toContain("wait for it to start or stop it");
  expect(existsSync(f.path)).toBe(false);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("an unreachable lock owner never falls back to an offline save", async () => {
  const f = fixture();
  fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Connection refused"),
  );
  expect(await f.command(["add", "core-test", "--core"])).toBe(EXIT_FAILURE);
  expect(cli.errors.join("\n")).toContain("http://127.0.0.1:19041");
  expect(cli.errors.join("\n")).toContain("Connection refused");
  expect(cli.errors.join("\n")).toContain("stop");
  expect(existsSync(f.path)).toBe(false);
});

test("an unowned preview saves offline without probing the installed service", async () => {
  const f = fixture(null);
  fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("must not contact another World"),
  );
  expect({
    code: await f.command(["add", "core-test", "--core"], async () => {
      throw new Error("must not probe installed service");
    }),
    errors: cli.errors,
  }).toEqual({ code: EXIT_OK, errors: [] });
  expect(JSON.parse(readFileSync(f.path, "utf8")).profiles[0].id).toBe(
    "core-test",
  );
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("a preview cannot restart the installed service", async () => {
  const f = fixture();
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ ok: true }),
  );
  expect(
    await f.command(
      ["add", "core-test", "--core", "--restart"],
      async () => true,
    ),
  ).toBe(EXIT_FAILURE);
  expect(cli.errors.join("\n")).toContain("omit --restart");
  expect(cli.commands).toEqual([]);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([400, 500])(
  "a structured usage reply at HTTP %s preserves the correct exit code",
  async (status) => {
    const f = fixture();
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          ok: false,
          code: "usage",
          error: "connection already exists: core-test",
        },
        { status },
      ),
    );
    expect(
      await f.command(["add", "core-test", "--core"], async () => true),
    ).toBe(status === 400 ? EXIT_USAGE : EXIT_FAILURE);
    expect(cli.errors[0]).toContain("http://127.0.0.1:19041");
    expect(cli.errors[0]).toContain("connection already exists");
    expect(existsSync(f.path)).toBe(false);
  },
);
