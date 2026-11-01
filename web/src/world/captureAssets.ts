/** Wait on browser resources with removable listeners, owned by one revision. */
function resourceEvent(
  target: EventTarget,
  events: string[],
  ready: () => boolean,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      for (const event of events) target.removeEventListener(event, inspect);
      signal.removeEventListener("abort", aborted);
    };
    const aborted = () => {
      cleanup();
      reject(signal.reason);
    };
    const inspect = () => {
      try {
        if (ready()) {
          cleanup();
          resolve();
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    if (signal.aborted) {
      aborted();
      return;
    }
    for (const event of events) target.addEventListener(event, inspect);
    signal.addEventListener("abort", aborted, { once: true });
    inspect();
  });
}

/** Decode/FontFaceSet promises follow completed loads; abort releases our waiter. */
function decoded(operation: Promise<unknown>, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      reject(signal.reason);
    };
    if (signal.aborted) {
      aborted();
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    void operation.then(
      () => {
        signal.removeEventListener("abort", aborted);
        resolve();
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}
export async function captureAssets(root: HTMLElement, signal: AbortSignal) {
  signal.throwIfAborted();
  // Discover the committed DOM's fonts before subscribing to their completion.
  root.getBoundingClientRect();
  const fonts = root.ownerDocument.fonts;
  if (!fonts) throw new Error("Capture requires browser FontFaceSet");
  await resourceEvent(
    fonts,
    ["loadingdone", "loadingerror"],
    () => fonts.status === "loaded",
    signal,
  );
  await decoded(fonts.ready, signal);
  await Promise.all(
    Array.from(root.querySelectorAll("img"))
      .filter((image) => image.checkVisibility())
      .map(async (image) => {
        await resourceEvent(
          image,
          ["load", "error"],
          () => {
            if (!image.complete) return false;
            if (!image.naturalWidth)
              throw new Error("Capture image failed to load");
            return true;
          },
          signal,
        );
        signal.throwIfAborted();
        await decoded(image.decode(), signal);
      }),
  );
}
