import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { helpPictureFiles, scanHelpAnchors } from "./help-declarations";
import { helpCheckProblems, repositoryHelp } from "./help-check";
import { renderHelpDoc } from "./help-docs";

test("renaming a control a help entry points at fails and names the entry", () => {
  const help = repositoryHelp();
  const entry = help.entries.find(
    (candidate) => candidate.id === "board.next",
  )!;
  // A synthetic product where the control was renamed.
  const root = mkdtempSync(join(tmpdir(), "help-check-"));
  try {
    mkdirSync(join(root, "web/src/world"), { recursive: true });
    writeFileSync(
      join(root, "web/src/world/Controls.tsx"),
      `export const Next = () => <button data-help="board.next-agent" />;\n`,
    );
    const anchors = scanHelpAnchors(root);
    expect([...anchors.keys()]).toEqual(["board.next-agent"]);
    const problems = helpCheckProblems({ ...help, entries: [entry], anchors });
    expect(problems).toContainEqual(
      expect.stringMatching(
        /^help entry "board\.next" points at control "board\.next", which no component marks/,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pictures fail when missing, stale or left over", () => {
  const help = repositoryHelp();
  const entry = help.entries[0]!;
  const one = { ...help, entries: [entry] };
  const files = helpPictureFiles(entry);
  expect(
    helpCheckProblems({ ...one, pictures: files.slice(1), docCurrent: true }),
  ).toContainEqual(expect.stringContaining(`"${entry.id}" has no picture`));
  expect(
    helpCheckProblems({
      ...one,
      pictures: files,
      fingerprint: () => "changed",
      docCurrent: true,
    }),
  ).toContainEqual(
    expect.stringContaining(`"${entry.id}" has an out-of-date picture`),
  );
  expect(
    helpCheckProblems({
      ...one,
      pictures: [...files, "town.gone.desktop.light.webp"],
      docCurrent: true,
    }),
  ).toContainEqual(
    expect.stringContaining(
      "town.gone.desktop.light.webp belongs to no help entry",
    ),
  );
});

test("an unlisted declaration file and a stale help page fail", () => {
  // The repository's own state is `bun run help:check`'s; hold pictures current.
  const help = repositoryHelp();
  help.fingerprint = (entry) => help.manifest[entry.id]?.fingerprint ?? "";
  expect(
    helpCheckProblems({
      ...help,
      declarationFiles: [
        ...help.declarationFiles,
        "web/src/world/desk/desk.help.ts",
      ],
      docCurrent: false,
    }),
  ).toEqual([
    "web/src/world/desk/desk.help.ts is not listed in web/src/help/entries.ts",
    "docs/HELP.md is out of date; run bun run help:docs",
  ]);
  expect(renderHelpDoc(help.entries)).toContain("## Start here");
});
