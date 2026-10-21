import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { buildWorldBrowserBundle } from "../web/src/world/testing/browserBundles";

// Run one installed version at a time. Dependency switches stay explicit, so
// this tool cannot mutate a developer's manifest or lockfile.
const output = resolve(process.argv[2] || ".agents/react-benchmark");
const requireWeb = createRequire(resolve("web/package.json"));
const react = requireWeb("react/package.json").version;
const reactDom = requireWeb("react-dom/package.json").version;
if (react !== reactDom) throw new Error("React and React DOM versions differ");
const root = await mkdtemp(join(tmpdir(), "world-react-benchmark-"));
await mkdir(output, { recursive: true });
try {
  const bundle = await buildWorldBrowserBundle("ProductionContexts", root, {
    production: true,
  });
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      "web/src/world/ProductionContexts.board.test.ts",
      "web/src/world/ProductionContexts.town.test.ts",
      "web/src/world/ProductionContexts.animated.test.ts",
      "--max-concurrency=1",
    ],
    {
      env: { ...process.env, HERDR_WORLD_TEST_ASSETS: root },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  await writeFile(join(output, "run.log"), stdout + stderr);
  const cases = stdout.split("\n").flatMap((line) => {
    const match = line.match(/^Production dense (.+?) (\d+)px: (\{.*\})$/);
    return match
      ? [
          {
            workload: match[1],
            width: Number(match[2]),
            ...JSON.parse(match[3]),
          },
        ]
      : [];
  });
  if (exitCode === 0 && cases.length !== 6)
    throw new Error(`Expected six measured cases, received ${cases.length}`);
  const result = {
    react,
    reactDom,
    mode: "production",
    rendererModules: bundle.reactDomModules,
    exitCode,
    cases,
  };
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify({ react, exitCode, cases: cases.length, output }));
  if (exitCode !== 0)
    console.error((stdout + stderr).split("\n").slice(-45).join("\n"));
  process.exitCode = exitCode;
} finally {
  await rm(root, { recursive: true, force: true });
}
