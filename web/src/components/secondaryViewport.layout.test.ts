import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [app, shell, sidebar, annotations, ranger, inspector, composer] =
  await Promise.all([
    read("../App.tsx"),
    read("../styles/layout/app.css"),
    read("../styles/layout/sidebar.css"),
    read("./AnnotationPanel.css"),
    read("./AssistantPanel.css"),
    read("./WorkspaceInspectorHost.css"),
    read("./TerminalComposer.css"),
  ]);

function rule(css: string, selector: string, last = false) {
  const start = last
    ? css.lastIndexOf(`${selector} {`)
    : css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start) + 1);
}

// CSS/DOM ownership contracts, not a browser's painted-layout simulation.
// Device acceptance must additionally measure body.bottom == rail.top and
// page.bottom == body.bottom (within rounding), including at CSS zoom.
test("all phone Inspector views replace the terminal with a full-height page", () => {
  const fullpage = shell.slice(shell.indexOf("  .body:is("));
  for (const view of ["files", "changes", "commits", "history"]) {
    expect(fullpage).toContain(`.mobile-view-${view}`);
  }
  expect(fullpage).toContain(
    ".workspace-terminal-surface {\n      display: none;",
  );
  const slot = rule(
    fullpage,
    ".workspace-stage .workspace-inspector-slot:not(.is-closed)",
  );
  for (const declaration of [
    "position: relative;",
    "inset: auto;",
    "width: 100% !important;",
    "max-width: none;",
    "height: 100% !important;",
    "min-height: 0;",
    "max-height: none;",
    "flex: 1;",
  ])
    expect(slot).toContain(declaration);
  expect(rule(inspector, ".workspace-inspector")).toContain("height: 100%;");
});

test("qualified terminal input reserves local flow height; World owns its app bar", () => {
  expect(app.includes("usePublishMobileControls(mobileControls)")).toBe(true);
  const local = rule(
    composer,
    ':where(html[data-layout="mobile"]) .terminal-shell > .terminal-composer',
  );
  expect(local).toContain("flex: 0 0 auto;");
  expect(local).toContain("safe-area-inset-bottom");
  expect(local).toContain("--keyboard-inset-composer-gap");
  for (const selector of [
    ".body",
    ".main",
    ".workspace-surfaces",
    ".workspace-stage",
  ])
    expect(rule(shell, selector)).toContain("min-height: 0;");
});

test("secondary pages retain safe-area clearance independently of terminal input", () => {
  const mobileSidebar = sidebar.slice(
    sidebar.indexOf(':where(html[data-layout="mobile"])'),
  );
  expect(rule(mobileSidebar, ".sidebar-content")).toContain(
    "safe-area-inset-bottom",
  );
  expect(rule(annotations, ".annotation-panel-footer", true)).toContain(
    "safe-area-inset-bottom",
  );
  expect(
    rule(ranger, ".assistant-panel.is-mobile .assistant-settings-save"),
  ).toContain("safe-area-inset-bottom");
  expect(rule(annotations, ".annotation-panel-list")).toContain(
    "overflow: auto;",
  );
  expect(rule(ranger, ".assistant-panel-list")).toContain("overflow: auto;");
  expect(composer.includes("position: relative;")).toBe(true);
});

test("phone fullpage overrides follow desktop peer-panel sizing without changing it", () => {
  // A peer annotation draft can activate the 55% desktop Inspector rule
  // even at phone widths. All four routes must override it.
  const peer = shell.indexOf(
    ".has-annotations .workspace-stage:not(.is-inspector-expanded)",
  );
  const mobile = shell.lastIndexOf(':where(html[data-layout="mobile"])');
  const fullpage = shell.indexOf("  .body:is(", mobile);
  expect(peer).toBeGreaterThan(0);
  expect(mobile).toBeGreaterThan(peer);
  expect(fullpage).toBeGreaterThan(mobile);
  expect(shell.slice(peer, mobile)).toContain("max-width: 55%;");
  expect(rule(shell, ".workspace-inspector-slot")).toContain("max-width: 65%;");
  expect(rule(annotations, ".annotation-panel.is-floating")).toContain(
    "position: absolute;",
  );
  // Workspaces, Ranger (including Settings) and Annotations inherit the
  // remaining body height; their lists, not the whole viewport, scroll.
  const phone = shell.slice(mobile, fullpage);
  expect(phone).toContain(
    ".workspace-surfaces.has-annotations > .annotation-panel",
  );
  expect(phone).toContain(
    ".workspace-surfaces.has-assistant > .assistant-panel",
  );
  expect(phone).toContain("height: 100%;");
  expect(phone).toContain(".body.mobile-view-annotations .workspace-stage");
  expect(phone).toContain(".body.mobile-view-assistant .workspace-stage");
  expect(rule(shell, ".body.mobile-view-workspaces .main")).toContain(
    "display: none;",
  );
});
