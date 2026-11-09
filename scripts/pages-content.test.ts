import { afterEach, describe, expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkTutorialShape,
  localPageReferences,
  measureTutorial,
  renderTutorial,
  tutorialLimits,
  verifySiteReferences,
  versionSiteAssets,
} from "./pages-content";
import { siteShots } from "./site-screenshots";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "herdr-pages-test-"));
  temporaryDirectories.push(directory);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(directory, path, ".."), { recursive: true });
    await writeFile(join(directory, path), content);
  }
  return directory;
}

describe("tutorial Markdown", () => {
  test("keeps the public tutorial content and reading controls in English", async () => {
    const [markdown, template, controls] = await Promise.all(
      [
        "../docs/TUTORIAL.md",
        "../site/tutorial/index.html",
        "../site/tutorial.js",
      ].map((path) => Bun.file(new URL(path, import.meta.url)).text()),
    );
    const { content } = await renderTutorial(markdown);
    expect(template).toContain('<html lang="en">');
    expect(content).toContain(
      "From your first terminal to a workspace that travels",
    );
    expect(controls).toContain('button.textContent = "Copy command"');
    expect(controls).toContain("Self-check:");
    expect([content, template, controls].join("\n")).not.toMatch(
      /\p{Script=Han}/u,
    );
  });

  test("renders tutorial headings with stable unique IDs and a nested TOC", async () => {
    const markdown = await Bun.file(
      new URL("../docs/TUTORIAL.md", import.meta.url),
    ).text();
    const { content, navigation } = await renderTutorial(markdown);
    expect(content).toContain('id="tutorial-title"');
    const chapters = content.match(/<h2 /g)?.length ?? 0;
    const sections = content.match(/<h3 /g)?.length ?? 0;
    expect(chapters).toBe(8);
    expect(navigation.match(/<li>/g)).toHaveLength(chapters + sections);
    expect(navigation).toContain(`href="#chapter-${chapters}"`);
    expect(navigation).toContain(`href="#section-${sections}"`);
    const ids = [...content.matchAll(/\bid="([^"]*)"/g)].map(
      (match) => match[1],
    );
    expect(ids).not.toContain("");
    expect(new Set(ids).size).toBe(ids.length);
    // README, FEATURES, the knowledge map and the home page link to these.
    for (const anchor of [
      "start",
      "town",
      "town-lenses",
      "chat",
      "new-agent",
      "chimes",
      "board",
      "agent-cli",
      "desk",
      "graph",
      "daily",
      "ranger",
      "workflow",
      "networking",
      "tailscale",
      "ssh",
      "tailcat",
      "troubleshooting",
    ]) {
      expect(ids).toContain(anchor);
    }
  });

  test("gives each completion check its own callout", async () => {
    const { content } = await renderTutorial(
      "# T\n\n1. Do it.\n\n**You are done when:** it shows.\n",
    );
    expect(content).toContain(
      '<p class="tutorial-done"><strong>You are done when:</strong> it shows.</p>',
    );
  });

  test("rewrites images and canonical docs, preserves code and source anchors", async () => {
    const { content } = await renderTutorial(
      '# Tutorial\n\n<a id="tailscale"></a>\n\n## Networking\n\n' +
        "[Jump](#tailscale) [Deployment](./DEPLOYMENT.md#logging) [Security](../SECURITY.md)\n\n" +
        "![Workspace](./images/herdr-world-desktop-office.png)\n\n```bash\necho '<safe>'\n```\n\n" +
        "| Name | Purpose |\n| --- | --- |\n| Serve | Private access |\n",
    );
    expect(content).toContain('href="#tailscale"');
    expect(content).toContain(
      'href="https://github.com/IvoryHeart/herdr-world/blob/main/docs/DEPLOYMENT.md#logging"',
    );
    expect(content).toContain(
      'href="https://github.com/IvoryHeart/herdr-world/blob/main/SECURITY.md"',
    );
    expect(content).toContain('src="../assets/herdr-world-desktop-office.png"');
    expect(content).toContain('width="1440"');
    expect(content).toContain('height="900"');
    expect(content).toContain('loading="lazy"');
    expect(content).toContain("&lt;safe&gt;");
    expect(content).toContain('role="region"');
    expect(content).toContain(
      'aria-label="Horizontally scrollable reference table"',
    );
    expect(content).not.toContain("<safe>");
  });
});

describe("Pages asset versions", () => {
  test("a changed stylesheet gets a new URL across pages while unchanged scripts keep theirs", async () => {
    const directory = await fixture({
      "index.html":
        '<link href="styles.css"><script src="main.js"></script><img src="image.png">',
      "tutorial/index.html":
        '<link href="../styles.css"><script src="../main.js"></script>',
      "styles.css": ".release { display: block }",
      "main.js": 'console.log("ready")',
      "image.png": "image",
    });
    await versionSiteAssets(directory);
    const first = await Bun.file(join(directory, "index.html")).text();
    const css = first.match(/styles\.css\?v=([a-f0-9]{12})/)!;
    const js = first.match(/main\.js\?v=([a-f0-9]{12})/)!;
    expect(css).not.toBeNull();
    expect(js).not.toBeNull();
    expect(
      await Bun.file(join(directory, "tutorial/index.html")).text(),
    ).toContain(`../${css[0]}`);
    await writeFile(
      join(directory, "styles.css"),
      ".release { display: flex }",
    );
    await versionSiteAssets(directory);
    const second = await Bun.file(join(directory, "index.html")).text();
    expect(second).not.toContain(css[0]);
    expect(second).toContain(js[0]);
    expect(second).toContain('src="image.png"');
    await verifySiteReferences(directory);
  });
});

describe("Pages references", () => {
  test("the public landing page presents World without the upstream demo or preview caveats", async () => {
    const site = await Bun.file(
      new URL("../site/index.html", import.meta.url),
    ).text();
    const build = await Bun.file(
      new URL("./build-pages.ts", import.meta.url),
    ).text();
    expect(site).not.toMatch(
      /roamgate-handoff|upstream-demo-title|source preview|Town preview/i,
    );
    expect(build).not.toContain("roamgate-handoff");
    expect(site).toContain("Know who needs you next.");
    expect(site).not.toContain('id="tab-tree"');
  });
  test("agent logos illustrate product examples, not a hero support list", async () => {
    const html = await Bun.file(
      new URL("../site/index.html", import.meta.url),
    ).text();
    const sources = new Set<string>();
    const labels: string[] = [];
    let heroLogos = 0;
    await new HTMLRewriter()
      .on("img.agent-logo", {
        element(element) {
          sources.add(element.getAttribute("src") ?? "");
          expect(element.getAttribute("alt")).toBe("");
          expect(element.getAttribute("width")).toBe("28");
          expect(element.getAttribute("height")).toBe("28");
        },
      })
      .on(".hero-copy .agent-logo", {
        element() {
          heroLogos++;
        },
      })
      .on(".mini-agent strong", {
        text(chunk) {
          if (chunk.text.trim()) labels.push(chunk.text.trim());
        },
      })
      .transform(new Response(html))
      .text();
    expect(heroLogos).toBe(0);
    expect(html).not.toContain('class="agent-brands"');
    expect(labels).toEqual(["codex", "pi", "kimi"]);
    expect([...sources]).toEqual([]);
    expect(html).toContain('class="agent-stack"');
  });

  test("describes aggregate host views with independently owned resources", async () => {
    const site = await Bun.file(
      new URL("../site/index.html", import.meta.url),
    ).text();
    expect(site).toContain("one shared view");
    expect(site).toContain("Hosts filters the overview");
    expect(site).toContain("host-owned terminals");
    expect(site).not.toContain("projects the selected host");
    expect(site).not.toContain("selected host's spaces");
  });

  test("social previews and canonical URLs use the production domain", async () => {
    for (const page of ["index.html", "tutorial/index.html"]) {
      const html = await Bun.file(
        new URL(`../site/${page}`, import.meta.url),
      ).text();
      expect(html).toContain("https://herdr.world/");
      expect(html).toMatch(
        /property="og:image"\s+content="https:\/\/herdr\.world\/herdr-world-og\.png"/,
      );
      expect(html).toMatch(
        /name="twitter:image"\s+content="https:\/\/herdr\.world\/herdr-world-og\.png"/,
      );
      expect(html).toContain(
        'name="twitter:card" content="summary_large_image"',
      );
      const url = `https://herdr.world/${page.replace("index.html", "")}`;
      expect(html.replace(/\s+/g, " ")).toContain(
        `rel="canonical" href="${url}"`,
      );
    }
    expect(
      await Bun.file(
        new URL("../site/herdr-world-og.png", import.meta.url),
      ).exists(),
    ).toBe(true);
    for (const file of ["robots.txt", "sitemap.xml"]) {
      const content = await Bun.file(
        new URL(`../site/${file}`, import.meta.url),
      ).text();
      expect(content).toContain("https://herdr.world/");
    }
  });

  test("website and tutorial reuse the current README screenshots", async () => {
    const [readme, site, tutorial, build] = await Promise.all(
      [
        "../README.md",
        "../site/index.html",
        "../docs/TUTORIAL.md",
        "./build-pages.ts",
      ].map((path) => Bun.file(new URL(path, import.meta.url)).text()),
    );
    const screenshotPattern = /herdr-world-(?:desktop|mobile)-[a-z-]+\.png/g;
    const screenshots = [...new Set(readme.match(screenshotPattern))].sort();
    expect(screenshots).toHaveLength(11);
    expect([...new Set(build.match(screenshotPattern))].sort()).toEqual(
      screenshots,
    );
    // Every image the site capture draws is a shared, published screenshot.
    for (const shot of siteShots) expect(screenshots).toContain(shot.file);
    // The site's phone row has three slots. Every desktop view appears except
    // Chat, which still shows the 0.2.7 Town behind its window: the site
    // shows Chat with the phone capture (docs/SCREENSHOTS.md).
    const siteScreenshots = [...new Set(site.match(screenshotPattern))].sort();
    for (const image of siteScreenshots) expect(screenshots).toContain(image);
    expect(siteScreenshots).toEqual(
      expect.arrayContaining([
        ...screenshots.filter(
          (s) => s.includes("-desktop-") && !s.endsWith("-chat.png"),
        ),
        "herdr-world-mobile-chat.png",
      ]),
    );
    for (const source of [site, tutorial, build]) {
      expect(source).not.toMatch(/herdr-studio-(?:desktop|mobile)-/);
    }
    for (const image of tutorial.match(screenshotPattern) ?? []) {
      expect(screenshots).toContain(image);
    }
  });

  test("collects relative links and responsive images without external URLs", () => {
    expect(
      localPageReferences(
        '<a href="./tutorial/">Read</a><a href="#top">Top</a>' +
          '<a href="https://example.com">External</a>' +
          '<img src="../assets/a.png" srcset="../assets/a.png 1x, ../assets/b.png 2x">',
      ),
    ).toEqual(["./tutorial/", "#top", "../assets/a.png", "../assets/b.png"]);
  });

  test("rejects root-relative assets and protocol-relative links", () => {
    expect(() => localPageReferences('<img src="/assets/a.png">')).toThrow(
      "Root-relative",
    );
    expect(() => localPageReferences('<a href="//example.com">')).toThrow(
      "Root-relative",
    );
  });

  test("validates nested Pages routes, fragments, and parent-relative assets", async () => {
    const directory = await fixture({
      "index.html":
        '<h1 id="top">Home</h1><a href="./tutorial/#chapter-1">Read</a>',
      "tutorial/index.html":
        '<h1 id="chapter-1">Read</h1><a href="../index.html#top">Home</a>' +
        '<a href="#chapter-1">Start</a><img src="../assets/a.png?v=1">',
      "assets/a.png": "test fixture",
    });
    expect(await verifySiteReferences(directory)).toBeUndefined();
  });

  test("detects missing references inside nested pages", async () => {
    const directory = await fixture({
      "index.html": '<a href="./tutorial/">Read</a>',
      "tutorial/index.html": '<img src="../assets/missing.png">',
    });
    await rejects(verifySiteReferences(directory), /Missing site reference/);
  });

  test("detects broken cross-page fragments", async () => {
    const directory = await fixture({
      "index.html": '<a href="./tutorial/#missing">Read</a>',
      "tutorial/index.html": '<h1 id="present">Read</h1>',
    });
    await rejects(verifySiteReferences(directory), /Missing fragment/);
  });

  test("detects duplicate IDs", async () => {
    const directory = await fixture({
      "index.html": '<h1 id="same">Home</h1><h2 id="same">Read</h2>',
    });
    await rejects(verifySiteReferences(directory), /Duplicate HTML IDs/);
  });

  test("rejects a reference that escapes the built site", async () => {
    const directory = await fixture({
      "index.html": '<a href="../private.txt">Outside</a>',
    });
    await rejects(verifySiteReferences(directory), /escapes output/);
  });
});

describe("tutorial shape", () => {
  const step = (words: number) =>
    Array.from({ length: words }, (_, i) => `word${i}`).join(" ");

  test("the tutorial stays within its learner's limits", async () => {
    const markdown = await Bun.file(
      new URL("../docs/TUTORIAL.md", import.meta.url),
    ).text();
    expect(() => checkTutorialShape(markdown)).not.toThrow();
    const { words, longest } = measureTutorial(markdown);
    expect(words).toBeLessThanOrEqual(tutorialLimits.words);
    expect(longest.words).toBeLessThanOrEqual(tutorialLimits.blockWords);
  });

  test("refuses a step that grows into a wall of text", () => {
    const markdown = `# T\n\n1. Short step.\n2. ${step(tutorialLimits.blockWords + 1)}\n   continued.\n`;
    expect(measureTutorial(markdown).longest.words).toBe(
      tutorialLimits.blockWords + 2,
    );
    expect(() => checkTutorialShape(markdown)).toThrow(/FEATURES\.md/);
  });

  test("measures a step as a whole, not paragraph by paragraph", () => {
    const paragraphs = Array.from({ length: 5 }, () => `   ${step(40)}`);
    const markdown = `# T\n\n1. Step.\n\n${paragraphs.join("\n\n")}\n\n2. Next.\n`;
    expect(measureTutorial(markdown).longest.words).toBe(201);
    expect(() => checkTutorialShape(markdown)).toThrow(/201-word step/);
  });

  test("refuses a tutorial over its word budget", () => {
    const paragraph = step(tutorialLimits.blockWords - 10);
    const count =
      Math.ceil(tutorialLimits.words / paragraph.split(" ").length) + 1;
    const markdown = Array.from({ length: count }, () => paragraph).join(
      "\n\n",
    );
    expect(() => checkTutorialShape(markdown)).toThrow(/words of prose/);
  });

  test("counts prose only: not code, comments, link targets or images", () => {
    const { words } = measureTutorial(
      "<!-- a long maintainer note here -->\n\n" +
        "Open [the guide](./DEPLOYMENT.md#install-a-release) now.\n\n" +
        "![Alt text words](./images/a.png)\n\n" +
        "```bash\nherdr-world --host 127.0.0.1 --port 8787\n```\n\n" +
        "> Quoted tip.\n\n| Mark | Meaning |\n| --- | --- |\n| **!** | Blocked |\n",
    );
    // Open the guide now (4) + Quoted tip (2) + Mark Meaning (2) + Blocked (1)
    expect(words).toBe(9);
  });
});

describe("public documentation links", () => {
  test("local documents and fragments referenced by release guidance exist", async () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    for (const source of [
      "README.md",
      "FEATURES.md",
      "SECURITY.md",
      "docs/DEPLOYMENT.md",
      "docs/ARCHITECTURE.md",
      "docs/TUTORIAL.md",
      "docs/SCREENSHOTS.md",
      "docs/release.md",
    ]) {
      const sourcePath = join(root, source);
      const markdown = await Bun.file(sourcePath).text();
      for (const match of markdown.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
        const href = match[1]!;
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
        const [path, fragment] = href.split("#");
        const targetPath = resolve(dirname(sourcePath), path || sourcePath);
        const target = Bun.file(targetPath);
        expect(await target.exists(), `${source}: ${href}`).toBe(true);
        if (!fragment) continue;
        const text = await target.text();
        const anchors = new Set(
          [...text.matchAll(/(?:id|name)="([^"\s]+)"/g)].map(
            (entry) => entry[1],
          ),
        );
        for (const heading of text.matchAll(/^#{1,6} (.+)$/gm)) {
          anchors.add(
            heading[1]!
              .toLowerCase()
              .replace(/[^\p{L}\p{N}_ -]/gu, "")
              .replace(/ /g, "-"),
          );
        }
        expect(
          anchors.has(decodeURIComponent(fragment)),
          `${source}: ${href}`,
        ).toBe(true);
      }
    }
  });
});
