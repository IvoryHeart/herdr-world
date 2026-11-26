import { expect, test } from "bun:test";
import {
  acceptedPrecompressedCodings,
  isPrecompressible,
} from "./precompressedAssets";

test("Accept-Encoding picks the precompressed codings a browser takes", () => {
  for (const [header, expected] of [
    [null, []],
    ["", []],
    ["identity", []],
    ["gzip, deflate, br, zstd", ["br", "gzip"]],
    ["GZIP", ["gzip"]],
    ["br;q=0, gzip", ["gzip"]],
    ["gzip;q=1.0, br;q=0.4", ["gzip", "br"]],
    ["br;q=0.5, gzip;q=0.5", ["br", "gzip"]],
    ["*", ["br", "gzip"]],
    ["*;q=0, gzip", ["gzip"]],
    ["br, *;q=0", ["br"]],
    ["br;q=nonsense, gzip", ["gzip"]],
    [" br ; q=0.8 ,gzip ;Q=0", ["br"]],
  ] as const)
    expect(acceptedPrecompressedCodings(header)).toEqual([...expected]);
});

test("only text-like build files are precompressed", () => {
  for (const name of ["a.js", "a.mjs", "a.css", "a.json", "a.svg", "a.wasm"])
    expect(isPrecompressible(name)).toBe(true);
  for (const name of ["a.woff2", "a.png", "a.webp", "a.js.br", "a.css.gz"])
    expect(isPrecompressible(name)).toBe(false);
});
