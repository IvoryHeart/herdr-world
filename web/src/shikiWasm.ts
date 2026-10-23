import onigWasmUrl from "shiki/onig.wasm?url";

// Stands in for `shiki/wasm`, which inlines Shiki's Oniguruma binary as
// base64 into every bundle that imports it: the app and the diff worker each
// carried a 608 KB copy. Both now fetch the one binary asset instead. Like
// `shiki/wasm`, the default export instantiates it with Shiki's imports.
export default async (imports: WebAssembly.Imports) => {
  const response = fetch(onigWasmUrl);
  if (typeof WebAssembly.instantiateStreaming === "function")
    return WebAssembly.instantiateStreaming(response, imports);
  return WebAssembly.instantiate(await (await response).arrayBuffer(), imports);
};
