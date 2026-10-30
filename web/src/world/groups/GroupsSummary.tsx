import type { GroupView } from "../../../../shared/groupViews";
import {
  groupPrText,
  groupStatusText,
  groupTitle,
  openGroups,
} from "./groupActions";
import { useGroups } from "./useGroups";
import "./groupsSummary.css";

/** Mount only inside the open Town Summary. Reception keeps its own counts. */
export function GroupsSummary() {
  const { groups, document, error } = useGroups();
  return (
    <GroupsSummaryContent
      groups={groups}
      ready={Boolean(document)}
      error={error}
    />
  );
}

export function GroupsSummaryContent({
  groups,
  ready,
  error,
  onOpen = openGroups,
}: {
  groups: readonly GroupView[];
  ready: boolean;
  error?: string | null;
  onOpen?(key?: string): void;
}) {
  const pods = groups.filter((group) => group.kind === "pod");
  return (
    <section className="groups-summary" aria-labelledby="groups-summary-title">
      <div className="groups-summary-heading">
        <h3 id="groups-summary-title">Pods</h3>
        <button type="button" onClick={() => onOpen()}>
          Groups…
        </button>
      </div>
      {error ? <p role="status">{error}</p> : null}
      {!ready ? (
        error ? null : (
          <p role="status">Loading Pods…</p>
        )
      ) : pods.length ? (
        <ul>
          {pods.map((group) => (
            <li key={group.key}>
              <button
                type="button"
                className="groups-summary-pod"
                aria-label={`Open ${groupTitle(group)} in Groups`}
                onClick={() => onOpen(group.key)}
              >
                <span
                  className="groups-summary-dot"
                  data-status={group.status}
                  aria-hidden="true"
                />
                <span className="groups-summary-body">
                  <strong>{groupTitle(group)}</strong>
                  <small>
                    {groupStatusText(group)}
                    {group.members.some(
                      (member) => member.resolution !== "present",
                    )
                      ? ` · ${group.members.filter((member) => member.resolution !== "present").length} away or ambiguous`
                      : ""}
                  </small>
                  {group.now[0] ? (
                    <span className="groups-summary-now">
                      Now: {group.now[0]}
                    </span>
                  ) : null}
                </span>
                <span
                  className={group.overLimit ? "group-over-limit" : undefined}
                >
                  {groupPrText(group)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="town-summary-empty">No Pods yet.</p>
      )}
    </section>
  );
}
