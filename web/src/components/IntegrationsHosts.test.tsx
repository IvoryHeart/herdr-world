import { expect, test } from "bun:test";

// React and the store capture browser globals; isolate them from native
// sequential tests, as in the other headless consumers.
if (process.env.INTEGRATIONS_HOSTS_TEST !== "1") {
  test("Integrations runtimes per host in an isolated DOM", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, INTEGRATIONS_HOSTS_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code) throw new Error(`${out}\n${err}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  const { Window } = await import("happy-dom");
  const dom = new Window({ url: "https://world.example.test" });
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    CustomEvent: dom.CustomEvent,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  const { act, useState } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { parseIntegrations } = await import("../integrations");
  const { coreInstallTarget, RuntimeHosts } = await import(
    "./IntegrationsHosts"
  );

  const runtime = (id: string, kind: string) => ({
    connection_id: id,
    kind,
    version: null,
    installed: true,
    state: "ready",
    generation: 1,
  });
  const snapshot = parseIntegrations({
    observedAt: 1,
    integrations: [],
    vault: {},
    hosts: [
      {
        host_id: "host-local",
        label: "This computer",
        runtimes: [runtime("tui", "herdr"), runtime("core", "herdr-core")],
        available_runtimes: [],
      },
      {
        host_id: "host-remote",
        label: "dev.example.test",
        runtimes: [runtime("remote", "herdr")],
        available_runtimes: [{ kind: "herdr-core", label: "herdr-core" }],
      },
      {
        host_id: "host-spare",
        label: "spare.example.test",
        runtimes: [],
        available_runtimes: [
          { kind: "herdr", label: "Herdr TUI" },
          { kind: "herdr-core", label: "herdr-core" },
        ],
      },
      { label: "unreadable" },
    ],
  });

  test("the registry's hosts parse, unreadable ones skipped", () => {
    expect(snapshot.hosts?.map((host) => host.host_id)).toEqual([
      "host-local",
      "host-remote",
      "host-spare",
    ]);
    expect(snapshot.hosts?.[1]?.available_runtimes).toEqual([
      { kind: "herdr-core", label: "herdr-core" },
    ]);
  });

  test("herdr-core installs on this computer or any saved Unix SSH host", () => {
    const entry = (fields: Record<string, unknown>) =>
      ({
        id: "host-x",
        label: "x",
        windows: false,
        state: "empty",
        discovery: "complete",
        connectionIds: [],
        installable: [],
        ...fields,
      }) as unknown as Parameters<typeof coreInstallTarget>[0];
    expect(coreInstallTarget(entry({ type: "local" }))).toEqual({
      type: "local",
    });
    // Added by SSH name only, nothing found yet: the installer takes it.
    expect(
      coreInstallTarget(
        entry({ type: "ssh", sshDestination: "spare.example.test" }),
      ),
    ).toEqual({ type: "ssh", destination: "spare.example.test" });
    // No remote Windows steps: the manual hint instead of a failing button.
    expect(
      coreInstallTarget(
        entry({
          type: "ssh",
          sshDestination: "win.example.test",
          windows: true,
        }),
      ),
    ).toBeNull();
    expect(coreInstallTarget(undefined)).toBeNull();
  });

  test("each host lists its runtimes and can add another", async () => {
    const row = (id: string, label: string) => ({
      id: `runtime:${id}`,
      kind: "runtime" as const,
      type: "herdr",
      label,
      provides: [],
      state: "connected" as const,
      detail: "",
      settings: [],
      control: "connection" as const,
    });
    const rows = [
      row("tui", "Herdr"),
      row("core", "herdr-core"),
      row("remote", "Herdr"),
      row("stray", "Unplaced runtime"),
    ];
    function Harness({ terms }: { terms: string[] }) {
      const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
      return (
        <RuntimeHosts
          hosts={snapshot.hosts!}
          rows={rows.filter(({ label }) =>
            terms.every((term) => label.toLowerCase().includes(term)),
          )}
          terms={terms}
          rowFor={(entry) => (
            <li key={entry.id} data-row={entry.id}>
              {entry.label}
            </li>
          )}
          open={open}
          toggle={(id) =>
            setOpen((current) => {
              const next = new Set(current);
              if (!next.delete(id)) next.add(id);
              return next;
            })
          }
          busy={false}
          run={async () => true}
        />
      );
    }
    document.body.innerHTML = "<div id='root'></div>";
    const root = createRoot(document.getElementById("root")!);
    await act(() => root.render(<Harness terms={[]} />));
    const sections = [
      ...document.querySelectorAll("section[data-integration]"),
    ];
    expect(
      sections.map((section) => section.getAttribute("aria-label")),
    ).toEqual(["This computer", "dev.example.test", "spare.example.test"]);
    const rowsOf = (section: Element) =>
      [...section.querySelectorAll("[data-row]")].map((item) =>
        item.getAttribute("data-row"),
      );
    expect(rowsOf(sections[0]!)).toEqual(["runtime:tui", "runtime:core"]);
    expect(rowsOf(sections[1]!)).toEqual(["runtime:remote"]);
    expect(sections[2]!.textContent).toContain(
      "No runtime found on this host.",
    );
    // A runtime no host claims still shows, after the hosts.
    expect(
      document.querySelector('#root > ul [data-row="runtime:stray"]'),
    ).not.toBeNull();

    const add = sections[2]!.querySelector<HTMLButtonElement>(
      'button[aria-label="Add a runtime to spare.example.test"]',
    )!;
    expect(add.getAttribute("aria-expanded")).toBe("false");
    await act(() => add.click());
    const choices = [
      ...sections[2]!.querySelectorAll("[data-runtime-choice]"),
    ].map((choice) => choice.getAttribute("data-runtime-choice"));
    expect(choices).toEqual(["herdr", "herdr-core"]);
    expect(sections[2]!.textContent).toContain("Look again");
    // Nothing nags a host that already runs something.
    expect(sections[1]!.querySelector("[data-runtime-choice]")).toBeNull();

    // A search keeps hosts with matching rows or a matching name.
    await act(() => root.render(<Harness terms={["spare"]} />));
    expect(
      [...document.querySelectorAll("section[data-integration]")].map(
        (section) => section.getAttribute("aria-label"),
      ),
    ).toEqual(["spare.example.test"]);
    await act(() => root.unmount());
  });
}
