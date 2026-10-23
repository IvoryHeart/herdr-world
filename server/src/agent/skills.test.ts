import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import { discoverSkills } from "./skills";

describe("Skill discovery", () => {
  test("lists SKILL.md folders in the workspace and the user's folders", async () => {
    const root = mkdtempSync(join(tmpdir(), "world-skills-"));
    const home = join(root, "home");
    const repo = join(root, "repo");
    for (const [dir, name] of [
      [join(repo, ".agents", "skills"), "candidate-delivery"],
      [join(repo, ".claude", "skills"), "code-review"],
      [join(home, ".codex", "skills"), "code-review"],
    ] as const) {
      mkdirSync(join(dir, name), { recursive: true });
      writeFileSync(join(dir, name, "SKILL.md"), "---\nname: x\n---\n");
    }
    mkdirSync(join(repo, ".agents", "skills", "no-manifest"), {
      recursive: true,
    });
    const skills = await discoverSkills({
      cwd: repo,
      windows: false,
      shQuote,
      run: (argv, timeout) =>
        runProcessWithCodeTimeout(["env", `HOME=${home}`, ...argv], timeout),
    });
    expect(skills).toEqual(["candidate-delivery", "code-review"]);
  });

  test("an SSH host is asked over SSH, with the path quoted", async () => {
    let seen: string[] = [];
    await discoverSkills({
      cwd: "/srv/it's here",
      host: "dev@example.com",
      windows: false,
      shQuote,
      run: async (argv) => {
        seen = argv;
        return { code: 0, stdout: "a\n../b\n", stderr: "" };
      },
    });
    expect(seen[0]).toBe("ssh");
    expect(seen.at(-1)).toContain(shQuote("/srv/it's here"));
  });
});
