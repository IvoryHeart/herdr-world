// Refuses `:has()` whose subject is the page or World shell: `body`, `html`,
// `:root`, `.app`, `.world-foundation-shell`, `.world-view-layout`, or no
// subject at all. Chrome reevaluates such a rule on DOM changes anywhere
// below it, so each typed key, streamed message or terminal line can restyle
// thousands of elements (#1231). Flag the state on <html> from JavaScript
// instead (see web/src/rootFlag.ts and web/src/terminalInputFocus.ts).
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const BROAD =
  /(?:^|[^\w-])(?:body|html)(?![\w-])|:root(?![\w-])|\.(?:app|world-foundation-shell|world-view-layout)(?![\w-])/;

/**
 * Existing broad `:has()` compounds, each measured with the composer typing
 * trace (web/src/world/ComposerTypingStyle.browser.test.ts) to restyle at
 * most a few elements per key: their right-hand sides name specific classes.
 * Nothing new belongs here; flag the state from JavaScript instead.
 */
export const ALLOWED: readonly { file: string; has: string }[] = [
  // Zen header reveal on hover or focus inside the island.
  {
    file: "web/src/styles/layout/topbar.css",
    has: ".app.zen:has(.zen-island:hover)",
  },
  {
    file: "web/src/styles/layout/topbar.css",
    has: ".app.zen:has(.zen-island:focus-within)",
  },
  {
    file: "web/src/styles/layout/topbar.css",
    has: ".world-foundation-shell:has(.zen-island:hover)",
  },
  {
    file: "web/src/styles/layout/topbar.css",
    has: ".world-foundation-shell:has(.zen-island:focus-within)",
  },
  // One custom property on body; nothing below restyles.
  { file: "web/src/world/world-stage.css", has: "body:has(.app.zen)" },
  // Phone shortcuts dialog: a scroll lock on html.
  {
    file: "web/src/components/MobileTerminalShortcutsDialog.css",
    has: "html:has(.mobile-shortcuts-modal)",
  },
  // Phone detail screen: named header and control classes.
  {
    file: "web/src/components/MobileControls.css",
    has: ':where(html[data-layout="mobile"]):has(.world-back-to-view)',
  },
  {
    file: "web/src/components/MobileControls.css",
    has: ".app:has(.terminal-mobile-input-actions, .terminal-composer)",
  },
  {
    file: "web/src/components/MobileControls.css",
    has: ".app:has(.terminal-mobile-input-actions, .terminal-composer):not([data-mobile-more])",
  },
  // Needs you: the stage beside the docked tab, the sheet behind a window.
  {
    file: "web/src/world/needsYouTab.css",
    has: ".world-view-layout:has(> .needs-you-tab)",
  },
  {
    file: "web/src/world/needsYouTab.css",
    has: "body:has(.world-managed-window)",
  },
  // Desk reading: the context rail only.
  {
    file: "web/src/world/DeskView.css",
    has: ".world-view-layout:has(.desk.has-reading)",
  },
];

/** Index past the group opened at `open` (a paren or bracket). */
function closeOf(text: string, open: number) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    } else if (char === '"' || char === "'") {
      index = text.indexOf(char, index + 1);
      if (index < 0) return text.length;
    }
  }
  return text.length;
}

/** Splits at top-level commas, outside parens, brackets and strings. */
function splitList(text: string) {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "[") index = closeOf(text, index) - 1;
    else if (char === '"' || char === "'")
      index = Math.max(index, text.indexOf(char, index + 1));
    else if (char === ",") {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim().replace(/\s+/g, " ")).filter(Boolean);
}

/** Compound selectors, split at top-level combinators. */
function compounds(selector: string) {
  const parts: string[] = [];
  let current = "";
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index]!;
    if (char === "(" || char === "[") {
      const end = closeOf(selector, index);
      current += selector.slice(index, end);
      index = end - 1;
    } else if (/[\s>+~]/.test(char)) {
      if (current) parts.push(current);
      current = "";
    } else current += char;
  }
  if (current) parts.push(current);
  return parts;
}

/** Removes `:has(...)` and `:not(...)` groups; what is left names the subject. */
function withoutArguments(compound: string) {
  let out = "";
  for (let index = 0; index < compound.length; index += 1) {
    const rest = compound.slice(index);
    const match = /^:(?:has|not)\(/.exec(rest);
    if (match) {
      index = closeOf(compound, index + match[0].length - 1) - 1;
      continue;
    }
    out += compound[index];
  }
  return out;
}

/** Normalised `:has()` compounds of `selector` on a page or shell subject. */
export function broadCompounds(selector: string) {
  return compounds(selector)
    .filter((compound) => {
      if (!compound.includes(":has(")) return false;
      const subject = withoutArguments(compound);
      return !subject || subject === "&" || BROAD.test(subject);
    })
    .map((compound) =>
      compound.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")"),
    );
}

/** Full selectors of every style rule, with CSS nesting resolved. */
export function styleSelectors(css: string) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const found: string[] = [];
  const stack: (string[] | null)[] = [];
  let prelude = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === '"' || char === "'") {
      const end = source.indexOf(char, index + 1);
      prelude += source.slice(index, end + 1);
      index = end < 0 ? source.length : end;
    } else if (char === "(" || char === "[") {
      const end = closeOf(source, index);
      prelude += source.slice(index, end);
      index = end - 1;
    } else if (char === "{") {
      const text = prelude.trim();
      prelude = "";
      const parents = stack.findLast((entry) => entry !== null) ?? null;
      if (text.startsWith("@")) {
        stack.push(null);
        continue;
      }
      const own = splitList(text);
      const full = parents
        ? own.flatMap((selector) =>
            parents.map((parent) =>
              selector.includes("&")
                ? selector.replaceAll("&", parent)
                : `${parent} ${selector}`,
            ),
          )
        : own;
      found.push(...full);
      stack.push(full);
    } else if (char === "}") {
      stack.pop();
      prelude = "";
    } else if (char === ";") prelude = "";
    else prelude += char;
  }
  return found;
}

export function broadHasCompounds(css: string) {
  return [...new Set(styleSelectors(css).flatMap(broadCompounds))];
}

export function problems(files: { path: string; css: string }[]) {
  const allowed = new Set(
    ALLOWED.map((entry) => `${entry.file}\n${entry.has}`),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { path, css } of files)
    for (const has of broadHasCompounds(css)) {
      const key = `${path}\n${has}`;
      seen.add(key);
      if (!allowed.has(key))
        out.push(
          `${path}: \`${has}\` puts :has() on a page or shell subject; set a class or <html> attribute from JavaScript instead (#1231).`,
        );
    }
  for (const key of allowed)
    if (!seen.has(key))
      out.push(
        `scripts/check-has-selectors.ts: allowed :has() no longer exists, remove it: ${key.replace("\n", ": ")}`,
      );
  return out;
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const files = [...new Bun.Glob("web/src/**/*.css").scanSync({ cwd: root })]
    .sort()
    .map((path) => ({
      path: relative(root, join(root, path)),
      css: readFileSync(join(root, path), "utf8"),
    }));
  const found = problems(files);
  for (const line of found) console.error(line);
  if (found.length) process.exit(1);
}
