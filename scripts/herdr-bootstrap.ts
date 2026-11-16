import { readFileSync, writeFileSync } from "node:fs";

const START = "# BEGIN generated Herdr compatibility bootstrap";
const END = "# END generated Herdr compatibility bootstrap";

/** herdr-core's reviewed install steps, then World's missing-runtime bootstrap. */
export function renderHerdrBootstrap() {
  const read = (name: string) =>
    readFileSync(new URL(name, import.meta.url), "utf8").trimEnd();
  return `${read("./herdr-core-install.sh")}\n\n${read("./homebrew-herdr-bootstrap.sh")}`;
}

export function renderStandaloneBootstrap(source: string) {
  const start = source.indexOf(START);
  const end = source.indexOf(END, start);
  if (start < 0 || end < 0)
    throw new Error("Missing standalone bootstrap markers");
  return (
    source.slice(0, start) +
    START +
    "\n" +
    renderHerdrBootstrap() +
    "\n" +
    source.slice(end)
  );
}

if (import.meta.main) {
  const path = new URL("./install-herdr-world.sh", import.meta.url);
  writeFileSync(path, renderStandaloneBootstrap(readFileSync(path, "utf8")));
  console.log("Updated self-contained standalone runtime bootstrap");
}
