import type { ReadyRuntimeLease } from "../connections/manager";
import type { CoreConnectionRuntime } from "./runtime";
import type { CoreTerminalRecord } from "./client";
import { deliverCore, type CoreDeliveryOutcome } from "./delivery";
import { CoreOperationFence } from "./fence";
import { coreRecipientToken, foregroundOf } from "./recipient";

/** Wait for core's foreground observation, never a guessed startup screen.
 * Core's send owns quiet/draft scheduling and checks idle before typing, so
 * foreground alone never authorizes an automatic answer to a trust dialog.
 * A replacement during startup never
 * becomes the recipient of the original profile's brief. */
export async function deliverLaunchBrief(
  lease: ReadyRuntimeLease<CoreConnectionRuntime>,
  record: CoreTerminalRecord,
  text: string,
  timeoutMs = 10_000,
): Promise<CoreDeliveryOutcome> {
  const unavailable = (): CoreDeliveryOutcome => ({
    status: "refused",
    reason: "unavailable",
    message:
      "Started, but its foreground could not be verified. Open Chat to send the brief.",
  });
  try {
    const fence = CoreOperationFence.admit(lease, record.address, null, {
      foreground: false,
    });
    const recipient = await new Promise<string | null>((resolve) => {
      let stop = () => {};
      let finished = false;
      const finish = (token: string | null) => {
        if (finished) return;
        finished = true;
        stop();
        clearTimeout(timer);
        resolve(token);
      };
      const check = () => {
        try {
          fence.check("publication");
          const now = lease.runtime.core.terminal(record.address);
          if (
            !now ||
            now.pid !== record.pid ||
            JSON.stringify(now.argv) !== JSON.stringify(record.argv)
          )
            return finish(null);
          if (foregroundOf(now))
            finish(
              coreRecipientToken(
                fence.lease.runtime.core.epoch!.coreId,
                now,
                lease.runtime.core.occupancy(record.address),
              ),
            );
        } catch {
          finish(null);
        }
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      stop = lease.runtime.watch(check);
      check();
    });
    if (!recipient) return unavailable();
    return deliverCore(
      lease,
      record.address,
      recipient,
      { kind: "message", text },
      { onlyIfIdle: true },
    ).then((delivery) =>
      delivery.status === "refused"
        ? {
            ...delivery,
            message: `Started, but the brief was not sent. ${delivery.message} Open Chat to send the brief.`,
          }
        : delivery,
    );
  } catch {
    return unavailable();
  }
}
