import { coreKeysParams, coreSendParams } from "./delivery-params";
import type { ReadyRuntimeLease } from "../connections/manager";
import {
  CoreRpcError,
  CoreUnsupportedError,
  CoreWriteUncertainError,
  type CoreWriteMethod,
  type CoreTerminalRecord,
} from "./client";
import { CoreFenceError, CoreOperationFence } from "./fence";
import type { CoreMirrorTerminal } from "./mirror";
import { CORE_RECIPIENT, coreRecipientChange, foregroundOf } from "./recipient";
import type { CoreConnectionRuntime } from "./runtime";
import { coreHarness } from "./topology";

export { coreRecipientChange, coreRecipientToken } from "./recipient";

/**
 * Session input to agents on herdr-core (M4, M5, design §8): Chat messages,
 * answers to an agent's question and answer keys, all through core's own
 * `terminal.send` and `terminal.keys`, for every harness alike. World adds
 * no harness side channel and leaves core's input scheduling to core.
 *
 * What World adds is the recipient: a message goes only to the program the
 * person addressed. The browser (or a durable ask) holds a recipient token
 * for the occupant it saw; World compares it with its observation right
 * before dispatch, watches it while core holds the send for a person's
 * draft or quiet, and asks core to drop the send the moment the occupant
 * changes. Core types a held send into whatever then occupies the terminal
 * (a kept replacement shell included): the window between that change and
 * World observing it is core's to close (upstream Q3).
 */

type Lease = ReadyRuntimeLease<CoreConnectionRuntime>;

export type CoreDeliveryInput =
  /** A new message: core refuses it while the program is blocked. */
  | { kind: "message"; text: string }
  /** A typed answer to the question the program is blocked on. */
  | { kind: "answer"; text: string }
  /** Answer keys (a menu option, y/n, enter) for a blocked program. */
  | { kind: "keys"; keys: string[] };

export type CoreDeliveryRefusal =
  | "changed"
  | "ended"
  | "waiting"
  | "not-waiting"
  | "unavailable"
  | "unsupported"
  | "invalid";

export type CoreDeliveryOutcome =
  | {
      status: "sent";
      /** The program's turn when the input went in. */
      turn: number;
      /**
       * Went `working` soon after (core's own check); null when it reports
       * no status. Observed activity, not proof of who received it.
       */
      started: boolean | null;
    }
  | { status: "refused"; reason: CoreDeliveryRefusal; message: string }
  | { status: "uncertain"; message: string };

const refused = (
  reason: CoreDeliveryRefusal,
  message: string,
): CoreDeliveryOutcome => ({ status: "refused", reason, message });

function programName(record: CoreMirrorTerminal | undefined): string {
  const foreground = record ? foregroundOf(record) : null;
  if (foreground) return foreground[1];
  const program = Array.isArray(record?.argv) ? record.argv[0] : undefined;
  return typeof program === "string"
    ? (program.split("/").pop() ?? program)
    : "another program";
}

function changedMessage(
  change: "ended" | "changed",
  record: CoreMirrorTerminal | undefined,
  nothing: string,
): string {
  if (change === "ended") return `It has ended. ${nothing}`;
  if (record && typeof record.pid !== "number")
    return `Its program was lost and herdr-core is putting a shell there. ${nothing}`;
  return `It is no longer the agent you saw: ${programName(record)} runs there now. ${nothing}`;
}

function statusWord(record: CoreTerminalRecord | undefined): string | null {
  const status = record?.status as { state?: unknown } | null | undefined;
  return typeof status?.state === "string" ? status.state : null;
}

export type CoreDeliveryOptions = {
  /** Core's whole send window; a later reply is uncertain. */
  timeoutMs?: number;
  /** Durable asks mark the possible write after all native preparation. */
  beforeSubmit?(): Promise<boolean>;
  guard?(): boolean;
};

/**
 * Delivers `input` to the program `recipient` names at `address`, under
 * `lease` only (never another connection or profile of the same core).
 *
 * Nothing is dispatched unless World's observation still shows that
 * program, with the same foreground, on the original lease; an answer also
 * needs the program still blocked. While core holds a send, a change of
 * occupant cancels it (`$/cancelRequest`): core answers `cancelled` and
 * types nothing, unless it had already typed it. A reply that never comes,
 * or one that arrives after the occupant changed, is uncertain and is
 * never sent again.
 */
export async function deliverCore(
  lease: Lease,
  address: string,
  recipient: string,
  input: CoreDeliveryInput,
  options: CoreDeliveryOptions = {},
): Promise<CoreDeliveryOutcome> {
  const method: CoreWriteMethod =
    input.kind === "keys" ? "terminal.keys" : "terminal.send";
  if (!CORE_RECIPIENT.test(recipient))
    return refused("invalid", "World does not know which agent this is for.");
  try {
    if (input.kind === "keys") coreKeysParams(address, input.keys);
    else coreSendParams(address, input.text, false);
  } catch (error) {
    const why = (error as Error).message;
    return refused(
      "invalid",
      `${why.charAt(0).toUpperCase()}${why.slice(1)}. Nothing was sent.`,
    );
  }
  if (!lease.runtime.offers(method))
    return refused(
      "unsupported",
      `This host's herdr-core does not offer ${method}. Nothing was sent.`,
    );
  let fence: CoreOperationFence<CoreConnectionRuntime>;
  try {
    fence = CoreOperationFence.admit(lease, address);
  } catch (error) {
    if (error instanceof CoreFenceError && error.reason === "occupant-gone")
      return refused("ended", "It has ended. Nothing was sent.");
    if (error instanceof CoreFenceError)
      return refused(
        "unavailable",
        "The host's herdr-core is not connected right now. Nothing was sent.",
      );
    throw error;
  }
  const view = lease.runtime.core;
  const coreId = view.epoch!.coreId;
  const nothing = "Nothing was sent.";
  let record: CoreTerminalRecord;
  try {
    record = await lease.runtime.inspect(fence);
  } catch {
    return refused(
      "unavailable",
      "World could not verify the current program. Nothing was sent.",
    );
  }
  const change = coreRecipientChange(
    recipient,
    coreId,
    record,
    view.occupancy(address),
  );
  if (!foregroundOf(record) || recipient.endsWith(".-"))
    return refused(
      "changed",
      "World cannot verify this agent's foreground. Reopen Chat after it is available. Nothing was sent.",
    );
  if (change)
    return refused(
      change,
      changedMessage(change, { ...record, remote: false }, nothing),
    );
  if (!coreHarness({ ...record, remote: false }))
    return refused(
      "unsupported",
      "This terminal is a shell, not an agent. Nothing was sent.",
    );
  const answering = input.kind !== "message";
  if (answering && statusWord(record) !== "blocked")
    return refused(
      "not-waiting",
      `It is no longer waiting on a question. ${nothing}`,
    );
  if (options.beforeSubmit && !(await options.beforeSubmit()))
    return refused(
      "unavailable",
      "The saved answer no longer needs delivery. Nothing was sent.",
    );
  if (options.guard && !options.guard())
    return refused(
      "unavailable",
      "The original answer authority changed. Nothing was sent.",
    );
  // While core holds the send, World watches the program it is for.
  const cancel = new AbortController();
  let cancelledFor: "ended" | "changed" | "lease" | null = null;
  const stopWatching = lease.runtime.watch(() => {
    if (cancel.signal.aborted) return;
    if (!lease.isCurrent() || !lease.runtime.core.actionable)
      cancelledFor = "lease";
    else
      cancelledFor = coreRecipientChange(
        recipient,
        coreId,
        lease.runtime.core.terminal(address),
        view.occupancy(address),
      );
    if (cancelledFor) cancel.abort();
  });
  try {
    const reply =
      input.kind === "keys"
        ? await lease.runtime.keys(fence, input.keys)
        : await lease.runtime.send(
            fence,
            { text: input.text, force: input.kind === "answer" },
            { cancel: cancel.signal, timeoutMs: options.timeoutMs },
          );
    // Core typed it. Say "sent" only while the same program is there.
    const now = lease.runtime.core.terminal(address);
    let after: string | null = null;
    try {
      fence.check("publication");
    } catch {
      after = "lost";
    }
    after ??= coreRecipientChange(
      recipient,
      coreId,
      now,
      view.occupancy(address),
    );
    if (after)
      return {
        status: "uncertain",
        message:
          "It changed while herdr-core was delivering: the input may have reached what replaced it. World will not send it again.",
      };
    return {
      status: "sent",
      turn: reply.turn,
      started:
        "started" in reply && typeof reply.started === "boolean"
          ? reply.started
          : null,
    };
  } catch (error) {
    if (error instanceof CoreFenceError)
      return error.reason === "occupant-gone"
        ? refused("ended", `It has ended. ${nothing}`)
        : error.reason === "occupant-replaced" ||
            error.reason === "foreground-changed"
          ? refused(
              "changed",
              changedMessage(
                "changed",
                lease.runtime.core.terminal(address),
                nothing,
              ),
            )
          : refused(
              "unavailable",
              `The host's herdr-core changed before World could send. ${nothing}`,
            );
    if (error instanceof CoreWriteUncertainError)
      return {
        status: "uncertain",
        message:
          "The reply from herdr-core was lost: the input may have gone in. World will not send it again.",
      };
    if (error instanceof CoreUnsupportedError)
      return refused("unsupported", `${error.message}. ${nothing}`);
    if (error instanceof CoreRpcError) {
      // Core's refusal: it typed nothing.
      const typed = "Nothing was typed.";
      switch (error.kind) {
        case "cancelled":
          return cancelledFor === "lease"
            ? refused(
                "unavailable",
                `The host's herdr-core disconnected while it held the input. ${typed}`,
              )
            : refused(
                cancelledFor ?? "changed",
                changedMessage(
                  cancelledFor ?? "changed",
                  lease.runtime.core.terminal(address),
                  `World cancelled the input while herdr-core held it. ${typed}`,
                ),
              );
        case "blocked":
          return refused(
            "waiting",
            `It is waiting on a question now: answer that first. ${typed}`,
          );
        case "finished":
        case "not_found":
          return refused("ended", `It has ended. ${typed}`);
        case "invalid_params":
          return refused("invalid", `herdr-core refused it: ${error.message}`);
        default:
          return {
            status: "uncertain",
            message: `herdr-core could not confirm delivery: ${error.message}. World will not send it again.`,
          };
      }
    }
    throw error;
  } finally {
    stopWatching();
  }
}
