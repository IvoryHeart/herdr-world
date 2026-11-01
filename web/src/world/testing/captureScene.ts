import type { CaptureView, DrawReceipt } from "../drawReadiness";
export type CaptureCommand = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<any>;
export type CaptureOptions = {
  view?: CaptureView;
  width: number;
  height: number;
  timeoutMs?: number;
  /** Fixture-specific visible content. Omit for legitimately empty views. */
  content?: { selector: string; minimum?: number };
};
async function evaluate(command: CaptureCommand, expression: string) {
  const reply = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (reply.exceptionDetails)
    throw new Error(
      `Capture page: ${reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text}`,
    );
  return reply.result.value;
}
/** Fence before resizing, including when topology and CSS shape stay identical. */
export async function resizeCapture(
  command: CaptureCommand,
  width: number,
  height: number,
) {
  await evaluate(command, `window.__HERDR_WORLD_CAPTURE__?.invalidate()`);
  await command("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}
/** Returns bytes only after readiness, content checks and a final currency check. */
export async function captureScene(
  command: CaptureCommand,
  options: CaptureOptions,
) {
  const receipt = (await evaluate(
    command,
    `(async () => {
    const capture = window.__HERDR_WORLD_CAPTURE__;
    if (!capture) throw new Error("No World capture surface installed");
    return capture.wait(${JSON.stringify({ ...options, timeoutMs: options.timeoutMs ?? 15_000 })});
  })()`,
  )) as DrawReceipt;
  const check = `window.__HERDR_WORLD_CAPTURE__?.matches(${JSON.stringify(receipt)})`;
  if (!(await evaluate(command, check)))
    throw new Error("Capture revision changed before screenshot");
  const region = await evaluate(
    command,
    `(() => {
    const root = document.querySelector('[data-world-capture-owner="${receipt.owner}"]');
    if (!root) throw new Error("Capture main surface missing");
    const content = ${JSON.stringify(options.content ?? null)};
    const visible = (el) => el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) && (() => {const b=el.getBoundingClientRect();return b.right>0&&b.bottom>0&&b.left<innerWidth&&b.top<innerHeight;})();
    if (content && [...root.querySelectorAll(content.selector)].filter(visible).length < (content.minimum ?? 1))
      throw new Error("Capture expected content missing: " + content.selector);
    const b = root.getBoundingClientRect();
    return {x:Math.max(0,b.x),y:Math.max(0,b.y),width:Math.min(innerWidth,b.right)-Math.max(0,b.x),height:Math.min(innerHeight,b.bottom)-Math.max(0,b.y)};
  })()`,
  );
  const screenshot = await command("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const sanity = await evaluate(
    command,
    `(async () => {
    const image = new Image(); image.src = "data:image/png;base64," + ${JSON.stringify(screenshot.data)}; await image.decode();
    if (image.width !== ${options.width} || image.height !== ${options.height}) throw new Error("Capture image dimensions mismatch: " + image.width + "x" + image.height + "; expected ${options.width}x${options.height}");
    const region = ${JSON.stringify(region)};
    if (region.width <= 0 || region.height <= 0) throw new Error("Capture surface has no visible area");
    const canvas = document.createElement("canvas"); canvas.width=64;canvas.height=64;
    const ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=false;
    ctx.drawImage(image,region.x,region.y,region.width,region.height,0,0,64,64);
    const pixels=ctx.getImageData(0,0,64,64).data, bins=new Map(); let dominant=0;
    for(let i=0;i<pixels.length;i+=4){const key=(pixels[i]>>4)*256+(pixels[i+1]>>4)*16+(pixels[i+2]>>4);const n=(bins.get(key)??0)+1;bins.set(key,n);dominant=Math.max(dominant,n);}
    const foreground=1-dominant/4096;
    if (${!!options.content} && foreground < 0.02) throw new Error("Capture predominantly background: " + foreground);
    return {foreground,width:image.width,height:image.height};
  })()`,
  );
  if (!(await evaluate(command, check)))
    throw new Error(
      `Capture revision changed during screenshot; discarded: ${JSON.stringify(await evaluate(command, `window.__HERDR_WORLD_CAPTURE__?.diagnostics(${JSON.stringify(receipt)})`))}; requested=${JSON.stringify(receipt)}`,
    );
  return { bytes: Buffer.from(screenshot.data, "base64"), receipt, sanity };
}
