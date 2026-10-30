import type { AgentProfile } from "../../../shared/agentProfile";
import {
  ProfileStore,
  type ProfileAssignment,
  type TerminalKey,
} from "./profile-store";
import {
  masterWinner,
  profileTokens,
  readTerminalSettings,
  writeTerminalTokens,
  type MasterClaim,
  type PaneRow,
  type SettingsLease,
} from "./terminal-tokens";

type Host = { generation: number; panes: PaneRow[] };
export type TerminalTarget = TerminalKey & {
  connection_generation: number;
  pane_id: string;
};
const same = (a: TerminalKey, b: TerminalKey) =>
  a.connection_id === b.connection_id && a.terminal_id === b.terminal_id;

/** Herdr owns terminal state; only the import ledger and HLC watermark are durable. */
export class TerminalSettings {
  private hosts = new Map<string, Host>();
  private pending = Promise.resolve();
  private revision = 0;

  constructor(
    private readonly store: ProfileStore,
    private readonly leaseFor: (id: string) => SettingsLease | null,
    private readonly changed: (revision: number) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    this.pending = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private claims(): MasterClaim[] {
    const claims: MasterClaim[] = [];
    for (const [connection_id, host] of this.hosts)
      for (const pane of host.panes) {
        const { master } = readTerminalSettings(pane);
        if (master !== undefined)
          claims.push({
            connection_id,
            terminal_id: String(pane.terminal_id),
            revision: master,
          });
      }
    return claims;
  }

  get() {
    const assignments: ProfileAssignment[] = [];
    for (const [connection_id, host] of this.hosts)
      for (const pane of host.panes) {
        const settings = readTerminalSettings(pane);
        if (settings.profile_id)
          assignments.push({
            connection_id,
            terminal_id: String(pane.terminal_id),
            profile_id: settings.profile_id,
            profile_name: settings.profile_name,
          });
      }
    const winner = masterWinner(this.claims());
    const document = this.store.get();
    return {
      ...document,
      revision: document.revision + this.revision,
      assignments,
      town_master: winner
        ? {
            connection_id: winner.connection_id,
            terminal_id: winner.terminal_id,
          }
        : null,
    };
  }

  async settled() {
    await this.pending;
    return this.get();
  }

  private publish() {
    this.revision += 1;
    this.changed(this.get().revision);
  }

  private lease(id: string, generation: number) {
    const lease = this.leaseFor(id);
    if (!lease || lease.generation !== generation || !lease.isCurrent())
      throw new Error("terminal settings runtime is unavailable");
    return lease;
  }

  private async write(
    target: TerminalTarget,
    tokens: Parameters<typeof writeTerminalTokens>[3],
    expectedMaster?: number,
  ) {
    const pane = await writeTerminalTokens(
      this.lease(target.connection_id, target.connection_generation),
      target.pane_id,
      target.terminal_id,
      tokens,
      expectedMaster,
    );
    if (!pane) return;
    let host = this.hosts.get(target.connection_id);
    if (!host || host.generation !== target.connection_generation) {
      host = { generation: target.connection_generation, panes: [] };
      this.hosts.set(target.connection_id, host);
    }
    host.panes = [
      ...host.panes.filter(
        (p) =>
          p.terminal_id !== target.terminal_id && p.pane_id !== target.pane_id,
      ),
      pane,
    ];
  }

  private nextRevision() {
    const revision = Math.max(
      this.now(),
      this.store.settingsState().highest_master_revision + 1,
    );
    this.store.rememberMaster(revision);
    return revision;
  }

  /** Called only with a complete, clean pane list on the still-current lease. */
  observe(connectionId: string, generation: number, panes: readonly PaneRow[]) {
    return this.serial(async () => {
      this.lease(connectionId, generation);
      const before = JSON.stringify(this.get());
      this.hosts.set(connectionId, {
        generation,
        panes: structuredClone([...panes]),
      });
      if (
        !this.store.settingsState().imported_connections.includes(connectionId)
      )
        this.store.backupLegacySettings();
      for (const claim of this.claims())
        this.store.rememberMaster(claim.revision);
      try {
        await this.importLegacy(connectionId, generation);
        await this.clearSuperseded();
      } finally {
        if (JSON.stringify(this.get()) !== before) this.publish();
      }
    });
  }

  private async importLegacy(connectionId: string, generation: number) {
    if (this.store.settingsState().imported_connections.includes(connectionId))
      return;
    const legacy = this.store.get();
    const host = this.hosts.get(connectionId)!;
    for (const pane of [...host.panes]) {
      const terminalId = String(pane.terminal_id ?? "");
      const target = {
        connection_id: connectionId,
        connection_generation: generation,
        terminal_id: terminalId,
        pane_id: String(pane.pane_id),
      };
      const assignment = legacy.assignments.find((a) => same(a, target));
      const settings = readTerminalSettings(pane);
      const tokens: Parameters<typeof writeTerminalTokens>[3] = {};
      if (assignment && !settings.profile_id) {
        const profile = this.store.profile(assignment.profile_id);
        if (profile)
          Object.assign(
            tokens,
            profileTokens(terminalId, profile.id, profile.name),
          );
      }
      if (
        legacy.town_master &&
        same(legacy.town_master, target) &&
        !settings.master &&
        this.claims().length === 0
      )
        Object.assign(tokens, {
          world_terminal: terminalId,
          world_master: String(this.nextRevision()),
        });
      if (Object.keys(tokens).length) await this.write(target, tokens);
    }
    this.lease(connectionId, generation);
    this.store.finishSettingsImport(connectionId);
  }

  private async clearSuperseded() {
    const claims = this.claims();
    const winner = masterWinner(claims);
    if (!winner) return;
    for (const claim of claims) {
      if (
        claim.terminal_id === winner.terminal_id &&
        claim.revision === winner.revision
      )
        continue;
      const host = this.hosts.get(claim.connection_id)!;
      const lease = this.leaseFor(claim.connection_id);
      if (!lease || lease.generation !== host.generation || !lease.isCurrent())
        continue;
      // Another client may have moved the terminal since our observation.
      const listed = (await lease.runtime.herdr.call(
        "pane.list",
        {},
        10_000,
      )) as { panes?: PaneRow[] };
      if (!lease.isCurrent() || !Array.isArray(listed.panes))
        throw new Error("terminal settings cleanup observation is unavailable");
      const pane = listed.panes.find(
        (p) => p.terminal_id === claim.terminal_id,
      );
      if (!pane) {
        host.panes = host.panes.filter(
          (p) => p.terminal_id !== claim.terminal_id,
        );
        continue;
      }
      await this.write(
        {
          ...claim,
          pane_id: String(pane.pane_id),
          connection_generation: host.generation,
        },
        { world_master: null },
        claim.revision,
      );
    }
  }

  assign(target: TerminalTarget, profile: AgentProfile) {
    return this.serial(async () => {
      await this.write(
        target,
        profileTokens(target.terminal_id, profile.id, profile.name),
      );
      this.publish();
      return this.get();
    });
  }

  setMaster(params: Record<string, unknown>) {
    return this.serial(async () => {
      const value = params.terminal;
      const current = masterWinner(this.claims());
      if (value === null) {
        const claims = this.claims();
        // Do not report "none" while an unreachable claim could reappear.
        for (const claim of claims)
          this.lease(
            claim.connection_id,
            this.hosts.get(claim.connection_id)!.generation,
          );
        for (const claim of claims) {
          const host = this.hosts.get(claim.connection_id)!;
          const pane = host.panes.find(
            (p) => p.terminal_id === claim.terminal_id,
          )!;
          await this.write(
            {
              ...claim,
              pane_id: String(pane.pane_id),
              connection_generation: host.generation,
            },
            { world_master: null },
            claim.revision,
          );
        }
      } else {
        const target = value as TerminalTarget | undefined;
        if (
          !target ||
          typeof target.connection_id !== "string" ||
          typeof target.terminal_id !== "string" ||
          typeof target.pane_id !== "string" ||
          !Number.isSafeInteger(target.connection_generation)
        )
          throw new Error("Town master requires a qualified terminal");
        if (current && !same(current, target) && params.replace !== true)
          throw new Error("another agent is the Town master");
        await this.write(target, {
          world_terminal: target.terminal_id,
          world_master: String(this.nextRevision()),
        });
      }
      // Clearing an unreachable superseded claim waits for its next observation.
      await this.clearSuperseded();
      this.publish();
      return this.get();
    });
  }
}
