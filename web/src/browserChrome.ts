import { existsSync, readFileSync, watch } from "node:fs";
import { dirname, join } from "node:path";

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

/** @internal Shared test-browser lifecycle boundary. */
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
    // A loaded CI runner can delay reaping even after SIGKILL. Keep teardown
    // bounded while allowing the OS/native child-exit notification to arrive.
    await withBrowserDeadline(child.exited, "Chrome forced exit", 10_000);
  }
}

export async function waitForChromePort(
  child: {
    readonly exitCode: number | null;
    devtoolsPort?: string;
    exited?: Promise<number>;
  },
  profile: string,
  errorOutput: string,
): Promise<string> {
  if (child.devtoolsPort) return child.devtoolsPort;
  const portFile = join(profile, "DevToolsActivePort");
  return new Promise<string>((resolve, reject) => {
    let finished = false;
    const observer = watch(dirname(profile), { recursive: true }, () => read());
    const finish = (port?: string, error?: Error) => {
      if (finished) return;
      finished = true;
      observer.close();
      clearTimeout(deadline);
      if (error) reject(error);
      else resolve(port!);
    };
    const failed = () => {
      const reason =
        child.exitCode === null
          ? "did not expose its debugging endpoint within 20 seconds"
          : `exited during startup (${child.exitCode})`;
      const stderr = existsSync(errorOutput)
        ? readFileSync(errorOutput, "utf8")
        : "";
      finish(undefined, new Error(`Chrome ${reason}\n${stderr}`));
    };
    const deadline = setTimeout(failed, 20_000);
    const read = () => {
      if (finished) return;
      if (child.exitCode !== null) {
        failed();
        return;
      }
      try {
        if (!existsSync(portFile)) return;
        const [port, endpoint] = readFileSync(portFile, "utf8").split("\n");
        if (
          /^\d+$/.test(port ?? "") &&
          Number(port) > 0 &&
          Number(port) <= 65535 &&
          endpoint?.startsWith("/devtools/browser/")
        )
          finish(port);
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT")
          finish(undefined, error as Error);
      }
    };
    observer.on("error", (error) => finish(undefined, error));
    void child.exited?.then(failed, (error) => finish(undefined, error));
    // Watching before reading closes the check/subscribe race, including a
    // port file written before this function starts.
    read();
  });
}
