import type { AgentWorktreeTarget } from "../../shared/agentWorktree";

export interface ConnectionClient {
  readonly agentWorktree?: AgentWorktreeTarget | null;
  readonly connectionId: string;
  readonly generation: number;
  readonly serverRuntimeGeneration: number | null;
  call(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number | null,
    options?: { focusedObservation?: boolean },
  ): Promise<any>;
  isCurrent(): boolean;
  acceptsServerGeneration(value: unknown): boolean;
}
