import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { yieldWorldTask } from "../worldObject";
import type { TownTarget } from "./townTargets";

const TARGET_BATCH = 16;

/** Accessible targets, admitted in batches so dense scenes keep input responsive. */
export function TownTargets({
  targets,
  selectedKey,
  onSelect,
  onActivate,
  onActivateRoom,
  onFocusTarget,
  onMoveTarget,
}: {
  targets: readonly TownTarget[];
  selectedKey: string | null;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onActivateRoom(key: string): void;
  onFocusTarget(target: TownTarget): void;
  /** Keyboard move (key M) for a focused desk or agent target. */
  onMoveTarget(kind: "desk" | "agent", key: string): void;
}) {
  const identity = useMemo(
    () => targets.map(({ kind, key }) => `${kind}:${key}`).join("|"),
    [targets],
  );
  const [progress, setProgress] = useState<{
    identity: string;
    limit: number;
  } | null>(null);
  const limit = progress?.identity === identity ? progress.limit : TARGET_BATCH;
  const admitted = useRef(new Set<string>());
  const rendered = targets.filter(
    (target, index) =>
      index < limit ||
      target.key === selectedKey ||
      admitted.current.has(`${target.kind}:${target.key}`),
  );
  useLayoutEffect(() => {
    admitted.current = new Set(
      rendered.map(({ kind, key }) => `${kind}:${key}`),
    );
  });
  const pending = targets.length - rendered.length;
  useEffect(() => {
    if (!pending) return;
    let current = true;
    void yieldWorldTask().then(() => {
      if (current) setProgress({ identity, limit: limit + TARGET_BATCH });
    });
    return () => {
      current = false;
    };
  }, [identity, limit, pending]);
  return (
    <div
      className="world-semantic-targets-overlay town-targets"
      aria-label="Office scene targets"
      aria-busy={pending > 0}
      onKeyDown={(event) => {
        // M moves the focused desk or agent; the canvas moves by drag.
        if (event.key !== "m" && event.key !== "M") return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const button = (event.target as HTMLElement).closest<HTMLElement>(
          ".world-semantic-target",
        );
        const kind = button?.dataset.kind;
        const key = button?.dataset.targetKey;
        if (!key || (kind !== "desk" && kind !== "agent")) return;
        event.preventDefault();
        onMoveTarget(kind, key);
      }}
    >
      {pending ? (
        <span className="town-visually-hidden" role="status">
          Rendering {pending} more observed targets
        </span>
      ) : null}
      {rendered.map((target) => (
        <TownTargetButton
          key={`${target.kind}:${target.key}`}
          target={target}
          selected={selectedKey === target.key}
          onSelect={onSelect}
          onActivate={onActivate}
          onActivateRoom={onActivateRoom}
          onFocusTarget={onFocusTarget}
        />
      ))}
    </div>
  );
}

const TownTargetButton = memo(function TownTargetButton({
  target,
  selected,
  onSelect,
  onActivate,
  onActivateRoom,
  onFocusTarget,
}: {
  target: TownTarget;
  selected: boolean;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onActivateRoom(key: string): void;
  onFocusTarget(target: TownTarget): void;
}) {
  return (
    <button
      className="world-semantic-target"
      type="button"
      data-kind={target.kind}
      data-target-key={target.key}
      data-color={target.color}
      aria-label={target.label}
      aria-pressed={selected}
      title={target.label}
      style={{
        left: target.rect.x,
        top: target.rect.y,
        width: target.rect.width,
        height: target.rect.height,
      }}
      onFocus={() => onFocusTarget(target)}
      onClick={() =>
        target.kind === "room"
          ? onActivateRoom(target.key)
          : onSelect(target.key)
      }
      onDoubleClick={() => {
        if (target.canActivate && target.kind !== "room")
          onActivate(target.key);
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          event.shiftKey &&
          target.canActivate &&
          target.kind !== "room"
        ) {
          event.preventDefault();
          onActivate(target.key);
        }
      }}
    />
  );
}, sameTargetButton);

type TownTargetButtonProps = {
  target: TownTarget;
  selected: boolean;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onActivateRoom(key: string): void;
  onFocusTarget(target: TownTarget): void;
};

function sameTargetButton(
  previous: TownTargetButtonProps,
  next: TownTargetButtonProps,
) {
  const a = previous.target;
  const b = next.target;
  return (
    previous.selected === next.selected &&
    previous.onSelect === next.onSelect &&
    previous.onActivate === next.onActivate &&
    previous.onActivateRoom === next.onActivateRoom &&
    previous.onFocusTarget === next.onFocusTarget &&
    a.key === b.key &&
    a.kind === b.kind &&
    a.label === b.label &&
    a.color === b.color &&
    a.canActivate === b.canActivate &&
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height
  );
}
