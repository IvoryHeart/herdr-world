import { useState } from "react";
import { freshPullRequestDetail } from "../../../shared/pullRequestFreshness";
import type { WorkItem } from "../../../shared/worldSources";
import { worldSourcesStore } from "./worldSources";

/** GitHub list health never stands in for the time the detail was read. */
export function PullRequestDetailHealth({ item }: { item: WorkItem }) {
  const [refreshing, setRefreshing] = useState(false);
  const current = freshPullRequestDetail(item);
  const observation = item.prObservation;
  const readAt = observation?.readAt;
  return (
    <p
      className="pr-card-facts"
      data-detail-state={current ? "fresh" : item.pr ? "stale" : "unavailable"}
    >
      GitHub details{" "}
      {current ? "fresh" : item.pr ? "stale · cached evidence" : "unavailable"}
      {readAt !== undefined && readAt !== null ? (
        <>
          {" · read "}
          <time dateTime={new Date(readAt).toISOString()}>
            {new Date(readAt).toLocaleString()}
          </time>
        </>
      ) : (
        " · Read time unknown"
      )}
      {!current ? (
        <>
          {" "}
          <button
            type="button"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                await worldSourcesStore.refresh(true);
              } finally {
                setRefreshing(false);
              }
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh Sources"}
          </button>
        </>
      ) : null}
    </p>
  );
}
