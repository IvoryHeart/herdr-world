import { useId, useState } from "react";
import { AgentMark } from "../../components/AgentMark";
import "./townReception.css";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { AGENT_MARKS } from "../agentMarks";
import {
  TOWN_RECEPTION_AGENT_MARK as MARK,
  TOWN_RECEPTION_MARKS,
  townReceptionTakes,
  withTownReceptionAll,
  withTownReceptionMarks,
  withTownReceptionReset,
  type TownReceptionFilter,
  type TownReceptionMark,
} from "./townReceptionFilter";
import {
  saveTownReceptionFilter,
  useTownReceptionFilter,
} from "./townReceptionSetting";

const word = (mark: TownReceptionMark) => AGENT_MARKS[MARK[mark]].word;

/**
 * Reception's sign: the marks it takes, the others greyed. Pressing it opens
 * the filter: one checkbox per mark, Apply to all buildings and Reset to
 * default. A change applies to this building alone unless Apply to all
 * buildings is ticked; it starts unticked each time the filter opens.
 */
export function TownReceptionSign({
  connectionId,
  hostLabel,
}: {
  connectionId: string;
  hostLabel: string;
}) {
  const filter = useTownReceptionFilter();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const takes = townReceptionTakes(filter, connectionId);
  const save = (next: TownReceptionFilter) => {
    setError(null);
    saveTownReceptionFilter(next).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  };
  const taken = TOWN_RECEPTION_MARKS.filter((mark) => takes.has(mark));
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setAll(false);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="town-reception-sign"
          aria-haspopup="dialog"
          aria-label={`${hostLabel} reception takes ${
            taken.length ? taken.map(word).join(", ") : "nobody"
          }. Filter`}
          title="Choose who waits at reception"
        >
          {TOWN_RECEPTION_MARKS.map((mark) => (
            <span
              key={mark}
              className="town-reception-sign-mark"
              data-taken={takes.has(mark)}
            >
              <AgentMark kind={MARK[mark]} />
            </span>
          ))}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="town-reception-filter"
        align="end"
        collisionPadding={8}
        aria-labelledby={`${id}-title`}
      >
        <strong id={`${id}-title`}>Reception takes</strong>
        {TOWN_RECEPTION_MARKS.map((mark) => (
          <label key={mark} className="town-reception-filter-row">
            <input
              type="checkbox"
              checked={takes.has(mark)}
              onChange={(event) => {
                const next = new Set(takes);
                if (event.currentTarget.checked) next.add(mark);
                else next.delete(mark);
                save(
                  all
                    ? withTownReceptionAll(next)
                    : withTownReceptionMarks(filter, connectionId, next),
                );
              }}
            />
            <AgentMark kind={MARK[mark]} />
            <span>{word(mark)}</span>
          </label>
        ))}
        <p className="town-reception-filter-note">
          Others stay at their desks with their mark.
        </p>
        <label className="town-reception-filter-row">
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setAll(checked);
              if (checked) save(withTownReceptionAll(takes));
            }}
          />
          <span>Apply to all buildings</span>
        </label>
        <button
          type="button"
          className="town-reception-filter-reset"
          onClick={() =>
            save(withTownReceptionReset(filter, connectionId, all))
          }
        >
          Reset to default
        </button>
        {error ? (
          <p className="town-reception-filter-error" role="alert">
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Reception's count of agents its filter keeps at their desks, by mark, with
 * find: `✓ 4 at desks · find`.
 */
export function TownReceptionHeldTag({
  counts,
  onFind,
}: {
  counts: ReadonlyMap<TownReceptionMark, number>;
  onFind: ((anchor: { x: number; y: number }) => void) | null;
}) {
  const marks = TOWN_RECEPTION_MARKS.filter((mark) => counts.get(mark));
  if (!marks.length) return null;
  const spoken = marks
    .map((mark) => `${counts.get(mark)} ${word(mark).toLowerCase()}`)
    .join(", ");
  return (
    <div className="town-reception-held" data-reception-held="true">
      <span aria-label={`${spoken} at their desks`}>
        {marks.map((mark) => (
          <span key={mark} className="town-reception-held-mark">
            <AgentMark kind={MARK[mark]} />
            {counts.get(mark)}
          </span>
        ))}{" "}
        at desks
      </span>
      {onFind ? (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="town-reception-find"
            aria-label={`Find the ${spoken} at their desks`}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              onFind({ x: box.left + box.width / 2, y: box.bottom });
            }}
          >
            find
          </button>
        </>
      ) : null}
    </div>
  );
}
