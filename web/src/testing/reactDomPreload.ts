// React 18 detects DOM event support at module initialization. Isolated DOM
// tests preload this environment before components import react-dom portals.
import { Window } from "happy-dom";
const browser = new Window({ url: "http://localhost" });
for (const [key, value] of Object.entries({
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  Event: browser.Event,
  HTMLElement: browser.HTMLElement,
  Element: browser.Element,
  Node: browser.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
}
