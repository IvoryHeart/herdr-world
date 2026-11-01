import { acquireCheckSlot } from "./check-lock";
import { captureResumeViewports } from "../web/src/world/testing/resumeVisualCapture";

const [port, directory, state, view, selector] = process.argv.slice(2);
if (
  !port ||
  !/^\d+$/.test(port) ||
  Number(port) < 1 ||
  Number(port) > 65535 ||
  !directory ||
  !state ||
  !/^[a-z0-9-]+$/.test(state) ||
  (view !== "town" && view !== "board" && view !== "desk")
) {
  throw new Error(
    "Usage: bun scripts/capture-world.ts <own-CDP-port> <directory> <state-slug> <town|board|desk> [expected-content-selector]",
  );
}
const release = await acquireCheckSlot("browser", {
  lane: "World evidence capture",
});
try {
  await captureResumeViewports(port, directory, state, {
    view,
    ...(selector ? { content: { selector } } : {}),
  });
} finally {
  release();
}
