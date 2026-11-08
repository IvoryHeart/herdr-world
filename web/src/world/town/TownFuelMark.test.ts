import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentUsageStop } from "../../../../shared/usageStop";

// The glyph is painted on a canvas, which the test DOM lacks.
mock.module("./townFuelGlyph", () => ({
  townFuelGlyphUrl: () => "data:image/png;base64,",
}));
const { TownFuelMark } = await import("./TownFuelMark");

const markup = (stop: AgentUsageStop, top: boolean) =>
  renderToStaticMarkup(
    createElement(TownFuelMark, {
      stop,
      agentKey: "synthetic-agent",
      top,
      x: 20,
      renderer: { current: null },
      pennants: new Set<HTMLElement>(),
    }),
  );

test("an out-of-fuel seat mark shows the can, the clock and the reset time", () => {
  const now = Date.now();
  const resets = new Date(now);
  resets.setHours(23, 59, 0, 0);
  const html = markup(
    { harness: "codex", at: now, resets_at: resets.getTime() },
    true,
  );
  expect(html).toContain('class="town-fuel-mark"');
  expect(html).toContain('data-top="true"');
  expect(html).toContain('data-agent="synthetic-agent"');
  expect(html).toContain("town-fuel-mark-glyph");
  expect(html).toContain('<span class="town-fuel-mark-time">23:59</span>');
  expect(html).toContain(
    'data-fuel="Usage limit reached · resets 23:59 (Codex)"',
  );

  const timeless = markup(
    { harness: "claude", at: now, resets_at: null },
    false,
  );
  expect(timeless).not.toContain("data-top");
  expect(timeless).not.toContain("town-fuel-mark-time");
  expect(timeless).toContain('data-fuel="Usage limit reached (Claude)"');
});

test("the seat mark stands above the room's plate and below an open card", () => {
  const zIndex = (file: string, selector: string) => {
    const css = readFileSync(new URL(file, import.meta.url), "utf8");
    const start = css.indexOf(`${selector} {`);
    const rule = css.slice(start, css.indexOf("}", start));
    return Number(/z-index:\s*(\d+)/u.exec(rule)?.[1]);
  };
  const mark = zIndex("./townFuelMark.css", ".town-fuel-mark");
  expect(mark).toBeGreaterThan(
    zIndex("./townRoomPlaque.css", ".town-room-plaque"),
  );
  expect(mark).toBeGreaterThan(zIndex("./townStep.css", ".town-step"));
  expect(mark).toBeLessThan(
    zIndex(
      "./townRoomPlaque.css",
      ".town-room-plaque:is(:hover, :focus-within)",
    ),
  );
});
