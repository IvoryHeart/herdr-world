import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const BROWSER_STARTUP_TIMEOUT_MS = 35_000;

export async function waitForBrowserFixture<T>(
  pageRequested: Promise<void>,
  result: Promise<T>,
  browserExited: Promise<never>,
  label: string,
  fixtureTimeoutMs: number,
): Promise<T> {
  await withBrowserDeadline(
    Promise.race([pageRequested, browserExited]),
    `${label} browser startup`,
    BROWSER_STARTUP_TIMEOUT_MS,
  );
  // Include HTML/assets and application initialization in the existing case budget.
  return withBrowserDeadline(
    Promise.race([result, browserExited]),
    label,
    fixtureTimeoutMs,
  );
}

export async function withBrowserDeadline<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = 10_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function stopChrome(
  child: Pick<ReturnType<typeof Bun.spawn>, "kill" | "exited"> | undefined,
): Promise<void> {
  if (!child) return;
  // Let Chrome release its renderer resources before the next browser case.
  child.kill("SIGTERM");
  try {
    await withBrowserDeadline(child.exited, "Chrome exit", 2_000);
  } catch {
    child.kill("SIGKILL");
    await withBrowserDeadline(child.exited, "Chrome forced exit", 2_000);
  }
}

export async function waitForChromePort(
  child: { readonly exitCode: number | null },
  profile: string,
  errorOutput: string,
): Promise<string> {
  const portFile = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 20_000;
  while (child.exitCode === null && Date.now() < deadline) {
    if (existsSync(portFile)) {
      const [port, endpoint] = readFileSync(portFile, "utf8").split("\n");
      if (
        /^\d+$/.test(port ?? "") &&
        Number(port) > 0 &&
        Number(port) <= 65535 &&
        endpoint?.startsWith("/devtools/browser/")
      )
        return port;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  const reason =
    child.exitCode === null
      ? "did not expose its debugging endpoint within 20 seconds"
      : `exited during startup (${child.exitCode})`;
  const stderr = existsSync(errorOutput)
    ? readFileSync(errorOutput, "utf8")
    : "";
  throw new Error(`Chrome ${reason}\n${stderr}`);
}
