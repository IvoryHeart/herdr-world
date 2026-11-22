import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";

type CapabilityNotes = {
  id: string;
  specPath: string;
  notesPath: string;
  notes: string;
  codePaths: string[];
};

/** Internal input for source-ownership checks and the public site build. */
export function readCapabilityNotes(root = process.cwd()): CapabilityNotes[] {
  return [...new Bun.Glob("openspec/specs/**/notes.md").scanSync({ cwd: root })]
    .sort()
    .map((notesPath) => {
      const dir = posix.dirname(notesPath);
      const id = dir.slice("openspec/specs/".length);
      const specPath = existsSync(`${root}/${dir}/spec.md`)
        ? `${dir}/spec.md`
        : [
            ...new Bun.Glob(`openspec/changes/*/specs/${id}/spec.md`).scanSync({
              cwd: root,
            }),
          ].sort()[0];
      if (!specPath)
        throw new Error(
          `${dir}: notes need a current spec or active change delta`,
        );
      const notes = readFileSync(`${root}/${notesPath}`, "utf8");
      const code =
        /(?:\*\*Code(?: paths)?:\*\*|## Code paths)\s*\n([\s\S]*?)(?=\n(?:\*\*[^\n]+:\*\*|## )|$)/.exec(
          notes,
        )?.[1] ?? "";
      return {
        id,
        specPath,
        notesPath,
        notes,
        codePaths: [...code.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]),
      };
    });
}
