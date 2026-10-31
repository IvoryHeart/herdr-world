import { useEffect, useRef, useState } from "react";
import { askerName } from "../worldAsks";
import {
  sharedAnswerDeliveries,
  useAnswerDeliveries,
  type AnswerNotice,
  type AnswerNotices,
  type WorldAnswerDeliveriesStore,
} from "../worldAnswerDeliveries";
import type { AnswerRecipientView } from "./answerOutbox";
import type { TownAsker } from "./townAskers";
import "./answerDeliveries.css";
export type AnswerDeliveryActions = Pick<
  WorldAnswerDeliveriesStore,
  "decide" | "refresh" | "older"
>;
export const answerDeliveryLabel = (state: AnswerNotice["delivery"]["state"]) =>
  ({
    pending: "Waiting to send",
    claimed: "Sending…",
    dispatching: "Sending…",
    uncertain: "Unconfirmed",
    refused: "Not sent",
    delivered: "Sent",
    cancelled: "Dismissed",
  })[state];
/** Full saved-answer cards live in Summary; the rail is only a route here. */
export function AnswerDeliveries({
  state,
  actions,
  focusKey = 0,
  recipient,
  open,
}: {
  state: AnswerNotices;
  actions: AnswerDeliveryActions;
  focusKey?: number;
  recipient?(notice: AnswerNotice): AnswerRecipientView;
  open?(target: TownAsker): void;
}) {
  const heading = useRef<HTMLHeadingElement>(null),
    region = useRef<HTMLElement>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (focusKey) {
      heading.current?.focus();
      heading.current?.scrollIntoView({ block: "start" });
    }
  }, [focusKey]);
  useEffect(() => {
    const sent = state.entries.find(
      (entry) => entry.delivery.state === "delivered",
    );
    if (sent)
      setStatus(
        sent.delivery.received_at !== undefined
          ? `Answer received by ${askerName(sent.ask)} through the CLI.`
          : `Sent to ${askerName(sent.ask)}.`,
      );
  }, [state.entries]);
  const decide: AnswerDeliveryActions["decide"] = async (notice, action) => {
    const index = state.entries.findIndex(
      (entry) => entry.ask.id === notice.ask.id,
    );
    const error = await actions.decide(notice, action);
    setStatus(
      error ??
        (action === "resend"
          ? "Send requested. World checks the original session first."
          : "Dismissed. Your answer stays saved."),
    );
    if (!error)
      requestAnimationFrame(() => {
        const cards =
          region.current?.querySelectorAll<HTMLElement>(".answer-delivery");
        (
          cards?.[Math.min(index, cards.length - 1)] ?? heading.current
        )?.focus();
      });
    return error;
  };
  return (
    <section ref={region} className="answer-deliveries" aria-label="Outbox">
      <h3 ref={heading} tabIndex={-1}>
        Outbox{" "}
        <span>
          {(state.counts?.checks ?? 0) +
            (state.counts?.waiting ?? state.entries.length)}
        </span>
      </h3>
      <p className="answer-deliveries-help">
        Your answers that World hasn't confirmed yet. Each stays saved.
      </p>
      <p className="answer-delivery-live" role="status" aria-live="polite">
        {status}
      </p>
      {state.error ? (
        <p role="alert">
          {state.error}{" "}
          <button type="button" onClick={() => void actions.refresh()}>
            Refresh
          </button>
        </p>
      ) : null}
      <div className="answer-deliveries-list" aria-busy={state.loading}>
        {state.entries.map((notice) => (
          <AnswerDeliveryCard
            key={`${notice.ask.id}:${notice.ask.answer?.occurrence}`}
            notice={notice}
            decide={decide}
            recipient={recipient?.(notice)}
            open={open}
          />
        ))}
        {!state.entries.length && !state.error && !state.loading ? (
          <p className="answer-deliveries-help">No answers waiting here.</p>
        ) : null}
      </div>
      {state.next || state.older ? (
        <div className="answer-delivery-actions">
          {state.older ? (
            <button
              type="button"
              disabled={state.loading}
              onClick={() => void actions.refresh()}
            >
              Newest
            </button>
          ) : null}
          {state.next ? (
            <button
              type="button"
              disabled={state.loading}
              onClick={() => void actions.older()}
            >
              Older
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
export function AnswerDeliveryCard({
  notice,
  decide,
  recipient,
  open,
}: {
  notice: AnswerNotice;
  decide: AnswerDeliveryActions["decide"];
  recipient?: AnswerRecipientView;
  open?(target: TownAsker): void;
}) {
  const { ask, delivery } = notice,
    name = recipient?.name ?? askerName(ask);
  const [confirm, setConfirm] = useState<AnswerNotice | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const card = useRef<HTMLElement>(null),
    sendButton = useRef<HTMLButtonElement>(null),
    confirmation = useRef<HTMLButtonElement>(null);
  const active = ["claimed", "dispatching"].includes(delivery.state),
    finished = ["delivered", "cancelled"].includes(delivery.state);
  useEffect(() => {
    if (confirm) confirmation.current?.focus();
  }, [confirm]);
  useEffect(() => {
    if (
      confirm &&
      !busy &&
      (confirm.delivery.attempt !== delivery.attempt ||
        confirm.delivery.state !== delivery.state)
    ) {
      setConfirm(null);
      setError(
        "Delivery changed. Review the current result before sending again.",
      );
      requestAnimationFrame(() =>
        (sendButton.current ?? card.current)?.focus(),
      );
    }
  }, [confirm, busy, delivery.attempt, delivery.state]);
  const act = async (action: "resend" | "close") => {
    setBusy(true);
    setError(null);
    try {
      setError(
        await decide(action === "resend" && confirm ? confirm : notice, action),
      );
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const refusedMessage = /session changed|binding changed/i.test(
    delivery.reason ?? "",
  )
    ? `${name}'s session changed after it asked, so World didn't send your answer.`
    : /ended|removed/i.test(delivery.reason ?? "")
      ? `${name}'s original session is no longer available. World didn't send your answer.`
      : "World didn't send your answer. It stays saved.";
  const message = active
    ? "Wait for the result."
    : delivery.state === "uncertain"
      ? `World couldn't confirm that ${name} got your answer. It won't send it again on its own.`
      : delivery.state === "delivered"
        ? delivery.received_at !== undefined
          ? `Answer received by ${name} through the CLI.`
          : `Sent to ${name}.`
        : delivery.state === "refused"
          ? refusedMessage
          : /offline|reconnect/.test(delivery.reason ?? "")
            ? "Waiting for the original host to reconnect."
            : "Waiting for the original asking session to be ready.";

  return (
    <article
      ref={card}
      tabIndex={-1}
      className={`answer-delivery answer-delivery-${delivery.state}`}
      aria-label={`Answer delivery to ${name}`}
    >
      <div className="answer-delivery-heading">
        <b>{name}</b>
        <span>
          {delivery.received_at !== undefined
            ? "Received by CLI"
            : answerDeliveryLabel(delivery.state)}
        </span>
      </div>
      <p>{ask.question}</p>
      <p className="answer-delivery-answer">
        <span>Your answer</span> {ask.answer?.text}
      </p>
      <p className="answer-delivery-status">{message}</p>
      {delivery.prior_uncertainty && delivery.state !== "uncertain" ? (
        <p className="answer-delivery-status">
          An earlier send may also have arrived.
        </p>
      ) : null}
      <details>
        <summary>Delivery details</summary>
        <p
          title={`${ask.actor.connection_id ?? "unverified"} · ${ask.actor.pane_id ?? "unknown pane"}`}
        >
          To {name} · {recipient?.location ?? "original host"}
        </p>
        {delivery.reason ? <p>{delivery.reason}</p> : null}
        {delivery.attempts?.length ? (
          <ul>
            {delivery.attempts.map((attempt) => (
              <li key={attempt.attempt}>
                Send {attempt.attempt}:{" "}
                {answerDeliveryLabel(
                  attempt.state as AnswerNotice["delivery"]["state"],
                ) ?? attempt.state}{" "}
                — {attempt.reason}
              </li>
            ))}
          </ul>
        ) : null}
        <p>
          The answer remains readable with{" "}
          <code>herdr-world ask get {ask.id}</code>.
        </p>
        <p>Submission to Herdr does not prove the agent read or acted on it.</p>
      </details>
      {confirm ? (
        <div
          className="answer-delivery-confirm"
          role="group"
          aria-label="Confirm possible duplicate"
        >
          <p>
            Send your answer to {name} again? If the first one arrived, {name}{" "}
            sees it twice. World checks it's still the same session first.
          </p>
          <div className="answer-delivery-actions">
            <button
              ref={confirmation}
              type="button"
              disabled={busy}
              onClick={() => void act("resend")}
            >
              Send again
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirm(null);
                requestAnimationFrame(() =>
                  (sendButton.current ?? card.current)?.focus(),
                );
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : !active && !finished ? (
        <div className="answer-delivery-actions">
          {delivery.state === "uncertain" && notice.can_resend ? (
            <button
              ref={sendButton}
              type="button"
              disabled={busy}
              onClick={() => setConfirm(notice)}
            >
              Send again…
            </button>
          ) : null}
          {delivery.state === "refused" && recipient?.target && open ? (
            <button type="button" onClick={() => open(recipient.target!)}>
              Open {recipient.target.terminal ? "terminal" : "agent"}
            </button>
          ) : null}
          <button
            type="button"
            aria-label={`Dismiss the delivery to ${name}; your answer stays saved`}
            disabled={busy}
            onClick={() => void act("close")}
          >
            {delivery.state === "pending" ? "Cancel send" : "Dismiss"}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </article>
  );
}
export function ConnectedAnswerDeliveries(
  props: Omit<Parameters<typeof AnswerDeliveries>[0], "state" | "actions">,
) {
  const store = sharedAnswerDeliveries();
  return (
    <AnswerDeliveries
      {...props}
      state={useAnswerDeliveries(store)}
      actions={store}
    />
  );
}
