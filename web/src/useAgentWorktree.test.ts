import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import type {
  AgentWorktreeObservation,
  AgentWorktreeSubject,
} from "../../shared/agentWorktree";

if (process.env.WORKTREE_DOM_TEST !== "1") {
  test("worktree view rejects old-occupant replies and stale evidence in an isolated DOM", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, WORKTREE_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15000);
} else {
  test("session turnover, explicit choice and failed refresh cannot silently retarget resource reads", async () => {
    const browser = new Window({ url: "https://world.example.test" });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      HTMLElement: browser.HTMLElement,
      Element: browser.Element,
      Node: browser.Node,
      localStorage: browser.localStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    }
    const { createRoot } = await import("react-dom/client");
    const { useAgentWorktree } = await import("./useAgentWorktree");
    const { bridge } = await import("./api");
    const controls = new Set<
      (control: Parameters<Parameters<typeof bridge.onControl>[0]>[0]) => void
    >();
    const originalOnControl = bridge.onControl;
    bridge.onControl = (handler) => {
      controls.add(handler);
      return () => {
        controls.delete(handler);
      };
    };
    const pending: {
      subject: AgentWorktreeSubject;
      refresh: boolean;
      deferred: ReturnType<
        typeof Promise.withResolvers<AgentWorktreeObservation>
      >;
    }[] = [];
    const resources: Record<string, unknown>[] = [];
    const client = {
      connectionId: "alpha",
      generation: 1,
      serverRuntimeGeneration: 7,
      isCurrent: () => true,
      acceptsServerGeneration: (value: unknown) => value === 7,
      async call(method: string, params: Record<string, unknown> = {}) {
        if (method === "agent_worktree.get") {
          const deferred = Promise.withResolvers<AgentWorktreeObservation>();
          pending.push({
            subject: params.subject as AgentWorktreeSubject,
            refresh: params.refresh === true,
            deferred,
          });
          return deferred.promise;
        }
        resources.push(params);
        return {};
      },
    };
    let latest!: ReturnType<typeof useAgentWorktree>;
    function Probe({
      occupant,
      foregroundCwd,
    }: {
      occupant: string;
      foregroundCwd?: string;
    }) {
      latest = useAgentWorktree(client, {
        enabled: true,
        paneId: occupant,
        terminalId: `terminal-${occupant}`,
        sessionFingerprint: occupant.repeat(64),
        foregroundCwd,
      });
      return null;
    }
    const observation = (
      subject: AgentWorktreeSubject,
    ): AgentWorktreeObservation => ({
      subject,
      revision: `revision-${subject.paneId}`,
      observedAt: "2026-01-01T00:00:00Z",
      state: "resolved",
      selectedCandidateId: `${subject.paneId}-agent`,
      candidates: ["agent", "main"].map((name) => ({
        candidateId: `${subject.paneId}-${name}`,
        canonicalRoot: `/project/${subject.paneId}/${name}`,
        gitCommonDir: "/project/.git",
        branch: name,
        source: name === "agent" ? "foreground_cwd" : "worktree_list",
        evidence: {
          sourceRef: "Synthetic observation",
          observedAt: "2026-01-01T00:00:00Z",
          basis: name === "agent" ? "reported" : "inferred",
        },
      })),
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(createElement(Probe, { occupant: "a" })),
      );
      await act(async () =>
        root.render(createElement(Probe, { occupant: "b" })),
      );
      expect(latest.view?.target).toBeNull();
      await act(async () => {
        pending[0]!.deferred.resolve(observation(pending[0]!.subject));
        pending[1]!.deferred.resolve(observation(pending[1]!.subject));
      });
      expect(latest.view?.selected?.canonicalRoot).toBe("/project/b/agent");
      const priorChoiceClient = latest.client;
      await act(async () => latest.view!.select("b-main"));
      expect(priorChoiceClient.isCurrent()).toBe(true);
      await expect(priorChoiceClient.call("file.list")).rejects.toThrow(
        "Worktree",
      );
      await act(async () => latest.view!.select("b-agent"));
      expect(priorChoiceClient.isCurrent()).toBe(true);
      await expect(priorChoiceClient.call("file.list")).rejects.toThrow(
        "Worktree",
      );
      await act(async () => latest.view!.select("b-main"));
      await latest.client.call("file.list", { workspace_id: "workspace" });
      expect(resources[0]?.agent_worktree).toMatchObject({
        candidateId: "b-main",
        subject: { paneId: "b" },
      });
      await act(async () => {
        for (const handler of controls)
          handler({
            type: "agent_conversation_changed",
            connection_id: "alpha",
            connection_generation: 7,
            pane_id: "b",
          });
      });
      expect(pending.length).toBe(3);
      await act(async () =>
        pending[2]!.deferred.reject(new Error("Host unavailable")),
      );
      expect(latest.view?.observation?.state).toBe("stale");
      expect(latest.view?.selected?.canonicalRoot).toBe("/project/b/main");
      expect(latest.view?.target).toBeNull();
      await expect(
        latest.client.call("file.list", { workspace_id: "workspace" }),
      ).rejects.toThrow("Choose");
      expect(resources.length).toBe(1);
      await act(async () =>
        root.render(
          createElement(Probe, {
            occupant: "b",
            foregroundCwd: "/project/b/agent",
          }),
        ),
      );
      expect(pending.length).toBe(4);
      expect(pending[3]?.refresh).toBe(true);
      await act(async () =>
        pending[3]!.deferred.resolve(observation(pending[3]!.subject)),
      );
      expect(latest.view?.observation?.state).toBe("resolved");
    } finally {
      await act(async () => root.unmount());
      bridge.onControl = originalOnControl;
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      await browser.happyDOM.close();
    }
  });
}
