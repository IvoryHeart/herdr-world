import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

if (process.env.HERDR_PR_EXPIRY_DOM_TEST !== "1") {
  test("an idle mounted PR loses freshness and its open merge sheet at expiry", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HERDR_PR_EXPIRY_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  const browser = new Window({ url: "https://example.test" });
  Object.assign(globalThis, {
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { act, createElement: h } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { PullRequestCard } = await import("./PullRequestCard");
  const { PULL_REQUEST_DETAIL_MAX_AGE_MS: ttl } = await import(
    "../../../shared/pullRequestFreshness"
  );
  const { fixturePullRequest } = await import("./testing/pullRequestFixture");
  afterAll(async () => browser.happyDOM.close());

  test("expiry withdraws current presentation without a new source poll", async () => {
    const originalNow = Date.now;
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    const timers = new Map<number, { delay: number; run(): void }>();
    let nextId = 0;
    window.setTimeout = ((callback: TimerHandler, delay = 0) => {
      const id = ++nextId;
      timers.set(id, {
        delay,
        run: () => {
          if (typeof callback !== "function")
            throw new Error("Unexpected string timer");
          callback();
        },
      });
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id: number) => {
      timers.delete(id);
    }) as typeof window.clearTimeout;
    let now = 1_000_000;
    Date.now = () => now;
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const item = fixturePullRequest(7);
    item.prObservation = {
      source: "github",
      state: "fresh",
      headSha: item.headSha,
      readAt: now - ttl + 1000,
      expiresAt: now + 1000,
    };
    try {
      await act(async () => root.render(h(PullRequestCard, { item })));
      expect(
        container.querySelector('[data-detail-state="fresh"]'),
      ).not.toBeNull();
      expect(container.querySelector('[data-ready="true"]')).not.toBeNull();
      const merge = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Merge…",
      )!;
      expect(merge).toBeDefined();
      await act(async () => merge.click());
      expect(
        container.querySelector('.pr-card-sheet[data-verb="merge"]'),
      ).not.toBeNull();
      const expiry = [...timers.values()].find((timer) => timer.delay === 1000);
      expect(expiry).toBeDefined();
      await act(async () => {
        now += 1000;
        expiry!.run();
      });
      expect(
        container.querySelector('[data-detail-state="stale"]'),
      ).not.toBeNull();
      expect(container.querySelector('[data-ready="true"]')).toBeNull();
      expect(container.querySelector(".pr-card-sheet")).toBeNull();
      expect(container.textContent).toContain("Refresh Sources before merge");
      expect(container.textContent).not.toContain("Merge…");
      expect(item.prObservation.state).toBe("fresh");
      expect(item.prObservation.readAt).toBe(1_000_000 - ttl + 1000);
    } finally {
      await act(async () => root.unmount());
      expect(timers.size).toBe(0);
      container.remove();
      Date.now = originalNow;
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
    }
  });
}
