import { expect, test } from "bun:test";
import { bindingPaneTerminals } from "./binding-pane-list";

test("exhaustive pane identity projections reject every known native, terminal or session collision", () => {
  for (const nativeA of [undefined, "pane-a", "pane-b"])
    for (const nativeB of [undefined, "pane-a", "pane-b"])
      for (const terminalA of ["terminal-a", "terminal-b"])
        for (const terminalB of ["terminal-a", "terminal-b"])
          for (const sessionA of ["session-a", "session-b", "unknown"])
            for (const sessionB of ["session-a", "session-b", "unknown"]) {
              const pane = (
                pane_id: string | undefined,
                terminal_id: string,
                session: string,
              ) => ({
                pane_id,
                terminal_id,
                agent_session: {
                  source: "synthetic",
                  agent: "fixture",
                  kind: session === "unknown" ? "unknown" : "id",
                  value: session,
                },
              });
              const result = bindingPaneTerminals([
                pane(nativeA, terminalA, sessionA),
                pane(nativeB, terminalB, sessionB),
              ]);
              const collision =
                (nativeA !== undefined && nativeA === nativeB) ||
                terminalA === terminalB ||
                (sessionA !== "unknown" && sessionA === sessionB);
              expect(result === null).toBe(collision);
              if (!collision)
                expect([...result!]).toEqual([terminalA, terminalB]);
            }
  for (const malformed of [
    null,
    {},
    [null],
    [{ pane_id: "pane-a" }],
    [{ pane_id: 1, terminal_id: "terminal-a" }],
  ])
    expect(bindingPaneTerminals(malformed)).toBeNull();
});
