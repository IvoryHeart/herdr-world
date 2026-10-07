import { expect, mock, spyOn, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TERMINAL_FONT_FAMILY } from "../appearance";
import * as storeModule from "../store";
import * as connectionModule from "../useConnectionClient";
import type { ConnectionClient } from "../api";
import { __storeTesting, store } from "../store";
import { PopupOverlay } from "./PopupOverlay";

test("only the popup terminal cancels interface zoom", () => {
  const previous = store.get();
  const snapshot = spyOn(React, "useSyncExternalStore").mockImplementation(
    (_subscribe, getSnapshot) => getSnapshot(),
  );
  try {
    __storeTesting.replaceState({
      ...previous,
      popup: {
        terminal_id: "popup-terminal",
        title: "Popup",
        width: null,
        height: null,
      },
    });
    const markup = renderToStaticMarkup(
      React.createElement(PopupOverlay, {
        terminalTheme: {},
        terminalFontFamily: TERMINAL_FONT_FAMILY,
        terminalFontScale: 100,
      }),
    );
    const terminalStyle = markup.match(/<div style="([^"]*)"><\/div>/)?.[1];
    expect(terminalStyle).toContain("zoom:calc(1 / var(--ui-scale, 1))");
    expect(markup.match(/zoom:/g)).toHaveLength(1);
  } finally {
    snapshot.mockRestore();
    __storeTesting.replaceState(previous);
  }
});

test("font changes refit the existing popup and resize only its current attachment", () => {
  const popup = {
    terminal_id: "popup-terminal",
    title: "Popup",
    width: null,
    height: null,
  };
  let current = true;
  const call = mock(async () => undefined);
  const client: ConnectionClient = {
    connectionId: "popup-connection",
    generation: 1,
    serverRuntimeGeneration: 1,
    isCurrent: () => current,
    acceptsServerGeneration: () => true,
    call,
  };
  const terminal = { options: { fontFamily: TERMINAL_FONT_FAMILY } };
  let dimensions: { cols: number; rows: number } | undefined = {
    cols: 90,
    rows: 30,
  };
  const fit = {
    fit: mock(() => {
      // The family must change before measuring the new cell dimensions.
      expect(terminal.options.fontFamily).toBe(fontFamily);
    }),
    proposeDimensions: () => dimensions,
  };
  let fontFamily = TERMINAL_FONT_FAMILY;
  const refs: Array<{ current: unknown }> = [];
  let refIndex = 0;
  type Effect = {
    run: React.EffectCallback;
    deps: React.DependencyList | undefined;
  };
  let effects: Effect[] = [];
  const spies = [
    spyOn(storeModule, "useOperationalStore").mockReturnValue(
      store as unknown as ReturnType<typeof storeModule.useOperationalStore>,
    ),
    spyOn(storeModule, "useStoreSelector").mockImplementation((selector) =>
      selector({ ...store.get(), popup }),
    ),
    spyOn(connectionModule, "useConnectionClient").mockReturnValue(client),
    spyOn(React, "useRef").mockImplementation((initial) => {
      const index = refIndex++;
      return (refs[index] ??= { current: initial });
    }),
    spyOn(React, "useState").mockImplementation(() => [0, () => {}]),
    spyOn(React, "useEffect").mockImplementation((run, deps) => {
      effects.push({ run, deps });
    }),
  ];
  const terminalTheme = {};
  const render = () => {
    refIndex = 0;
    effects = [];
    PopupOverlay({
      terminalTheme,
      terminalFontFamily: fontFamily,
      terminalFontScale: 100,
    });
    return effects;
  };
  try {
    let previousEffects = render();
    // Seed the refs normally filled by mount/attach, without a browser or PTY.
    refs[1].current = terminal;
    refs[2].current = fit;
    refs[3].current = popup.terminal_id;
    const changeFont = (family: string) => {
      fontFamily = family;
      const nextEffects = render();
      const changed = nextEffects.filter((effect, index) =>
        effect.deps?.some(
          (dep, depIndex) =>
            !Object.is(dep, previousEffects[index].deps?.[depIndex]),
        ),
      );
      // Changing family must not restart the mount/attach effect.
      expect(changed).toHaveLength(1);
      for (const effect of changed) effect.run();
      previousEffects = nextEffects;
      expect(refs[1].current).toBe(terminal);
      expect(terminal.options.fontFamily).toBe(family);
    };

    changeFont('"Custom Mono", monospace');
    expect(fit.fit).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("terminal.resize", {
      terminal_id: popup.terminal_id,
      cols: 90,
      rows: 30,
      relay_active: false,
    });
    call.mockClear();

    // Pending attach still fits locally; its completion sends the settled size.
    refs[3].current = null;
    changeFont("Pending Mono");
    refs[3].current = "replaced-terminal";
    changeFont("Replacement Mono");
    refs[3].current = popup.terminal_id;
    current = false;
    changeFont("Retired Client Mono");
    current = true;
    dimensions = undefined;
    changeFont(TERMINAL_FONT_FAMILY);
    expect(fit.fit).toHaveBeenCalledTimes(5);
    expect(call).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies.reverse()) spy.mockRestore();
  }
});
