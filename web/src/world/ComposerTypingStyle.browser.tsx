import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { TerminalComposer } from "../components/TerminalComposer";
import { installTerminalInputFocusFlag } from "../terminalInputFocus";

// A World-sized page for the composer typing test: the real chat composer in
// the shell's real ancestry (World shell, App, view layout, a window with the
// pane-map identity, a portaled Needs you tab) beside thousands of Town and
// Chat elements. The test adds every stylesheet and drives keys over CDP.
// Synthetic content only.

const AGENTS = 21;

type TimedEvent = {
  name: string;
  interactionId: number;
  duration: number;
  processing: number;
};

declare global {
  interface Window {
    __composerTyping: {
      elements: number;
      frame(): Promise<void>;
      events: TimedEvent[];
    };
  }
}

const agentMarkup = (index: number) => `
  <div class="town-room" data-room="room-${index}">
    <div class="town-room-overview">
      <div class="town-room-card"><strong>Room ${index}</strong><span>example</span></div>
      <div class="town-room-plaque"><span class="town-room-name">room-${index}</span></div>
    </div>
    ${Array.from(
      { length: 6 },
      (_, desk) => `
      <div class="town-desk" data-agent="agent-${index}-${desk}">
        <div class="town-desk-tag">
          <span class="town-desk-name">agent-${index}-${desk}</span>
          <span class="town-desk-badge">${desk}</span>
        </div>
        <div class="town-desk-status"><i></i><i></i><i></i></div>
        <ul class="town-desk-items">
          ${Array.from({ length: 6 }, (_, item) => `<li><span>item ${item}</span><em>${item}</em></li>`).join("")}
        </ul>
      </div>`,
    ).join("")}
  </div>`;

const messageMarkup = (index: number) => `
  <div class="agent-chat-message" data-role="${index % 2 ? "user" : "assistant"}">
    <div class="agent-chat-message-meta"><span>agent</span><time>09:${String(index % 60).padStart(2, "0")}</time></div>
    <div class="markdown"><p>Synthetic message ${index} with <code>code</code> and <a href="https://example.com">a link</a>.</p>
      <ul><li>first point</li><li>second point</li></ul></div>
  </div>`;

function build() {
  document.body.innerHTML = `
    <div id="root">
      <div class="world-foundation-shell" data-view="town" data-zen="">
        <div class="world-topbar-host">
          <header class="topbar is-zen">
            <div class="topbar-start">
              <div class="brand"><span class="brand-title">Herdr World</span></div>
              <div class="world-topbar-control-plane"><button class="needs-you-counter">3</button></div>
            </div>
            <div class="topbar-actions">
              ${Array.from({ length: 8 }, (_, index) => `<button class="topbar-action">${index}</button>`).join("")}
            </div>
            <span class="topbar-time">09:00</span>
          </header>
        </div>
        <div class="world-spaces-layer is-active">
          <div class="app zen">
            <main class="body">
              <div class="world-view-layout has-context">
                <div class="world-view-stage">
                  <div class="town-world">${Array.from({ length: AGENTS }, (_, index) => agentMarkup(index)).join("")}</div>
                </div>
                <aside class="world-context-rail has-inspector">
                  <div class="world-inspector-stage">
                    <section class="workspace-inspector world-managed-window">
                      <header class="workspace-inspector-head">
                        <div class="workspace-inspector-identity workspace-inspector-agent-identity" data-kind="agent" data-pane-map="">
                          <button type="button" class="inspector-pane-map-glyph"><i></i><i></i></button>
                          <span class="workspace-inspector-agent-avatar"></span>
                          <strong>agent-0-0</strong>
                          <span class="workspace-inspector-location-text">example · main</span>
                        </div>
                      </header>
                      <div class="workspace-inspector-body">
                        <div class="workspace-inspector-resource inspector-history-resource">
                          <div class="agent-chat">
                            <div class="agent-chat-toolbar agent-chat-now"><span>Now</span></div>
                            <div class="agent-chat-messages">${Array.from({ length: 120 }, (_, index) => messageMarkup(index)).join("")}</div>
                            <div class="agent-chat-composer" data-help="chat.composer"></div>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </aside>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
    <div class="needs-you-tab is-sheet"><div class="needs-you-head">Needs you</div>
      ${Array.from({ length: 3 }, (_, index) => `<div class="needs-you-item">ask ${index}</div>`).join("")}
    </div>`;
}

build();
document.documentElement.setAttribute("data-world-view", "town");
installTerminalInputFocusFlag();
// Event Timing: every event of a key press shares one interactionId.
const events: TimedEvent[] = [];
new PerformanceObserver((list) => {
  for (const entry of list.getEntries() as PerformanceEventTiming[])
    events.push({
      name: entry.name,
      interactionId: entry.interactionId,
      duration: entry.duration,
      processing: entry.processingEnd - entry.processingStart,
    });
}).observe({ type: "event", buffered: true, durationThreshold: 16 } as never);
const host = document.querySelector<HTMLElement>(".agent-chat-composer")!;
const noop = () => {};
flushSync(() =>
  createRoot(host).render(
    <TerminalComposer
      surface="chat"
      draftKey="fixture-chat"
      recipient="agent-0-0"
      agent="claude"
      mode="composer"
      onModeChange={noop}
      onFocusDirect={noop}
      directDisabled
      shortcutRows={[]}
      onRunShortcut={noop}
      onClose={noop}
      onSubmit={async () => {}}
      onError={noop}
      onUploadImage={async () => ""}
      onUploadFile={async () => ""}
    />,
  ),
);
window.__composerTyping = {
  elements: document.getElementsByTagName("*").length,
  frame: () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    ),
  events,
};
void fetch("/result", {
  method: "POST",
  body: JSON.stringify({ elements: window.__composerTyping.elements }),
});
