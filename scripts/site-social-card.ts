/**
 * herdr.world's sharing images: the brand, one line on what World does and
 * the captured Town, drawn as HTML and photographed by scripts/site-screenshots.ts.
 * The fonts are the film's (site/film/fonts); the Town is the fresh capture.
 */

/** The two sharing images and their platform sizes. */
export const socialCards = [
  { file: "herdr-world-og.png", width: 1200, height: 630 },
  { file: "github-social-preview.png", width: 1280, height: 640 },
] as const;

export const SOCIAL_HEADLINE =
  "Run a crew of coding agents. See who needs you.";
export const SOCIAL_LINE =
  "Town, Board and Chat for your agents on local and SSH Herdr hosts.";

/** The card's page; `/logo.svg`, `/town.png` and `/fonts/*` are served beside it. */
export function socialCardHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Big Shoulders Display"; font-weight: 800 900; src: url("/fonts/big-shoulders-display.woff2") format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-weight: 400 700; src: url("/fonts/jetbrains-mono.woff2") format("woff2"); }
* { box-sizing: border-box; margin: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body {
  position: relative;
  background:
    radial-gradient(circle at 18% 12%, rgba(72, 114, 210, 0.32), transparent 26rem),
    radial-gradient(circle at 90% 100%, rgba(84, 209, 122, 0.16), transparent 30rem),
    #080b12;
  color: #f5f7ff;
  font-family: "Noto Sans", ui-sans-serif, sans-serif;
}
.copy { position: absolute; left: 6.2%; top: 0; bottom: 0; width: 43%; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
.brand { display: flex; align-items: center; gap: 16px; font-family: "JetBrains Mono", monospace; font-weight: 700; font-size: 26px; letter-spacing: 0.01em; }
.brand img { width: 58px; height: 58px; border-radius: 14px; }
h1 { font-family: "Big Shoulders Display", sans-serif; font-weight: 900; font-size: 66px; line-height: 0.98; text-transform: uppercase; letter-spacing: 0.005em; }
h1 span { color: #f0c453; }
p { font-size: 22px; line-height: 1.4; color: #c4cbe0; }
.url { font-family: "JetBrains Mono", monospace; font-size: 18px; color: #7aa2f7; }
.shot {
  position: absolute; left: 53%; top: 9%; width: 70%; height: 82%;
  border-radius: 22px; overflow: hidden;
  border: 1px solid rgba(167, 181, 218, 0.24);
  box-shadow: 0 42px 120px rgba(0, 0, 0, 0.55);
  background: url("/town.png") 44% 66% / 150% auto no-repeat;
}
</style></head><body>
<div class="copy">
  <div class="brand"><img src="/logo.svg" alt="">Herdr.World</div>
  <h1>Run a crew of coding agents. <span>See who needs you.</span></h1>
  <p>${SOCIAL_LINE}</p>
  <div class="url">herdr.world</div>
</div>
<div class="shot" role="img" aria-label="Herdr.World Town"></div>
</body></html>`;
}
