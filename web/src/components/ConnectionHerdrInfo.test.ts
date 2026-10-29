import { expect, mock, spyOn, test } from "bun:test";

if (process.env.HERDR_IDENTITY_DOM_TEST !== "1") {
  test("connection identity uses qualified reads and retires freshness in an isolated DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, HERDR_IDENTITY_DOM_TEST: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { bridge } = await import("../api");
  const { ConnectionHerdrInfo } = await import("./ConnectionHerdrInfo");
  const { observeHerdrIdentity, HERDR_IDENTITY_TTL_MS } = await import(
    "../../../shared/herdrIdentity"
  );
  type Client = import("../api").ConnectionClient;
  type Connection = import("../api").ConnectionSummary;
  function mockFetch(
    run: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
  ) {
    return spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(run, { preconnect: globalThis.fetch.preconnect }),
    );
  }
  const connection: Connection = {
    id: "host-a",
    label: "Host A",
    generation: 8,
    source: "test",
    is_default: false,
    state: "ready",
    type: "ssh",
  };
  const headers = (id = "host-a", generation = 8) => ({
    "X-Herdr-Connection-Id": id,
    "X-Herdr-Connection-Generation": String(generation),
  });
  const client = (
    id = "host-a",
    generation = 8,
    current = () => true,
  ): Client => ({
    connectionId: id,
    generation: 2,
    serverRuntimeGeneration: generation,
    isCurrent: current,
    acceptsServerGeneration: (value) => value === generation,
    call: mock(async () => {
      throw new Error("No mutation should execute");
    }),
  });
  async function mounted(
    run: (
      host: HTMLDivElement,
      render: (value?: Connection) => Promise<void>,
    ) => Promise<void>,
  ) {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const render = async (value = connection) => {
      await act(async () =>
        root.render(createElement(ConnectionHerdrInfo, { connection: value })),
      );
    };
    try {
      await run(host, render);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      mock.restore();
    }
  }

  test("identity and explicit retry stay on this host/generation; installed version and upgrade remain unavailable", async () => {
    await mounted(async (host, render) => {
      let now = 100_000;
      spyOn(Date, "now").mockImplementation(() => now);
      const owner = client();
      spyOn(bridge, "connection").mockReturnValue(owner);
      const fetcher = mockFetch(async (path, init) => {
        expect(String(path)).toBe(
          "/api/connections/host-a/herdr-info?connection_generation=8",
        );
        expect(init?.method ?? "GET").toBe("GET");
        return Response.json(
          observeHerdrIdentity({ version: "0.9.5", protocol: 22 }, now),
          { headers: headers() },
        );
      });
      await render();
      expect(host.textContent).toContain("Running Herdr 0.9.5 · protocol 22");
      expect(host.textContent).toContain("Supported by this World");
      expect(host.textContent).toContain("Installed binary: unknown");
      expect(host.textContent).toContain("Upgrade unavailable here");
      now += 1000;
      await act(async () => host.querySelector("button")!.click());
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(owner.call).not.toHaveBeenCalled();
    });
  });

  test("idle expiry withdraws compatibility without polling or enabling update", async () => {
    await mounted(async (host, render) => {
      let now = 100_000;
      spyOn(Date, "now").mockImplementation(() => now);
      let expire: (() => void) | undefined;
      const original = window.setTimeout.bind(window);
      spyOn(window, "setTimeout").mockImplementation(((
        callback: () => void,
        delay?: number,
      ) => {
        if (delay === HERDR_IDENTITY_TTL_MS) {
          expire = callback;
          return 987654;
        }
        return original(callback, delay);
      }) as typeof window.setTimeout);
      spyOn(bridge, "connection").mockReturnValue(client());
      const fetcher = mockFetch(async () =>
        Response.json(
          observeHerdrIdentity({ version: "0.9.5", protocol: 22 }, now),
          { headers: headers() },
        ),
      );
      await render();
      expect(host.textContent).toContain("Supported by this World");
      expect(expire).toBeDefined();
      now += HERDR_IDENTITY_TTL_MS;
      await act(async () => expire!());
      expect(host.textContent).toContain("stale, compatibility unknown");
      expect(host.textContent).not.toContain("Supported by this World");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  test("a retired host cannot publish its late identity into its replacement", async () => {
    await mounted(async (host, render) => {
      let current = true;
      const first = client("host-a", 8, () => current);
      spyOn(bridge, "connection").mockImplementation((id) =>
        id === "host-a" ? first : client("host-b", 9),
      );
      const pending = Promise.withResolvers<Response>();
      mockFetch(async (path) =>
        String(path).includes("host-a/")
          ? pending.promise
          : Response.json(
              observeHerdrIdentity(
                { version: "0.9.6", protocol: 22 },
                Date.now(),
              ),
              { headers: headers("host-b", 9) },
            ),
      );
      await render();
      current = false;
      await render({
        ...connection,
        id: "host-b",
        label: "Host B",
        generation: 9,
      });
      await act(async () =>
        pending.resolve(
          Response.json(
            observeHerdrIdentity(
              { version: "9.9.9", protocol: 99 },
              Date.now(),
            ),
            { headers: headers() },
          ),
        ),
      );
      expect(host.textContent).toContain("Running Herdr 0.9.6");
      expect(host.textContent).not.toContain("9.9.9");
      expect(host.textContent).not.toContain("too new");
    });
  });

  test("a stalled check becomes retryable unknown and refuses its late reply", async () => {
    await mounted(async (host, render) => {
      let timeout: (() => void) | undefined;
      const original = window.setTimeout.bind(window);
      spyOn(window, "setTimeout").mockImplementation(((
        callback: () => void,
        delay?: number,
      ) => {
        if (delay === 8000) {
          timeout = callback;
          return 987653;
        }
        return original(callback, delay);
      }) as typeof window.setTimeout);
      spyOn(bridge, "connection").mockReturnValue(client());
      const pending = Promise.withResolvers<Response>();
      mockFetch(async () => pending.promise);
      await render();
      expect(host.textContent).toContain("Checking this host");
      expect(timeout).toBeDefined();
      await act(async () => timeout!());
      expect(host.textContent).toContain("Running Herdr version unknown");
      expect(host.querySelector("button")?.disabled).toBe(false);
      await act(async () =>
        pending.resolve(
          Response.json(
            observeHerdrIdentity(
              { version: "9.9.9", protocol: 99 },
              Date.now(),
            ),
            { headers: headers() },
          ),
        ),
      );
      expect(host.textContent).not.toContain("9.9.9");
    });
  });

  test.each([
    [13, "too old"],
    [23, "too new"],
    [21, "incompatible"],
  ] as const)(
    "fresh protocol %s reports %s without an upgrade action",
    async (protocol, expected) => {
      await mounted(async (host, render) => {
        const owner = client();
        spyOn(bridge, "connection").mockReturnValue(owner);
        mockFetch(async () =>
          Response.json(
            observeHerdrIdentity({ version: "0.9.5", protocol }, Date.now()),
            { headers: headers() },
          ),
        );
        await render();
        expect(host.textContent).toContain(expected);
        expect(host.textContent).toContain("Upgrade unavailable here");
        expect(owner.call).not.toHaveBeenCalled();
      });
    },
  );

  test.each([null, { version: "0.9.5", protocol: 22 }, "timeout"])(
    "unknown evidence %j never becomes skew or an update action",
    async (value) => {
      await mounted(async (host, render) => {
        spyOn(bridge, "connection").mockReturnValue(client());
        mockFetch(async () => {
          if (value === "timeout") throw new Error("synthetic SSH timeout");
          return Response.json(value, { headers: headers() });
        });
        await render();
        expect(host.textContent).toContain("Running Herdr version unknown");
        expect(host.textContent).not.toContain("too old");
        expect(host.textContent).not.toContain("too new");
        expect(host.textContent).not.toContain("synthetic SSH timeout");
        expect(host.textContent).toContain("Upgrade unavailable here");
      });
    },
  );
}
