import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const sourcePath = "web/src/world/town/town.css";

/** Move the production zoom control one CSS pixel; preserve every other byte. */
export function townVisualMutant(source: string) {
  const position = /(\.town-zoom\s*\{[^}]*\n[ \t]+right:[ \t]*)16px;/g;
  if ([...source.matchAll(position)].length !== 1)
    throw new Error("Expected one production .town-zoom right: 16px site");
  return source.replace(position, (_match, prefix: string) => prefix + "17px;");
}

type Report = {
  browserVersion: string;
  failures: string[];
  receipts: { name: string; changedPixels: number; gpu: string }[];
};

export function verifyVisualControl(
  mutant: Report,
  mutantExit: number,
  restored: Report,
  restoredExit: number,
) {
  if (
    mutantExit === 0 ||
    mutant.receipts.length !== 5 ||
    !mutant.failures.length ||
    !mutant.failures.every((f) =>
      /^Run 1, [\w-]+: \d+ pixels differ$/.test(f),
    ) ||
    !mutant.receipts.every((r) => r.changedPixels > 0)
  )
    throw new Error(
      "Mutant must fail specifically on changed pixels at all five viewports",
    );
  if (
    restoredExit !== 0 ||
    restored.failures.length ||
    restored.receipts.length !== 5 ||
    restored.receipts.some((r) => r.changedPixels !== 0)
  )
    throw new Error(
      "Restored production source must match all five stored goldens",
    );
  if (
    [...mutant.receipts, ...restored.receipts].some(
      (r) => !/SwiftShader/i.test(r.gpu),
    )
  )
    throw new Error("Both visual controls must use SwiftShader");
}

/** Full child test exits, reports and mismatch artifacts are retained for review. */
export async function runTownVisualControl(directory: string) {
  const output = resolve(directory);
  await mkdir(output, { recursive: true });
  const source = await readFile(sourcePath, "utf8");
  const clean = Bun.spawnSync([
    "git",
    "diff",
    "--quiet",
    "HEAD",
    "--",
    sourcePath,
  ]);
  if (clean.exitCode !== 0)
    throw new Error("Production Town CSS must be clean before the control");
  const mutant = townVisualMutant(source);
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const fixtureImages = resolve("web/src/world/testing/town-golden/images");
  const hashes = async () => {
    const result: Record<string, string> = {};
    for await (const name of new Bun.Glob("*.png").scan(fixtureImages))
      result[name] = createHash("sha256")
        .update(
          new Uint8Array(
            await Bun.file(join(fixtureImages, name)).arrayBuffer(),
          ),
        )
        .digest("hex");
    return result;
  };
  const references = await hashes();
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let mutated = false;
  const restore = () => {
    if (mutated) {
      writeFileSync(sourcePath, source);
      mutated = false;
    }
  };
  const interrupt = () => {
    restore();
    child?.kill("SIGTERM");
    process.exit(1);
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  process.on("exit", restore);
  const capture = async (state: string) => {
    child = Bun.spawn(
      [process.execPath, "run", "test", "scripts/town-golden.browser.test.ts"],
      {
        stdout: Bun.file(join(output, state + ".log")),
        stderr: Bun.file(join(output, state + "-stderr.log")),
        env: {
          ...process.env,
          TOWN_GOLDEN: "1",
          TOWN_GOLDEN_RUNS: "1",
          TOWN_GOLDEN_UPDATE: "0",
          TOWN_GOLDEN_NEGATIVE_CONTROL: "0",
          TOWN_GOLDEN_OUTPUT: join(output, state),
        },
      },
    );
    const exit = await child.exited;
    child = undefined;
    return {
      exit,
      report: JSON.parse(
        await readFile(join(output, state, "report.json"), "utf8"),
      ) as Report,
    };
  };
  try {
    mutated = true;
    await writeFile(sourcePath, mutant);
    const patch = Bun.spawnSync(["git", "diff", "--", sourcePath]);
    if (patch.exitCode !== 0)
      throw new Error("Could not record the production mutation");
    await writeFile(join(output, "mutation.diff"), patch.stdout);
    let changed: Awaited<ReturnType<typeof capture>>;
    try {
      changed = await capture("mutant");
    } finally {
      restore();
    }
    const baseline = await capture("restored");
    const referenceAfter = await hashes();
    const unchanged =
      Object.keys(references).length === Object.keys(referenceAfter).length &&
      Object.entries(references).every(
        ([name, digest]) => referenceAfter[name] === digest,
      );
    const result = {
      sourcePath,
      mutation: {
        selector: ".town-zoom",
        property: "right",
        from: "16px",
        to: "17px",
        deltaCssPixels: 1,
      },
      originalSha256: sha(source),
      mutantSha256: sha(mutant),
      restoredSha256: sha(await readFile(sourcePath, "utf8")),
      referencesUnchanged: unchanged,
      mutantExit: changed.exit,
      restoredExit: baseline.exit,
      mutant: changed.report,
      restored: baseline.report,
    };
    await writeFile(
      join(output, "control.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    verifyVisualControl(
      changed.report,
      changed.exit,
      baseline.report,
      baseline.exit,
    );
    if (!unchanged || result.restoredSha256 !== result.originalSha256)
      throw new Error(
        "Negative control changed stored goldens or failed to restore production source",
      );
    await writeFile(
      join(output, "summary.md"),
      "Production Town visual negative control: **PASS**. One-CSS-pixel zoom-control move (right: 16px to 17px) exited nonzero on changed pixels at all five viewports; restored source matched unchanged goldens. See control.json, both child reports/logs and mutant mismatch PNGs.\n",
    );
  } finally {
    restore();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    process.off("exit", restore);
  }
}
