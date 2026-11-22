import { readFileSync, writeFileSync } from "node:fs";
import { storageCatalog } from "../server/src/storage/catalog";

export const catalogNotes = "openspec/specs/world-storage/notes.md";
const start = "<!-- storage-catalog:start -->";
const end = "<!-- storage-catalog:end -->";
export function renderCatalog() {
  const cell = (value: string) =>
    value.replaceAll("|", "\\|").replaceAll("\n", " ");
  return [
    start,
    "Generated from `server/src/storage/catalog.ts`; run `bun scripts/storage-catalog.ts --write`.",
    "Current limits describe existing behavior, including existing expiry; this step changes no retention. Browser keys omit the foundation-v2 prefix; `*` denotes a parameterized family, additionally connection-scoped where applicable. Memory lists source owners and read/renderer projections; request-local scratch is excluded.",
    "",
    "| Store / location | Product meaning | Feature | Identity | Role | Current limit | Owning code |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...storageCatalog.map(
      (entry) =>
        `| ${[`${entry.store}: ${entry.locations.join(", ")}`, entry.meaning, entry.feature, entry.identity, entry.role, entry.limit, entry.code].map(cell).join(" | ")} |`,
    ),
    end,
  ].join("\n");
}
export function updateCatalogNotes(notes: string) {
  const generated = renderCatalog();
  return notes.includes(start)
    ? notes.slice(0, notes.indexOf(start)) +
        generated +
        notes.slice(notes.indexOf(end) + end.length)
    : `${notes.trimEnd()}\n\n${generated}\n`;
}
if (import.meta.main) {
  const current = readFileSync(catalogNotes, "utf8");
  const next = updateCatalogNotes(current);
  if (process.argv.includes("--write")) writeFileSync(catalogNotes, next);
  else if (current !== next)
    throw new Error(
      "Storage notes are stale: bun scripts/storage-catalog.ts --write",
    );
}
