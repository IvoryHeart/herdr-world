import { createRoot } from "react-dom/client";
import { bridge } from "../api";
import { DesktopIdeHost } from "../components/DesktopIdeDialog";
import { DesktopIdeSettings } from "../components/DesktopIdeSettings";
import {
  consumeDesktopIdeFixture,
  desktopIdeCall,
  desktopIdeFixture,
  openInDesktopIde,
} from "../desktopIdes";

// Event-driven DOM admission: no status polling or fixed browser sleeps.
function observed(predicate: () => boolean, label: string) {
  if (predicate()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (predicate()) {
        clearTimeout(deadline);
        observer.disconnect();
        resolve();
      }
    });
    const deadline = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timed out: ${label}`));
    }, 5000);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
}
export async function runDesktopIdeChecks(
  target: HTMLElement,
  check: (condition: unknown, message: string) => void,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const calls: Record<string, unknown>[] = [];
  let defaultId: string | null = "vscode";
  let fail = false;
  let missing = false;
  const original = bridge.call;
  bridge.call = (async (
    method: string,
    params: Record<string, unknown> = {},
  ) => {
    if (method === "world.ide.list")
      return {
        default_id: defaultId,
        ides: [
          {
            id: "vscode",
            label: "VS Code",
            installed: !missing,
            ssh: true,
            reason: "Desktop launcher not found on the World host.",
          },
          { id: "cursor", label: "Cursor", installed: !missing, ssh: true },
          {
            id: "idea",
            label: "IntelliJ IDEA",
            installed: !missing,
            ssh: false,
          },
          {
            id: "zed",
            label: "Zed",
            installed: false,
            ssh: true,
            reason: "Desktop launcher not found on the World host.",
          },
        ],
      };
    if (method === "world.ide.default") {
      defaultId = params.ide as string;
      return { default_id: defaultId };
    }
    if (method === "world.ide.open") {
      calls.push(params);
      if (fail)
        throw new Error("Desktop launcher failed. Check its desktop session.");
      if (params.ide === "idea")
        throw new Error(
          "JetBrains SSH handoff needs a configured Gateway backend link.",
        );
      return {
        dispatched: true,
        ide: params.ide,
        label: params.ide === "vscode" ? "VS Code" : "Cursor",
      };
    }
    return original.call(bridge, method, params);
  }) as typeof bridge.call;
  const dialog = () =>
    document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Open in desktop IDE"]',
    );
  const clickIde = (name: string) =>
    [
      ...dialog()!.querySelectorAll<HTMLButtonElement>(
        ".desktop-ide-list button",
      ),
    ]
      .find((button) => button.textContent?.includes(name))!
      .click();
  const close = async () => {
    dialog()
      ?.querySelector<HTMLButtonElement>(".modal-actions button")
      ?.click();
    await observed(() => !dialog(), "close picker");
  };
  try {
    root.render(
      <>
        <DesktopIdeHost />
        <DesktopIdeSettings />
      </>,
    );
    await observed(
      () => !!host.querySelector('select option[value="cursor"]'),
      "installed IDE settings",
    );
    const select = host.querySelector<HTMLSelectElement>("select")!;
    select.value = "cursor";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await observed(
      () => host.textContent?.includes("Default desktop IDE saved.") ?? false,
      "persist default",
    );
    check(
      defaultId === "cursor",
      "Integrations must persist the explicit default",
    );
    check(
      host.textContent?.includes("Detected on the World host"),
      "Detection must name the computer whose IDEs are listed",
    );
    check(
      host.querySelector<HTMLOptionElement>('option[value="zed"]')?.disabled,
      "Missing IDEs cannot become the default",
    );
    host.style.display = "none";
    const previewButton = target.querySelector<HTMLButtonElement>(
      ".file-preview-head-actions .desktop-ide-trigger",
    );
    check(previewButton, "Shared Inspector file preview must offer Open in");
    previewButton?.click();
    await observed(
      () => !!dialog()?.querySelector(".desktop-ide-list button"),
      "file picker",
    );
    check(
      dialog()?.textContent?.includes("including when you use a phone"),
      "Picker must explain host-side launch",
    );
    check(
      dialog()
        ?.querySelector(".desktop-ide-list button")
        ?.textContent?.includes("Cursor · Default"),
      "Saved default must be first",
    );
    const box = dialog()!.getBoundingClientRect();
    check(
      box.left >= 0 &&
        box.right <= innerWidth + 1 &&
        box.top >= 0 &&
        box.bottom <= innerHeight + 1,
      "Picker must fit phone and desktop viewport",
    );
    const button = dialog()!.querySelector<HTMLButtonElement>(
      ".desktop-ide-list button",
    )!;
    const bounds = button.getBoundingClientRect();
    check(bounds.height >= 44, "IDE choices need phone-sized hit areas");
    check(
      button.contains(
        document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        ),
      ),
      "IDE choice must be pointer reachable",
    );
    clickIde("Cursor");
    await observed(
      () => dialog()?.textContent?.includes("handoff sent") ?? false,
      "file handoff",
    );
    const request = calls[calls.length - 1]!;
    check(
      request.connection_id === "alpha" &&
        request.connection_generation === 7 &&
        request.workspace_id === "workspace",
      "File handoff must retain immutable connection and runtime",
    );
    check(
      request.path === "src/main.ts" && request.line === 7,
      "File handoff must retain the source file and line",
    );
    check(
      (request.agent_worktree as any)?.candidateId === "tree" &&
        (request.agent_worktree as any)?.subject.paneId === "pane",
      "File handoff must retain selected agent worktree",
    );
    check(
      [
        ...dialog()!.querySelectorAll<HTMLButtonElement>(
          ".desktop-ide-list button",
        ),
      ].find((button) => button.textContent?.includes("Zed"))?.disabled,
      "Unavailable IDE must be explained and disabled",
    );
    fail = true;
    clickIde("Cursor");
    await observed(
      () =>
        !!dialog()
          ?.querySelector('[role="alert"]')
          ?.textContent?.includes("launcher failed"),
      "launch refusal",
    );
    fail = false;
    clickIde("IntelliJ");
    await observed(
      () =>
        !!dialog()
          ?.querySelector('[role="alert"]')
          ?.textContent?.includes("Gateway"),
      "SSH refusal",
    );
    await close();
    const headerHandoff = target.querySelector<HTMLButtonElement>(
      ".workspace-inspector-head > .desktop-ide-trigger",
    );
    if (headerHandoff) headerHandoff.click();
    else {
      target
        .querySelector<HTMLButtonElement>(
          '[aria-label="More actions for Inspector window"]',
        )!
        .click();
      await observed(
        () => !!document.querySelector('[aria-label="Window actions"]'),
        "Inspector window menu",
      );
      const handoff = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Window actions"] [role="menuitem"]',
        ),
      ].find((item) => item.textContent?.trim() === "Open in…");
      check(handoff, "Narrow Inspector window menu must offer Open in");
      handoff?.click();
    }
    await observed(
      () => !!dialog()?.querySelector(".desktop-ide-list button"),
      "agent project picker",
    );
    clickIde("VS Code");
    await observed(
      () => dialog()?.textContent?.includes("handoff sent") ?? false,
      "agent project handoff",
    );
    check(
      !calls[calls.length - 1]?.path &&
        !!calls[calls.length - 1]?.agent_worktree,
      "Agent header opens its admitted project folder",
    );
    missing = true;
    dialog()!
      .querySelector<HTMLButtonElement>('[aria-label="Refresh desktop IDEs"]')!
      .click();
    await observed(
      () => dialog()?.textContent?.includes("No desktop IDE found") ?? false,
      "no IDE fallback",
    );
    check(
      [
        ...dialog()!.querySelectorAll<HTMLButtonElement>(
          ".desktop-ide-list button",
        ),
      ].every((button) => button.disabled),
      "Missing launchers never offer a launch",
    );
    await close();
    const url = new URL(location.href);
    url.searchParams.set("ideFixture", "1");
    history.replaceState(history.state, "", url);
    consumeDesktopIdeFixture();
    check(
      desktopIdeFixture() &&
        !new URL(location.href).searchParams.has("ideFixture"),
      "Testing-only switch is consumed at once",
    );
    check(
      (await desktopIdeCall("list")).ides.length === 4,
      "Preview switch supplies bounded synthetic IDE data",
    );
    const count = calls.length;
    await desktopIdeCall("open", { ide: "vscode" });
    check(calls.length === count, "Preview handoff never reaches the service");
  } finally {
    openInDesktopIde(null);
    bridge.call = original;
    root.unmount();
    host.remove();
  }
}
