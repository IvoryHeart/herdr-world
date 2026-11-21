import { expect, test } from "bun:test";

// React captures browser globals; isolate them from native sequential tests,
// as in the other headless consumers.
if (process.env.HOST_PROFILES_TEST !== "1") {
  test("Add host and host cards in an isolated DOM", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HOST_PROFILES_TEST: "1" },
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
    HTMLInputElement: dom.HTMLInputElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { AddHostForm, HostCards, hostFoundMessage } = await import(
    "./HostProfiles"
  );

  const mount = async (element: React.ReactElement) => {
    document.body.innerHTML = "<div id='root'></div>";
    const root = createRoot(document.getElementById("root")!);
    await act(() => root.render(element));
    return root;
  };
  const type = async (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(() => {
      setter.call(input, value);
      input.dispatchEvent(
        new dom.Event("input", { bubbles: true }) as unknown as Event,
      );
    });
  };

  test("Add host asks for the machine only", async () => {
    const added: unknown[] = [];
    const root = await mount(
      <AddHostForm
        pending={null}
        feedback={null}
        onCancel={() => {}}
        onAdd={(host) => added.push(host)}
      />,
    );
    const inputs = [...document.querySelectorAll("input")];
    // An SSH name and a Windows tick: nothing about runtimes.
    expect(inputs.map((input) => input.type)).toEqual(["text", "checkbox"]);
    expect(document.body.textContent).not.toMatch(/herdr-core|socket|session/i);
    const submit = document.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    expect(submit.disabled).toBe(true);
    await type(inputs[0] as HTMLInputElement, " dev.example.test ");
    await act(() => submit.click());
    expect(added).toEqual([
      { type: "ssh", ssh_destination: "dev.example.test" },
    ]);
    await act(() => (inputs[1] as HTMLInputElement).click());
    await act(() => submit.click());
    expect(added[1]).toEqual({
      type: "ssh",
      ssh_destination: "dev.example.test",
      remote_platform: "windows",
    });
    await act(() => root.unmount());
  });

  test("what discovery found reads as one sentence", () => {
    const runtime = (kind: string, installed = true) => ({
      connection_id: kind,
      kind,
      version: null,
      installed,
      state: "connecting" as const,
      generation: 1,
    });
    const host = {
      label: "dev.example.test",
      discovery: "complete" as const,
      runtimes: [runtime("herdr"), runtime("herdr-core")],
    };
    expect(hostFoundMessage(host)).toBe(
      "Found Herdr and herdr-core on dev.example.test. Connecting.",
    );
    expect(hostFoundMessage({ ...host, runtimes: [runtime("herdr")] })).toBe(
      "Found Herdr on dev.example.test. Connecting.",
    );
    expect(
      hostFoundMessage({ ...host, runtimes: [runtime("herdr", false)] }),
    ).toBe("No runtime found on dev.example.test. Add one from Integrations.");
    expect(
      hostFoundMessage({
        ...host,
        discovery: "error",
        discovery_error: "ssh: connection refused",
        runtimes: [],
      }),
    ).toBe(
      "World could not look for runtimes on dev.example.test: ssh: connection refused.",
    );
  });

  test("an empty host offers a runtime; others do not nag", async () => {
    const offered: string[] = [];
    const entry = (id: string, state: "ready" | "empty") => ({
      id,
      label: `${id}.example.test`,
      type: "ssh" as const,
      windows: false,
      state,
      discovery: "complete" as const,
      connectionIds: state === "ready" ? [`${id}-runtime`] : [],
      installable:
        state === "empty"
          ? [
              { kind: "herdr", label: "Herdr TUI" },
              { kind: "herdr-core", label: "herdr-core" },
            ]
          : [],
    });
    const root = await mount(
      <HostCards
        hosts={[entry("one", "ready"), entry("spare", "empty")]}
        pending={null}
        onDiscover={() => {}}
        onRemove={() => {}}
        onAddRuntime={(host) => offered.push(host.id)}
      />,
    );
    const cards = [...document.querySelectorAll("[data-host]")];
    expect(cards.map((card) => card.getAttribute("data-host"))).toEqual([
      "one",
      "spare",
    ]);
    expect(cards[0]!.textContent).toContain("Ready");
    expect(cards[0]!.textContent).not.toContain("Add a runtime");
    expect(cards[1]!.textContent).toContain("No runtime found");
    expect(cards[1]!.textContent).toContain(
      "Can be installed here: Herdr TUI, herdr-core.",
    );
    const add = [...cards[1]!.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add a runtime"),
    )!;
    await act(() => add.click());
    expect(offered).toEqual(["spare"]);
    await act(() => root.unmount());
  });
}
