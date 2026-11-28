// Stands in for `shiki/engine/javascript`. World's diffs always ask for
// Shiki's WASM engine (`preferredHighlighter: "shiki-wasm"`), so the
// JavaScript regex engine (oniguruma-to-es, about 115 KB across the app and
// the diff worker) is never selected and is not shipped.
export function createJavaScriptRegexEngine(): never {
  throw new Error(
    "Herdr World ships only Shiki's WASM engine; use preferredHighlighter: shiki-wasm",
  );
}
