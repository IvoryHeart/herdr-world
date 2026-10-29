import { readFileSync, writeFileSync } from "node:fs";
import {
  VERIFIED_HERDR_VERSION,
  VERIFIED_HERDR_SHA256,
} from "../server/src/herdr/release";

export interface HerdrBootstrapRelease {
  version: string;
  digests: Record<string, string>;
}
const START = "# BEGIN generated Herdr compatibility bootstrap";
const END = "# END generated Herdr compatibility bootstrap";

export function renderHerdrBootstrap(
  herdr: HerdrBootstrapRelease = {
    version: VERIFIED_HERDR_VERSION,
    digests: VERIFIED_HERDR_SHA256,
  },
) {
  let source = readFileSync(
    new URL("./homebrew-herdr-bootstrap.sh", import.meta.url),
    "utf8",
  ).replaceAll("@HERDR_VERSION@", herdr.version);
  for (const [target, digest] of Object.entries(herdr.digests))
    source = source.replaceAll(`@HERDR_SHA_${target}@`, digest);
  return source.trimEnd();
}

export function renderStandaloneBootstrap(
  source: string,
  herdr?: HerdrBootstrapRelease,
) {
  const start = source.indexOf(START);
  const end = source.indexOf(END, start);
  if (start < 0 || end < 0)
    throw new Error("Missing standalone bootstrap markers");
  return (
    source.slice(0, start) +
    START +
    "\n" +
    renderHerdrBootstrap(herdr) +
    "\n" +
    source.slice(end)
  );
}

if (import.meta.main) {
  const path = new URL("./install-herdr-world.sh", import.meta.url);
  writeFileSync(path, renderStandaloneBootstrap(readFileSync(path, "utf8")));
  console.log("Updated self-contained standalone Herdr bootstrap");
}
