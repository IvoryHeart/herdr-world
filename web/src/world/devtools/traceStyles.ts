/**
 * The trace overlay's styles, as text the overlay renders itself, so a
 * release build that never renders the overlay carries none of them.
 * Board's theme colours apply on Board; elsewhere the app's tokens do.
 */
export const TRACE_STYLES = `
.world-trace {
  position: absolute;
  z-index: 9;
  left: max(12px, env(safe-area-inset-left, 0px));
  bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
  width: min(460px, calc(100% - 24px));
  max-height: 45%;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid var(--board-line, var(--border, #343942));
  border-radius: 10px;
  background: color-mix(
    in srgb,
    var(--board-card, var(--bg, #0e1116)) 96%,
    transparent
  );
  color: var(--board-ink, var(--text, #edf2f7));
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  box-shadow: var(--board-shadow, 0 8px 24px rgb(0 0 0 / 30%));
  cursor: default;
}
.world-trace-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.world-trace-head span {
  flex: 1;
  color: var(--board-soft, var(--muted, #9da7b4));
}
.world-trace-head button {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--board-line, var(--border, #343942));
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.world-trace ol {
  margin: 0;
  padding: 0;
  list-style: none;
}
.world-trace li {
  display: flex;
  gap: 8px;
  padding: 1px 0;
  border-top: 1px solid
    color-mix(
      in srgb,
      var(--board-line, var(--border, #343942)) 50%,
      transparent
    );
}
.world-trace-t {
  flex: none;
  width: 52px;
  text-align: right;
  color: var(--board-soft, var(--muted, #9da7b4));
}
.world-trace-kind {
  flex: none;
  width: 56px;
  color: var(--board-accent, var(--accent, #79a6ff));
}
.world-trace-detail {
  min-width: 0;
  overflow-wrap: anywhere;
}
.world-trace-copy {
  width: 100%;
  height: 80px;
  font: inherit;
}
.world-trace-note {
  margin: 4px 0 0;
  color: var(--board-soft, var(--muted, #9da7b4));
}
`;
