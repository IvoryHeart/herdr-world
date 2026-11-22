import { cp, copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkTutorialShape,
  renderTutorial,
  verifySiteReferences,
  versionSiteAssets,
} from "./pages-content";
import { renderHelpSite } from "./help-docs";
import { pagesBuildConfig, filmBuildConfig } from "./site-bundles";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDirectory = join(root, "site");
const outputDirectory = join(root, ".pages-dist");
const assetDirectory = join(outputDirectory, "assets");

const assets = [
  ["docs/images/herdr-world-desktop-town.png", "herdr-world-desktop-town.png"],
  [
    "docs/images/herdr-world-desktop-town-steps.png",
    "herdr-world-desktop-town-steps.png",
  ],
  ["docs/images/herdr-world-mobile-town.png", "herdr-world-mobile-town.png"],
  [
    "docs/images/herdr-world-desktop-board.png",
    "herdr-world-desktop-board.png",
  ],
  ["docs/images/herdr-world-mobile-board.png", "herdr-world-mobile-board.png"],
  [
    "docs/images/herdr-world-desktop-spaces.png",
    "herdr-world-desktop-spaces.png",
  ],
  [
    "docs/images/herdr-world-desktop-files.png",
    "herdr-world-desktop-files.png",
  ],
  [
    "docs/images/herdr-world-desktop-changes.png",
    "herdr-world-desktop-changes.png",
  ],
  ["docs/images/herdr-world-desktop-chat.png", "herdr-world-desktop-chat.png"],
  ["docs/images/herdr-world-mobile-chat.png", "herdr-world-mobile-chat.png"],
  [
    "docs/images/herdr-world-mobile-spaces.png",
    "herdr-world-mobile-spaces.png",
  ],
] as const;

async function ensureFile(path: string): Promise<void> {
  const file = await stat(path);
  if (!file.isFile()) throw new Error(`Expected a file at ${path}`);
}

await rm(outputDirectory, { force: true, recursive: true });
await cp(sourceDirectory, outputDirectory, { recursive: true });
await mkdir(assetDirectory, { recursive: true });

for (const [source, destination] of assets) {
  const sourcePath = join(root, source);
  await ensureFile(sourcePath);
  await copyFile(sourcePath, join(assetDirectory, destination));
}

const tutorialMarkdown = await Bun.file(join(root, "docs/TUTORIAL.md")).text();
checkTutorialShape(tutorialMarkdown);
const tutorial = await renderTutorial(tutorialMarkdown);
const tutorialPath = join(outputDirectory, "tutorial/index.html");
const template = await Bun.file(tutorialPath).text();
for (const slot of ["content", "navigation"]) {
  if (!template.includes(`<!-- tutorial:${slot} -->`)) {
    throw new Error(`Missing tutorial template slot: ${slot}`);
  }
}
await writeFile(
  tutorialPath,
  template
    .replace("<!-- tutorial:content -->", () => tutorial.content)
    .replace("<!-- tutorial:navigation -->", () => tutorial.navigation),
);

// The help page: docs/HELP.md, generated from the help declarations, with
// the pictures it shows (scripts/help-docs.ts).
const help = await renderHelpSite(
  await Bun.file(join(root, "docs/HELP.md")).text(),
);
const helpPath = join(outputDirectory, "help/index.html");
const helpTemplate = await Bun.file(helpPath).text();
for (const slot of ["content", "navigation"]) {
  if (!helpTemplate.includes(`<!-- help:${slot} -->`)) {
    throw new Error(`Missing help template slot: ${slot}`);
  }
}
await writeFile(
  helpPath,
  helpTemplate
    .replace("<!-- help:content -->", () => help.content)
    .replace("<!-- help:navigation -->", () => help.navigation),
);
await mkdir(join(assetDirectory, "help"), { recursive: true });
for (const picture of help.pictures) {
  const sourcePath = join(root, "web/public/help", picture);
  await ensureFile(sourcePath);
  await copyFile(sourcePath, join(assetDirectory, "help", picture));
}

const build = await Bun.build({
  ...pagesBuildConfig,
  entrypoints: [
    join(sourceDirectory, "main.js"),
    join(sourceDirectory, "styles.css"),
    join(sourceDirectory, "tutorial.js"),
    join(sourceDirectory, "tutorial.css"),
  ],
  outdir: outputDirectory,
});
if (!build.success) {
  throw new AggregateError(build.logs, "Failed to optimize the Pages site");
}
// styles.css imports the home page's sections; the bundle carries them.
await rm(join(outputDirectory, "home.css"));

// The film draws its Town with the app's own Town code, bundled beside it.
const filmTown = await Bun.build({
  ...filmBuildConfig,
  entrypoints: [join(sourceDirectory, "film/town-art.ts")],
  outdir: join(outputDirectory, "film"),
});
if (!filmTown.success) {
  throw new AggregateError(filmTown.logs, "Failed to bundle the film's Town");
}
await rm(join(outputDirectory, "film/town-art.ts"));

await writeFile(join(outputDirectory, ".nojekyll"), "");
await versionSiteAssets(outputDirectory);
await verifySiteReferences(outputDirectory);

const size = await Array.fromAsync(
  new Bun.Glob("**/*").scan({ cwd: outputDirectory, onlyFiles: true }),
  async (path) => {
    const file = await stat(join(outputDirectory, path));
    return file.size;
  },
).then((sizes) => sizes.reduce((total, fileSize) => total + fileSize, 0));

process.stdout.write(
  `Built GitHub Pages site in .pages-dist (${assets.length} shared screenshots, ${(size / 1024 / 1024).toFixed(2)} MiB)\n`,
);
