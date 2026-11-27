import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerDeliveries } from "./AnswerDeliveries";
import { NeedsYouOutbox } from "../NeedsYouTab";
import type { AnswerNotice } from "../worldAnswerDeliveries";
const notice: AnswerNotice = {
  ask: {
    id: "q-fixture",
    at: 1,
    actor: {
      label: "Dispatch",
      verified: true,
      connection_id: "studio",
      pane_id: "w1:p1",
    },
    question: "Ship the fix?",
    options: [],
    owner_only: true,
    answer: { text: "Ship it", by: "owner", at: 2, occurrence: "a-fixture" },
  },
  delivery: { state: "uncertain", attempt: 1 },
  can_resend: true,
};
const actions = {
  decide: async () => null,
  refresh: async () => {},
  older: async () => {},
};
test("answered delivery recovery stays reachable with zero open questions, and names uncertainty and retrieval", () => {
  const deliveries = createElement(AnswerDeliveries, {
    state: {
      entries: [notice],
      next: null,
      older: false,
      loading: false,
      error: null,
    },
    actions,
  });
  const html = renderToStaticMarkup(
    createElement(NeedsYouOutbox, { checks: 1, waiting: 0, onOpen() {} }),
  );
  // Needs you's route: a count and Summary, never the full cards.
  expect(html).toContain("✉ Outbox · 1 to check");
  expect(html).toContain(
    'aria-label="Outbox, 1 answer to check. Open summary."',
  );
  expect(html).not.toContain("Ship it");
  const full = renderToStaticMarkup(deliveries);
  // Nothing to check: no route.
  expect(
    renderToStaticMarkup(
      createElement(NeedsYouOutbox, { checks: 0, waiting: 2, onOpen() {} }),
    ),
  ).toBe("");
  expect(full).toContain("It won&#x27;t send it again on its own");
  expect(full).toContain("Send again…");
  expect(full).toContain("Dismiss");
  expect(full).toContain("herdr-world ask get q-fixture");
  expect(full).toContain("Ship it");
});
test("an unbound legacy answer allows closing but offers no resend, and in-flight sends offer no decision", () => {
  for (const [state, resend, close] of [
    ["refused", false, true],
    ["dispatching", false, false],
    ["claimed", false, false],
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(AnswerDeliveries, {
        state: {
          entries: [
            { ...notice, can_resend: false, delivery: { state, attempt: 1 } },
          ],
          next: null,
          older: false,
          loading: false,
          error: null,
        },
        actions,
      }),
    );
    expect(html.includes("Send again…")).toBe(resend);
    expect(html.includes(">Dismiss</button>")).toBe(close);
  }
});

test("Not sent explains an exited asker and offers safe owner recovery with the full retrieval command", () => {
  const html = renderToStaticMarkup(
    createElement(AnswerDeliveries, {
      state: {
        entries: [
          {
            ...notice,
            can_resend: false,
            delivery: {
              state: "refused",
              attempt: 1,
              reason:
                "agent_not_ready: The agent isn't running in that terminal any more; it's a shell now. Nothing was sent.",
            },
          },
        ],
        next: null,
        older: false,
        loading: false,
        error: null,
      },
      actions,
      recipient: () => ({
        name: "Dispatch",
        location: "Studio",
        target: null,
        terminal: {
          nodeId: "leaf",
          target: { connectionId: "studio", generation: 3, paneId: "w1:p1" },
        },
      }),
      compose() {},
    }),
  );
  expect(html).toContain(
    "The agent isn&#x27;t running in that terminal any more; it&#x27;s a shell now",
  );
  expect(html).toContain("herdr-world ask get q-fixture");
  expect(html).toContain(">Copy answer</button>");
  expect(html).toContain(">Put in Terminal composer</button>");
  expect(html).not.toContain("agent_not_ready:");
  expect(html).not.toContain("Send again");
});
