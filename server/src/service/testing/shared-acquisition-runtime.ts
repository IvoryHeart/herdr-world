import type { ServerWebSocket } from "bun";
import type { LegacyConnectionRuntime } from "../../connections/runtime";
import type { HerdrRuntimeOptions, Scheduler } from "../ports";
import { hostFixture } from "../../../../web/src/store/testing/syntheticHosts";
import type { Pane } from "../../../../web/src/types";
import { deskSessionFingerprint } from "../../world/desk-observation";

/** The composition root uses this clock; only the test advances acquisition. */
export class AcquisitionClock implements Scheduler {
  now = 0;
  readonly jobs = new Set<{ at: number; callback: () => void }>();
  schedule(callback: () => void, ms: number) {
    const job = { at: this.now + ms, callback };
    this.jobs.add(job);
    return { cancel: () => this.jobs.delete(job) };
  }
  async advance(ms: number) {
    this.now += ms;
    const due = [...this.jobs].filter((job) => job.at <= this.now);
    await Promise.all(
      due.map(async (job) => {
        if (this.jobs.delete(job)) await job.callback();
      }),
    );
  }
}

/** Synthetic external runtimes only; the World observer/dispatcher remain real. */
export class AcquisitionHost {
  readonly model;
  readonly calls: string[] = [];
  stats = 0;
  screens = 0;
  screenText = "synthetic shared screen";
  turns = 0;
  readonly instances: HerdrRuntimeOptions[] = [];
  failNext = new Set<string>();
  pending?: { method: string; arrived(): void; promise: Promise<void> };
  constructor(readonly id: string) {
    this.model = hostFixture(id, 1);
    for (const pane of this.model.panes)
      if (pane.agent)
        pane.agent_session = Object.assign(pane.agent_session!, {
          source: "reported",
          kind: "id",
          agent: pane.agent,
        });
  }
  pane(name: string): Pane {
    return this.model.panes.find(
      (pane) => pane.pane_id === `p-${this.id}-${name}`,
    )!;
  }
  emit(event: string, data: Record<string, unknown>) {
    const options = this.instances[this.instances.length - 1]!;
    options.onEvent({ event, data }, options.identity!);
  }
  frame(control: unknown) {
    this.instances[this.instances.length - 1]!.broadcast!(
      JSON.stringify({ control }),
      "synthetic-control",
    );
  }
  runtime(options: HerdrRuntimeOptions): LegacyConnectionRuntime {
    this.instances.push(options);
    const call = async (
      method: string,
      params: Record<string, unknown> = {},
    ) => {
      this.calls.push(method);
      if (this.failNext.delete(method))
        throw new Error("synthetic transient read failure");
      const pending = this.pending;
      if (pending?.method === method) {
        this.pending = undefined;
        pending.arrived();
        await pending.promise;
      }
      if (method === "workspace.list")
        return { workspaces: structuredClone(this.model.workspaces) };
      if (method === "tab.list")
        return { tabs: structuredClone(this.model.tabs) };
      if (method === "pane.list")
        return { panes: structuredClone(this.model.panes) };
      if (method === "agent.list")
        return {
          agents: structuredClone(
            this.model.panes.filter((pane) => pane.agent),
          ),
        };
      if (method === "pane.layout") {
        const pane = this.model.panes.find(
          (pane) => pane.pane_id === params.pane_id,
        );
        if (!pane) throw new Error("synthetic pane not found");
        return { layout: structuredClone(this.model.layouts.get(pane.tab_id)) };
      }
      if (method === "pane.get")
        return {
          pane: structuredClone(
            this.model.panes.find((pane) => pane.pane_id === params.pane_id),
          ),
        };
      if (method === "pane.read") {
        this.screens++;
        return { text: this.screenText };
      }
      throw new Error(`Unexpected synthetic Herdr method: ${method}`);
    };
    const reply = (socket: ServerWebSocket<unknown>, id: string | null) =>
      options.safeSend(
        socket,
        JSON.stringify({
          id,
          connection_id: this.id,
          connection_generation: options.connectionGeneration,
          result: {},
        }),
      );
    return {
      identity: options.identity,
      async startTransport() {},
      startBackground() {},
      async stop() {},
      sshHost: () => undefined,
      herdr: { call, ping: async () => ({ version: "0.9.3", protocol: 14 }) },
      handleSettingsRpc: reply,
      terminalBridge: {
        handleTerminalRpc: reply,
        navigationMode: async () => "shared",
        tabMoveSupported: async () => true,
        endpointAvailability: () =>
          structuredClone(this.model.endpointAvailability),
        statusTerminals: () => [],
        viewedTerminals: () => [],
        cleanupWs() {},
        browserClientCountChanged() {},
      },
      worktreeParents: { enrichWorkspaceList: async (value: unknown) => value },
      status: {
        enrichWorkspacesWithGitStatus: async (value: unknown) => value,
      },
      agentSessions: {
        enrichActivity: async (raw: { agents: Pane[] }) => {
          this.stats++;
          return {
            ...raw,
            agents: raw.agents.map((pane) => ({
              ...pane,
              last_activity_at: this.model.activity.get(pane.pane_id),
            })),
          };
        },
        readTurn: async (params: { pane_id: string }) => {
          this.turns++;
          const pane = this.model.panes.find(
            (pane) => pane.pane_id === params.pane_id,
          )!;
          return {
            turn: { turn_id: "synthetic-turn", summary: "Shared receipt" },
            agent_session_fingerprint: deskSessionFingerprint(
              pane.agent_session,
            ),
          };
        },
      },
    } as unknown as LegacyConnectionRuntime;
  }
}
