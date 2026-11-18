import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorldHost } from "../worldHosts";
import { WorldViewPicker } from "./WorldViewPicker";

const hosts: WorldHost[] = ["alpha", "beta"].map((id, index) => ({
  id,
  label: `Synthetic ${id}`,
  runtime: "herdr",
  state: "ready",
  generation: index + 1,
  endpoint: `synthetic-${id}`,
}));

const props = {
  view: "town" as const,
  onSelect: () => {},
  onExitZen: () => {},
  hosts: {
    connections: hosts,
    ids: null,
    explanation: "",
    onChange: () => {},
  },
};

test("desktop's view picker leaves Hosts to the top bar", () => {
  const markup = renderToStaticMarkup(
    <WorldViewPicker {...props} mobile={false} />,
  );
  expect(markup).not.toContain("Hosts");
});

// DOM globals must not leak into the other tests.
if (process.env.HERDR_WORLD_VIEW_PICKER_DOM_TEST === "1") registerDomTests();
else
  test("the phone corner menu holds the Hosts filter, in an isolated runtime", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HERDR_WORLD_VIEW_PICKER_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15_000);

function registerDomTests() {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let browser: import("happy-dom").Window;

  beforeAll(async () => {
    const { Window } = await import("happy-dom");
    browser = new Window({ url: "http://localhost" });
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      localStorage: browser.localStorage,
      Event: browser.Event,
      CustomEvent: browser.CustomEvent,
      KeyboardEvent: browser.KeyboardEvent,
      HTMLElement: browser.HTMLElement,
      Element: browser.Element,
      Node: browser.Node,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
  });
  afterAll(async () => {
    await browser.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  test("Hosts in the phone menu changes the top bar's one filter", async () => {
    // The real manager reads the operational store; its opening is the point.
    mock.module("../components/ConnectionSwitcher", () => ({
      ConnectionManagerDialog: ({ onClose }: { onClose(): void }) => (
        <div role="dialog" aria-label="Manage connections">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      ),
    }));
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { HostsControl } = await import("./HostsControl");
    const { useHostsFilter } = await import("./hostsFilter");
    const { WorldViewPicker: Picker } = await import("./WorldViewPicker");

    function Harness() {
      const filter = useHostsFilter(hosts.map(({ id }) => id));
      const control = {
        connections: hosts,
        ids: filter.ids,
        explanation: filter.explanation,
        onChange: filter.setIds,
      };
      return (
        <>
          <HostsControl {...control} />
          <Picker {...props} mobile hosts={control} />
        </>
      );
    }

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    const query = <T extends Element>(selector: string) =>
      document.querySelector<T>(selector);
    const button = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) => candidate.textContent?.startsWith(name),
      );
    const topbarLabel = () =>
      query(".connection-switcher-label")?.textContent ?? "";
    const press = async (element: HTMLElement | null | undefined) => {
      expect(element).toBeTruthy();
      await act(async () => element!.click());
    };

    await press(query('[aria-label^="Switch view"]'));
    const item = query<HTMLButtonElement>('[role="menu"] [role="menuitem"]');
    expect(item?.textContent).toBe("HostsAll hosts");

    await press(item);
    const panel = query('[role="group"][aria-label="Hosts filter"]');
    expect(panel).toBeTruthy();
    expect(query('[role="menu"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe("All hosts");

    await press(
      panel!.querySelector<HTMLInputElement>('[aria-label="Synthetic beta"]'),
    );
    expect(topbarLabel()).toBe("1 hosts");
    // The panel stays, so the next host is one more tap.
    expect(
      query<HTMLInputElement>('[aria-label="Synthetic beta"]')?.checked,
    ).toBe(false);

    await press(query('[aria-label="Synthetic beta"]'));
    expect(topbarLabel()).toBe("2 hosts");
    await press(button("All hosts"));
    expect(topbarLabel()).toBe("All hosts");

    // Reopening the corner menu starts at the views again.
    await press(query('[aria-label^="Switch view"]'));
    expect(query('[aria-label="Hosts filter"]')).toBeNull();
    await press(query('[aria-label^="Switch view"]'));
    expect(query('[role="menu"]')).toBeTruthy();
    expect(query('[aria-label="Hosts filter"]')).toBeNull();

    await press(query('[role="menu"] [role="menuitem"]'));
    await press(
      query('[aria-label="Hosts filter"]')?.querySelector<HTMLButtonElement>(
        "button:last-of-type",
      ),
    );
    expect(query('[aria-label="Hosts filter"]')).toBeNull();
    expect(
      query('[role="dialog"][aria-label="Manage connections"]'),
    ).toBeTruthy();
    await press(button("Close"));
    expect(query('[role="dialog"]')).toBeNull();

    await act(async () => root.unmount());
    host.remove();
  });
}
