import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  TOWN_WORLD_SETTLE_MS,
  TOWN_ZOOM_FOCUS_READERS,
  TOWN_ZOOM_READERS,
  TownWorldTransform,
} from "./townWorldTransform";

type Rule = { selector: string; body: string; keyframes?: string };

/** Style rules of a stylesheet, with the @keyframes each sits in. */
function styleRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const walk = (text: string, keyframes?: string) => {
    let at = 0;
    while (at < text.length) {
      const open = text.indexOf("{", at);
      if (open < 0) return;
      const prelude = text
        .slice(at, open)
        .replace(/^[^{}]*;/, "")
        .trim();
      let depth = 1;
      let end = open + 1;
      for (; depth && end < text.length; end++)
        if (text[end] === "{") depth++;
        else if (text[end] === "}") depth--;
      const body = text.slice(open + 1, end - 1);
      if (prelude.startsWith("@keyframes")) walk(body, prelude.split(/\s+/)[1]);
      else if (prelude.startsWith("@") || body.includes("{"))
        walk(body, keyframes);
      else rules.push({ selector: prelude, body, keyframes });
      at = end;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  return rules;
}

/** Top-level comma-separated parts, with `:is(a, b)` expanded. */
function complexSelectors(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === "(") depth++;
    else if (selector[i] === ")") depth--;
    else if (selector[i] === "," && !depth) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts.flatMap((part) => {
    const is = /:is\(([^()]*)\)/.exec(part);
    return is
      ? complexSelectors(is[1]!).map((inner) =>
          part.replace(is[0], inner.trim()),
        )
      : [part.replace(/\s+/g, " ").trim()];
  });
}

/** The classes of a selector's subject (its last compound). */
const subjectClasses = (selector: string) =>
  (selector.split(/[\s>+~]+/).pop() ?? "").match(/\.[\w-]+/g) ?? [];

const readsZoom = (body: string) => /var\(\s*--i?z\s*[,)]/.test(body);

test("every rule that reads --z or --iz selects a zoom reader", async () => {
  const source = join(import.meta.dir, "..", "..");
  const rules: (Rule & { file: string })[] = [];
  for (const file of new Bun.Glob("**/*.css").scanSync(source))
    for (const rule of styleRules(await Bun.file(join(source, file)).text()))
      rules.push({ ...rule, file });
  const subject = (reader: string) => subjectClasses(reader)[0]!;
  const readers = new Set(TOWN_ZOOM_READERS.map(subject));
  const focusReaders = new Set(TOWN_ZOOM_FOCUS_READERS.map(subject));
  const animatedBy = (name: string) =>
    rules.filter(
      (rule) =>
        !rule.keyframes &&
        new RegExp(`animation(-name)?:[^;]*\\b${name}\\b`).test(rule.body),
    );
  const subjects = rules
    .filter((rule) => readsZoom(rule.body))
    .flatMap((rule) => (rule.keyframes ? animatedBy(rule.keyframes) : [rule]));
  expect(subjects.length).toBeGreaterThan(40);
  const missing: string[] = [];
  for (const rule of subjects)
    for (const selector of complexSelectors(rule.selector)) {
      // A pseudo-element would read its element's inherited value, and the
      // zoom is not inherited.
      if (selector.includes("::")) missing.push(`${rule.file}: ${selector}`);
      else if (
        !subjectClasses(selector).some(
          (name) =>
            readers.has(name) ||
            (focusReaders.has(name) && /:focus(-visible)?\b/.test(selector)),
        )
      )
        missing.push(`${rule.file}: ${selector}`);
    }
  expect(missing).toEqual([]);
});

test("the zoom is registered as not inherited", async () => {
  const css = await Bun.file(join(import.meta.dir, "town.css")).text();
  for (const name of ["--z", "--iz"])
    expect(css).toMatch(
      new RegExp(
        `@property ${name} \\{[^}]*syntax: "\\*";[^}]*inherits: false;[^}]*\\}`,
      ),
    );
  // A default on .town-world would no longer reach anything.
  expect(css).not.toMatch(/\.town-world \{[^}]*--i?z:/);
});

function fakeStyle() {
  const values = new Map<string, string>();
  let writes = 0;
  return {
    get writes() {
      return writes;
    },
    transform: "",
    willChange: "",
    getPropertyValue: (name: string) => values.get(name) ?? "",
    setProperty(name: string, value: string) {
      writes++;
      values.set(name, value);
    },
  };
}

function fakeClock() {
  let now = 0;
  const timers: { at: number; run: () => void }[] = [];
  return {
    now: () => now,
    wall: () => now,
    after(ms: number, run: () => void) {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
    advance(ms: number) {
      now += ms;
      for (const timer of timers.filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.run();
      }
    },
  };
}

test("only readers get the zoom, and only when it changes", () => {
  const readers = [{ style: fakeStyle() }, { style: fakeStyle() }];
  const style = fakeStyle();
  const selectors: string[] = [];
  const layer = Object.assign(new EventTarget(), {
    style,
    querySelectorAll(selector: string) {
      selectors.push(selector);
      return readers;
    },
  }) as unknown as HTMLElement;
  const clock = fakeClock();
  const world = new TownWorldTransform(layer, clock);
  world.place(10, 20, 2);
  expect(style.transform).toBe("translate(10px, 20px) scale(2)");
  expect(selectors).toEqual([TOWN_ZOOM_READERS.join(",")]);
  for (const reader of readers) {
    expect(reader.style.getPropertyValue("--z")).toBe("2");
    expect(reader.style.getPropertyValue("--iz")).toBe("0.5");
  }
  // The layer itself never carries the zoom: its ~2,000 descendants would
  // restyle with it.
  expect(style.writes).toBe(0);
  // A pan keeps the zoom: no reader is written again.
  world.place(30, 20, 2);
  expect(readers.map((reader) => reader.style.writes)).toEqual([2, 2]);
  world.place(30, 20, 4);
  expect(readers[0]!.style.getPropertyValue("--iz")).toBe("0.25");
  expect(readers.map((reader) => reader.style.writes)).toEqual([4, 4]);
  world.dispose();
});

test("the overlay is its own layer only while the camera moves", () => {
  const style = fakeStyle();
  const layer = Object.assign(new EventTarget(), {
    style,
    querySelectorAll: () => [],
  }) as unknown as HTMLElement;
  const clock = fakeClock();
  const world = new TownWorldTransform(layer, clock);
  // Where Town opens is not motion: it renders as a settled Town does.
  world.place(0, 0, 1);
  expect(style.willChange).toBe("");
  world.place(1, 0, 1);
  expect(style.willChange).toBe("transform");
  clock.advance(TOWN_WORLD_SETTLE_MS - 50);
  world.place(5, 0, 1);
  clock.advance(100);
  // Moved 100 ms ago: still a layer.
  expect(style.willChange).toBe("transform");
  // The same pose is no motion.
  world.place(5, 0, 1);
  clock.advance(TOWN_WORLD_SETTLE_MS);
  expect(style.willChange).toBe("");
  world.place(6, 0, 1);
  expect(style.willChange).toBe("transform");
  world.dispose();
  clock.advance(TOWN_WORLD_SETTLE_MS * 2);
  expect(style.willChange).toBe("transform");
});

test("a semantic target carries the zoom only while focused", () => {
  const layer = Object.assign(new EventTarget(), {
    style: fakeStyle(),
    querySelectorAll: () => [],
  }) as unknown as HTMLElement;
  const target = { style: fakeStyle(), matches: () => true };
  const world = new TownWorldTransform(layer, fakeClock());
  world.place(0, 0, 2);
  expect(target.style.writes).toBe(0);
  const focus = (type: string) => {
    const event = new Event(type);
    Object.defineProperty(event, "target", { value: target });
    layer.dispatchEvent(event);
  };
  focus("focusin");
  expect(target.style.getPropertyValue("--iz")).toBe("0.5");
  world.place(0, 0, 4);
  expect(target.style.getPropertyValue("--iz")).toBe("0.25");
  focus("focusout");
  world.place(0, 0, 1);
  expect(target.style.getPropertyValue("--iz")).toBe("0.25");
  world.dispose();
});
