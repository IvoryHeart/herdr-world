import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
