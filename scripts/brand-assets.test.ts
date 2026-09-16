import { expect, test } from "bun:test";

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
