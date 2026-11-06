import {
  useAnswerConnectionCount,
  type WorldAnswerDeliveriesStore,
} from "../worldAnswerDeliveries";
import { useOpenAnswerOutbox } from "./answerOutbox";
import "./answerDeliveries.css";
/** Only this small label subscribes; delivery changes do not invalidate the Town scene. */
export function AnswerDeliverySign({
  connectionId,
  store,
}: {
  connectionId: string;
  store?: WorldAnswerDeliveriesStore;
}) {
  const count = useAnswerConnectionCount(connectionId, store),
    open = useOpenAnswerOutbox();
  return count ? (
    <button
      type="button"
      className="town-reception-letter"
      aria-label={`${count} saved answer deliveries at this host. Open Outbox.`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        open();
      }}
    >
      ✉{count}
    </button>
  ) : null;
}
