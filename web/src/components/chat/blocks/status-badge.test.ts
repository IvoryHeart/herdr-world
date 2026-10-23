import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatStatusBadge } from "./status-badge";

test("Now status has a title and hidden word, with a circle for every agent state", () => {
  for (const [status, label] of [
    ["working", "Working"],
    ["blocked", "Needs you"],
    ["done", "Done"],
    ["idle", "Idle"],
    ["unknown", "unknown"],
  ]) {
    const html = renderToStaticMarkup(
      createElement(ChatStatusBadge, { status: status! }),
    );
    expect(html).toContain(`title="${label}"`);
    expect(html).toContain(`agent-chat-state-word">${label}</span>`);
    expect(html).toContain(`is-${status}`);
    expect(html).toContain('aria-hidden="true"');
  }
});
