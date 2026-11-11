import { useSyncExternalStore } from "react";
import { ConfirmDialog } from "../components/ModalDialogs";
import { coreKillDescendantsText, type CoreKillPlan } from "./coreControl";
import "./CoreKillConfirm.css";

/**
 * The confirmation of a herdr-core kill (M7): core ends a program's
 * children with it, so before World ends anything (an agent in the bin, a
 * room) the person sees every terminal that will end too. The service then
 * ends nothing beyond what was shown, and refuses if more would end.
 */
type Request = {
  title: string;
  message: string;
  confirmLabel: string;
  plan: CoreKillPlan;
  /** Name the terminals asked for too (a room close), not only the rest. */
  listRoots?: boolean;
  resolve(confirmed: boolean): void;
};

let pending: Request | null = null;
const listeners = new Set<() => void>();
const publish = () => {
  for (const listener of listeners) listener();
};

/** Shows the plan and resolves with the person's answer. */
export function confirmCoreKill(
  request: Omit<Request, "resolve">,
): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { ...request, resolve };
    publish();
  });
}

function settle(confirmed: boolean) {
  const request = pending;
  pending = null;
  publish();
  request?.resolve(confirmed);
}

/** The terminals beyond the ones asked for, or none. */
export function CoreKillList({
  plan,
  listRoots = false,
}: {
  plan: CoreKillPlan;
  listRoots?: boolean;
}) {
  const entries = listRoots
    ? [...plan.roots, ...plan.descendants]
    : plan.descendants;
  const lines = coreKillDescendantsText({ ...plan, descendants: entries });
  if (!lines.length) return null;
  return (
    <div className="core-kill-list">
      {listRoots ? null : <p className="modal-body-text">These end with it:</p>}
      <ul>
        {lines.map((line, index) => (
          <li
            key={`${entries[index]!.remote ? "remote:" : ""}${entries[index]!.address}`}
          >
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CoreKillConfirmHost() {
  const request = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
  );
  // ConfirmDialog calls onConfirm then onClose: the first answer wins.
  return (
    <ConfirmDialog
      open={request !== null}
      title={request?.title ?? ""}
      message={request?.message ?? ""}
      confirmLabel={request?.confirmLabel}
      danger
      details={
        request ? (
          <CoreKillList plan={request.plan} listRoots={request.listRoots} />
        ) : null
      }
      onConfirm={() => settle(true)}
      onClose={() => settle(false)}
    />
  );
}
