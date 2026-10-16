import type { OfficeRect } from "./officeGeometry";

export type OfficePackingSize = {
  width: number;
  height: number;
  waste?: number;
};
export type OfficePackedChoice = OfficeRect & { variant: number };
type Placement = {
  previous: Placement | null;
  index: number;
  rect: OfficePackedChoice;
};
type State = {
  free: OfficeRect[];
  height: number;
  area: number;
  waste: number;
  node: Placement | null;
  levels?: ReadonlySet<number>;
};

/** Maximal free rectangles retain cavities; a bounded beam compares room shapes. */
export function packOfficeRoomShapes(
  choices: readonly (readonly OfficePackingSize[])[],
  requestedWidth: number,
  horizontalGap: number,
  verticalGap: number,
  beamWidth = 8,
): OfficePackedChoice[] {
  if (!choices.length) return [];
  const compact = searchOfficeRoomShapes(
    choices,
    requestedWidth,
    horizontalGap,
    verticalGap,
    beamWidth,
    false,
  );
  if (beamWidth === 1 || !choices.some((variants) => variants.length > 1))
    return compact.rects;
  const aligned = searchOfficeRoomShapes(
    choices,
    requestedWidth,
    horizontalGap,
    verticalGap,
    beamWidth,
    true,
  );
  // Judge complete buildings: equal-height fits prefer fewer fragmented bands.
  // Keep the height-first search as a candidate so alignment cannot add depth.
  const compare =
    aligned.height - compact.height ||
    aligned.levels - compact.levels ||
    aligned.waste - compact.waste ||
    aligned.holes - compact.holes;
  return compare < 0 ? aligned.rects : compact.rects;
}

function searchOfficeRoomShapes(
  choices: readonly (readonly OfficePackingSize[])[],
  requestedWidth: number,
  horizontalGap: number,
  verticalGap: number,
  beamWidth: number,
  align: boolean,
) {
  const width =
    choices.reduce(
      (limit, variants) =>
        Math.max(limit, Math.min(...variants.map((item) => item.width))),
      requestedWidth,
    ) + horizontalGap;
  const height = choices.reduce(
    (sum, variants) =>
      sum + Math.max(...variants.map((item) => item.height)) + verticalGap,
    0,
  );
  let states: State[] = [
    {
      free: [{ x: 0, y: 0, width, height }],
      height: 0,
      area: 0,
      waste: 0,
      node: null,
      levels: align ? new Set<number>() : undefined,
    },
  ];
  for (let index = 0; index < choices.length; index++) {
    type Candidate = {
      state: State;
      rect: OfficePackedChoice;
      height: number;
      area: number;
      waste: number;
      holes: number;
      levels: number;
    };
    const candidates: Candidate[] = [];
    states.forEach((state, stateIndex) => {
      const seen = new Set<string>();
      choices[index]!.forEach((size, variant) => {
        const w = size.width + horizontalGap,
          h = size.height + verticalGap;
        for (const free of state.free) {
          if (w > free.width + 0.001 || h > free.height + 0.001) continue;
          const key = `${stateIndex}:${free.x}:${free.y}:${variant}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const nextHeight = Math.max(state.height, free.y + size.height);
          const area = state.area + w * h;
          candidates.push({
            state,
            rect: {
              x: free.x,
              y: free.y,
              width: size.width,
              height: size.height,
              variant,
            },
            height: nextHeight,
            area,
            waste: state.waste + (size.waste ?? 0),
            holes: width * (nextHeight + verticalGap) - area,
            levels: state.levels
              ? state.levels.size +
                Number(!state.levels.has(free.y)) +
                Number(!state.levels.has(free.y + size.height))
              : 0,
          });
        }
      });
    });
    candidates.sort(
      (a, b) =>
        a.height - b.height ||
        a.levels - b.levels ||
        a.waste - b.waste ||
        a.holes - b.holes ||
        a.rect.y - b.rect.y ||
        a.rect.x - b.rect.x ||
        a.rect.variant - b.rect.variant,
    );
    const next: State[] = [];
    const signatures = new Set<string>();
    // Only shortlisted placements split/prune rectangles, bounding branch work.
    for (const candidate of candidates.slice(0, beamWidth * 8)) {
      const free = splitFree(candidate.state.free, {
        ...candidate.rect,
        width: candidate.rect.width + horizontalGap,
        height: candidate.rect.height + verticalGap,
      });
      const signature = `${candidate.height}:${candidate.waste}:${free.map((rect) => `${rect.x},${rect.y},${rect.width},${rect.height}`).join(";")}`;
      if (signatures.has(signature)) continue;
      signatures.add(signature);
      next.push({
        free,
        height: candidate.height,
        area: candidate.area,
        waste: candidate.waste,
        node: { previous: candidate.state.node, index, rect: candidate.rect },
        levels: align
          ? new Set([
              ...candidate.state.levels!,
              candidate.rect.y,
              candidate.rect.y + candidate.rect.height,
            ])
          : undefined,
      });
      if (next.length === beamWidth) break;
    }
    if (!next.length)
      throw new Error("Office packing lost a complete room placement");
    states = next;
  }
  const result: OfficePackedChoice[] = new Array(choices.length);
  for (let node = states[0]!.node; node; node = node.previous)
    result[node.index] = node.rect;
  const best = states[0]!;
  return {
    rects: result,
    height: best.height,
    waste: best.waste,
    levels: new Set(result.flatMap((rect) => [rect.y, rect.y + rect.height]))
      .size,
    holes: width * (best.height + verticalGap) - best.area,
  };
}

function splitFree(free: readonly OfficeRect[], used: OfficeRect) {
  const split: OfficeRect[] = [];
  const right = used.x + used.width,
    bottom = used.y + used.height;
  for (const rect of free) {
    const rectRight = rect.x + rect.width,
      rectBottom = rect.y + rect.height;
    if (
      used.x >= rectRight - 0.001 ||
      right <= rect.x + 0.001 ||
      used.y >= rectBottom - 0.001 ||
      bottom <= rect.y + 0.001
    ) {
      split.push(rect);
      continue;
    }
    if (used.x > rect.x) split.push({ ...rect, width: used.x - rect.x });
    if (right < rectRight)
      split.push({ ...rect, x: right, width: rectRight - right });
    if (used.y > rect.y) split.push({ ...rect, height: used.y - rect.y });
    if (bottom < rectBottom)
      split.push({ ...rect, y: bottom, height: rectBottom - bottom });
  }
  return split
    .filter(
      (rect, index) =>
        rect.width > 0.001 &&
        rect.height > 0.001 &&
        !split.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            other.x <= rect.x &&
            other.y <= rect.y &&
            other.x + other.width >= rect.x + rect.width &&
            other.y + other.height >= rect.y + rect.height &&
            (otherIndex < index ||
              other.x !== rect.x ||
              other.y !== rect.y ||
              other.width !== rect.width ||
              other.height !== rect.height),
        ),
    )
    .sort(
      (a, b) =>
        a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height,
    );
}
