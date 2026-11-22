import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  helpPictureFiles,
  helpPictureFingerprint,
  helpStageInputs,
  scanHelpAnchors,
} from "./help-declarations";
import {
  helpCheckProblems,
  helpCheckWarnings,
  repositoryHelp,
} from "./help-check";
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

test("pictures fail when missing or left over", () => {
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
      pictures: [...files, "town.gone.desktop.light.webp"],
      docCurrent: true,
    }),
  ).toContainEqual(
    expect.stringContaining(
      "town.gone.desktop.light.webp belongs to no help entry",
    ),
  );
});

test("stale fingerprints warn in feature PRs and fail only in strict mode", () => {
  const help = repositoryHelp();
  const stale = { ...help, fingerprint: () => "changed", docCurrent: true };
  expect(helpCheckProblems(stale)).toEqual([]);
  expect(helpCheckWarnings(stale)).toHaveLength(help.entries.length);
  expect(helpCheckWarnings(stale)[0]).toContain("out-of-date picture");
  expect(helpCheckWarnings(stale)[0]).toContain("bot PR");
  expect(helpCheckProblems(stale, true)).toEqual(helpCheckWarnings(stale));
  expect(
    helpCheckWarnings({
      ...help,
      fingerprint: (entry) => help.manifest[entry.id]!.fingerprint,
    }),
  ).toEqual([]);
});

test("a new entry without a manifest or with a missing picture fails", () => {
  const help = repositoryHelp();
  const entry = { ...help.entries[0]!, id: "town.new-control" };
  const missing = { ...help, entries: [...help.entries, entry] };
  expect(helpCheckProblems(missing)).toContainEqual(
    expect.stringContaining('"town.new-control" has no picture'),
  );
  const files = helpPictureFiles(entry);
  expect(
    helpCheckProblems({
      ...missing,
      manifest: { ...help.manifest, [entry.id]: { fingerprint: "old", files } },
      pictures: [...help.pictures, ...files.slice(1)],
    }),
  ).toContainEqual(
    expect.stringContaining('"town.new-control" has no picture'),
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

test("a stylesheet the stage renders makes every picture stale", () => {
  const entry = repositoryHelp().entries[0]!;
  // A synthetic stage: the stage imports a view, the view a stylesheet.
  const root = mkdtempSync(join(tmpdir(), "help-stage-"));
  try {
    mkdirSync(join(root, "web/src/help/testing"), { recursive: true });
    mkdirSync(join(root, "web/src/world/town"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(
      join(root, "web/src/help/testing/HelpShots.browser.tsx"),
      `import { Town } from "../../world/Town";\nimport "../entries";\n`,
    );
    writeFileSync(
      join(root, "web/src/world/Town.tsx"),
      `import "./town/town.css";\nexport const Town = () => null;\n`,
    );
    writeFileSync(join(root, "web/src/help/entries.ts"), "export {};\n");
    writeFileSync(join(root, "scripts/help-pictures.ts"), "export {};\n");
    const css = join(root, "web/src/world/town/town.css");
    writeFileSync(css, ".town-zoom { right: 12px; }\n");
    expect(helpStageInputs(root)).toEqual([
      "scripts/help-pictures.ts",
      "web/src/help/testing/HelpShots.browser.tsx",
      "web/src/world/Town.tsx",
      "web/src/world/town/town.css",
    ]);
    const before = helpPictureFingerprint(entry, new Map(), root);
    writeFileSync(css, ".town-zoom { right: 300px; }\n");
    expect(helpPictureFingerprint(entry, new Map(), root)).not.toBe(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
