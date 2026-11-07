import { expect, test } from "bun:test";
import { captureAssets } from "./captureAssets";

class Resource extends EventTarget {
  listeners = new Set<string>();
  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ) {
    this.listeners.add(type);
    super.addEventListener(type, callback, options);
  }
  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ) {
    this.listeners.delete(type);
    super.removeEventListener(type, callback, options);
  }
}
function fixture(loadingFont = false) {
  const fonts = Object.assign(new Resource(), {
    status: loadingFont ? "loading" : "loaded",
    ready: loadingFont ? new Promise<void>(() => {}) : Promise.resolve(),
  });
  let decodes = 0;
  const image = Object.assign(new Resource(), {
    complete: false,
    naturalWidth: 0,
    checkVisibility: () => true,
    decode: async () => {
      decodes++;
    },
  });
  const images = [image];
  const root = {
    getBoundingClientRect: () => ({}),
    ownerDocument: { fonts },
    querySelectorAll: () => images,
  } as unknown as HTMLElement;
  return { root, fonts, image, images, decodes: () => decodes };
}
const microtasks = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

test.each(["font", "image"])(
  "abandoning an unresolved %s removes its listeners and admits replacement assets",
  async (kind) => {
    const f = fixture(kind === "font"),
      old = new AbortController();
    const pending = captureAssets(f.root, old.signal).catch(
      (error: Error) => error,
    );
    await microtasks();
    expect((kind === "font" ? f.fonts : f.image).listeners.size).toBe(2);
    old.abort();
    await pending;
    expect(f.fonts.listeners.size).toBe(0);
    expect(f.image.listeners.size).toBe(0);
    expect(f.decodes()).toBe(0);
    // Neither old resource is released. A different required resource set succeeds.
    const current = fixture();
    current.images.length = 0;
    await captureAssets(current.root, new AbortController().signal);
  },
);

test("image load, then decode, are both required; obsolete decode cannot hold a waiter", async () => {
  const f = fixture(),
    controller = new AbortController(),
    decode = Promise.withResolvers<void>();
  let complete = false;
  f.image.decode = () => decode.promise;
  const pending = captureAssets(f.root, controller.signal).then(
    () => {
      complete = true;
    },
    (error: Error) => error,
  );
  await microtasks();
  f.image.complete = true;
  f.image.naturalWidth = 16;
  f.image.dispatchEvent(new Event("load"));
  await microtasks();
  expect(complete).toBe(false);
  expect(f.image.listeners.size).toBe(0);
  controller.abort();
  expect(await pending).toBeInstanceOf(Error);
  decode.resolve();
  await microtasks();
  expect(complete).toBe(false);
});
