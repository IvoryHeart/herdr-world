import { planBoardPatch } from "./board-plan";
import type { CliHost } from "./world-cli-actor";
import type { WorldCliDeps } from "./world-cli";
import type { CliActor, LedgerStore } from "./world-ledger";
import type { BoardPatch } from "./board-store";
import type { GroupMoveRequest } from "./world-cli-groups";

export function guardCliHost(host: CliHost, recheck: () => void): CliHost {
  return {
    ...host,
    call(method, params, beforeSend) {
      recheck();
      return host.call(method, params, () => {
        recheck();
        beforeSend?.();
      });
    },
  };
}

/** Each request retains its own live admission through queues and async reads. */
export function guardCliCommand(
  deps: WorldCliDeps,
  recheck: () => void,
): WorldCliDeps {
  return Object.create(deps, {
    hosts: {
      value: () => deps.hosts().map((host) => guardCliHost(host, recheck)),
    },
    snapshot: {
      value: () => {
        recheck();
        return deps.snapshot();
      },
    },
    board: {
      get: () => ({
        get: () => deps.board.get(),
        patch: (ops: BoardPatch) => {
          recheck();
          return deps.board.patch(
            planBoardPatch([ops], (current) => {
              recheck();
              return typeof ops === "function" ? ops(current) : ops;
            }),
          );
        },
        patchIf: (revision: number, ops: BoardPatch) => {
          recheck();
          return deps.board.patchIf(
            revision,
            planBoardPatch([ops], (current) => {
              recheck();
              return typeof ops === "function" ? ops(current) : ops;
            }),
          );
        },
      }),
    },
    ledger: {
      get: (): LedgerStore => {
        const ledger = deps.ledger;
        return {
          nextId: (kind) => {
            recheck();
            return ledger.nextId(kind);
          },
          get: () => ledger.get(),
          ask: (id) => ledger.ask(id),
          change: (id) => ledger.change(id),
          openAsks: () => ledger.openAsks(),
          update: (change, effects) => {
            recheck();
            return ledger.update((document) => {
              recheck();
              change(document);
            }, effects);
          },
        };
      },
    },
    recordAnswer: {
      value:
        deps.recordAnswer &&
        ((id: string, text: string, actor: CliActor) => {
          recheck();
          return deps.recordAnswer!(id, text, actor, recheck);
        }),
    },
    acknowledgeAnswer: {
      value:
        deps.acknowledgeAnswer &&
        ((id: string, occurrence: string, attempt: number, actor: CliActor) => {
          recheck();
          return deps.acknowledgeAnswer!(
            id,
            occurrence,
            attempt,
            actor,
            recheck,
          );
        }),
    },
    groupMove: {
      value:
        deps.groupMove &&
        ((request: GroupMoveRequest) => {
          recheck();
          return deps.groupMove!(request, recheck);
        }),
    },
  }) as WorldCliDeps;
}
