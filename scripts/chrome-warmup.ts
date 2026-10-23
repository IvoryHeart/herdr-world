import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A fresh CI runner's first Chrome launch builds the user's fontconfig cache
 * and pages Chrome in from a cold disk. Measured on six runners it took
 * 0.9–14.6 s, against about 0.5 s for every later launch, and whichever
 * browser test happened to start Chrome first paid it inside its 35 s startup
 * budget. Pay it once, up front, outside any test's budget.
 */
export async function warmChrome(
  chrome: string,
  options: { timeoutMs?: number; log?: (message: string) => void } = {},
): Promise<number | undefined> {
  const log = options.log ?? ((message: string) => console.info(message));
  const profile = mkdtempSync(join(tmpdir(), "chrome-warmup-"));
  const began = performance.now();
  try {
    const child = Bun.spawn(
      [
        chrome,
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        `--user-data-dir=${profile}`,
        "--dump-dom",
        "about:blank",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    const timer = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeoutMs ?? 120_000,
    );
    const code = await child.exited;
    clearTimeout(timer);
    const seconds = (performance.now() - began) / 1000;
    // A failed warm-up is reported, not fatal: the suites then show the real error.
    log(
      code === 0
        ? `[chrome-warmup] first Chrome launch took ${seconds.toFixed(1)}s`
        : `[chrome-warmup] Chrome exited ${code} after ${seconds.toFixed(1)}s`,
    );
    return code === 0 ? seconds : undefined;
  } catch (error) {
    log(`[chrome-warmup] could not start Chrome: ${String(error)}`);
    return undefined;
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
