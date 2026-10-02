import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

const asset = async (path: string) =>
  Buffer.from(
    await Bun.file(new URL(`../${path}`, import.meta.url)).arrayBuffer(),
  );

test("brand icons and sharing images have the declared dimensions", async () => {
  const images: [string, number, number][] = [
    ...[180, 192, 512].map((size): [string, number, number] => [
      `web/public/herdr-world-icon-${size}.png`,
      size,
      size,
    ]),
    ["web/public/herdr-world-icon-maskable-192.png", 192, 192],
    ["web/public/herdr-world-icon-maskable-512.png", 512, 512],
    ["site/herdr-world-og.png", 1200, 630],
    ["site/github-social-preview.png", 1280, 640],
  ];
  for (const [path, width, height] of images) {
    const png = await asset(path);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
      width,
      height,
    ]);
  }
});

test("the application uses only World-owned brand asset paths", async () => {
  const [index, app, manifest] = await Promise.all([
    Bun.file(new URL("../web/index.html", import.meta.url)).text(),
    Bun.file(new URL("../web/src/App.tsx", import.meta.url)).text(),
    Bun.file(new URL("../web/public/manifest.json", import.meta.url)).text(),
  ]);
  expect(index).toContain("/herdr-world-logo.svg");
  expect(app).toContain("/herdr-world-logo.svg");
  expect(manifest).toContain("herdr-world-icon-maskable-512.png");
  expect(`${index}\n${app}\n${manifest}`.toLowerCase()).not.toContain(
    "roamgate",
  );
});

test("the project site uses the World ram identity instead of renamed upstream art", async () => {
  const [index, tutorial, logo] = await Promise.all([
    Bun.file(new URL("../site/index.html", import.meta.url)).text(),
    Bun.file(new URL("../site/tutorial/index.html", import.meta.url)).text(),
    Bun.file(
      new URL("../site/assets/herdr-world-logo.svg", import.meta.url),
    ).text(),
  ]);
  expect(index).toContain("./assets/herdr-world-logo.svg");
  expect(tutorial).toContain("../assets/herdr-world-logo.svg");
  expect(logo).toContain('aria-label="Herdr logo"');
  // Source attribution may name Roamgate; presentation and asset URLs use World.
  for (const html of [index, tutorial]) {
    const branding: string[] = [];
    await new HTMLRewriter()
      .on('img, meta, link[rel="icon"], link[rel="apple-touch-icon"]', {
        element(element) {
          for (const name of ["src", "href", "content", "alt"]) {
            const value = element.getAttribute(name);
            if (value) branding.push(value);
          }
        },
      })
      .on("title, .brand", {
        text(chunk) {
          branding.push(chunk.text);
        },
      })
      .transform(new Response(html))
      .text();
    expect(branding.join("\n").toLowerCase()).not.toMatch(
      /roamgate|herdr-studio/,
    );
  }
  expect(logo.toLowerCase()).not.toContain("roamgate");
  expect(index).toContain('href="https://github.com/powerfooI/roamgate"');
  expect(index).toContain('href="./assets/agent-icons-LICENSE.txt"');
  expect(
    existsSync(
      new URL(
        "../site/assets/herdr-world-lockup-charcoal.png",
        import.meta.url,
      ),
    ),
  ).toBeFalse();
});
