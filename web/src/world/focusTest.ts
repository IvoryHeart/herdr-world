import { worldSessionStorage } from "../browserStorage";

/**
 * Testing only: `?focusTest=1` adds a 1-minute focus choice for this tab
 * (#1131), so a session's end can be tried without waiting. main.tsx
 * consumes the parameter at once; `?focusTest=0` turns it off again.
 */
const TEST_KEY = "focusTest";

export function consumeFocusTest(url: URL) {
  if (!url.searchParams.has(TEST_KEY)) return false;
  if (url.searchParams.get(TEST_KEY) !== "0")
    worldSessionStorage.setItem(TEST_KEY, "1");
  else worldSessionStorage.removeItem(TEST_KEY);
  url.searchParams.delete(TEST_KEY);
  return true;
}

export const focusTestOn = () => worldSessionStorage.getItem(TEST_KEY) === "1";
