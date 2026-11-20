import { describe, expect, test } from "bun:test";
import {
  BOARD_SHAPE_LIMITS,
  type BoardShape,
  parseBoardShape,
} from "../../../../shared/boardShapes";
import {
  arrowEnds,
  arrowPath,
  changesFor,
  dragCorner,
  moved,
  outlinePoint,
  resized,
  revertOps,
  shapeAt,
  simplify,
  strokeFrom,
  strokePath,
  type ShapeDraft,
} from "./boardSketchGeometry";

const rect: ShapeDraft = {
  id: "r",
  kind: "rect",
  color: "blue",
  x: 0,
  y: 0,
  w: 100,
  h: 50,
};

describe("Board drawing geometry", () => {
  test("a straight run of pen points becomes its two ends", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 2 }));
    expect(simplify(line, 0.5)).toEqual([line[0], line[49]]);
    const corner = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ];
    expect(simplify(corner, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  test("a stroke that doubles back keeps where it turned", () => {
    const back = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(simplify(back, 0.5)).toEqual(back);
    expect(strokeFrom(back, 0.6)!.points).toEqual([0, 0, 100, 0, 10, 0]);
    // Beyond both ends of the line between them, either way.
    const before = [
      { x: 50, y: 0 },
      { x: -40, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(simplify(before, 0.5)).toEqual(before);
  });

  test("a stroke is saved relative to its box and always fits the bound", () => {
    const stroke = strokeFrom(
      [
        { x: 10, y: 20 },
        { x: 30, y: 25 },
        { x: 15, y: 60 },
      ],
      0.5,
    )!;
    expect(stroke).toEqual({
      x: 10,
      y: 20,
      w: 20,
      h: 40,
      points: [0, 0, 20, 5, 5, 40],
    });
    expect(
      parseBoardShape({ id: "p", kind: "pen", color: "ink", ...stroke }, 1)
        .points,
    ).toEqual(stroke.points);
    // A long wiggle is simplified harder until it fits.
    const wiggle = Array.from({ length: 20_000 }, (_, i) => ({
      x: i,
      y: (i % 7) * 3,
    }));
    const long = strokeFrom(wiggle, 0.5)!;
    expect(long.points!.length).toBeLessThanOrEqual(BOARD_SHAPE_LIMITS.points);
    expect(long.w).toBe(19_999);
    expect(strokeFrom([], 0.5)).toBeNull();
    expect(strokePath({ x: 5, y: 5, points: [0, 0] })).toBe("M5 5l0.01 0");
    expect(strokePath({ x: 0, y: 0, points: [0, 0, 10, 0, 20, 10] })).toBe(
      "M0 0Q10 0 15 5L20 10",
    );
  });

  test("an attached arrow end meets its target's outline, not its centre", () => {
    const box = { x: 0, y: 0, w: 100, h: 50 };
    expect(
      outlinePoint({ box, outline: "rect" }, { x: 500, y: 25 }, 0),
    ).toEqual({ x: 100, y: 25 });
    expect(
      outlinePoint({ box, outline: "ellipse" }, { x: 50, y: -500 }, 0),
    ).toEqual({ x: 50, y: 0 });
    const diamond = outlinePoint(
      { box: { x: 0, y: 0, w: 100, h: 100 }, outline: "diamond" },
      { x: 500, y: 500 },
      0,
    );
    expect(diamond.x).toBeCloseTo(75);
    expect(diamond.y).toBeCloseTo(75);
    // Toward a point inside the outline, the end stops at that point.
    expect(outlinePoint({ box, outline: "rect" }, { x: 60, y: 25 }, 0)).toEqual(
      { x: 60, y: 25 },
    );
    // Free ends stay where they were drawn; a missing target leaves the
    // saved point.
    const ends = arrowEnds(
      { x: 0, y: 0, attach: { card: "gone" } },
      { x: 300, y: 25, attach: { shape: "r" } },
      (attach) =>
        "shape" in attach
          ? { box: { x: 200, y: 0, w: 100, h: 50 }, outline: "rect" }
          : null,
    );
    expect(ends.a).toEqual({ x: 0, y: 0 });
    expect(ends.b.x).toBeCloseTo(194);
    expect(arrowPath({ x: 0, y: 0 }, { x: 100, y: 0 })).toStartWith(
      "M0 0L100 0M",
    );
  });

  test("arrows attach to boxes and text, topmost first, never to themselves", () => {
    const top = { ...rect, id: "top", x: 50 };
    const pen: ShapeDraft = { ...rect, id: "pen", kind: "pen", points: [0, 0] };
    const shapes = [rect, top, pen];
    expect(shapeAt(shapes, { x: 60, y: 10 })?.id).toBe("top");
    expect(shapeAt(shapes, { x: 60, y: 10 }, "top")?.id).toBe("r");
    expect(shapeAt([pen], { x: 10, y: 10 })).toBeNull();
    expect(shapeAt(shapes, { x: 500, y: 500 })).toBeNull();
  });

  test("moving and resizing", () => {
    const arrow: ShapeDraft = {
      id: "a",
      kind: "arrow",
      color: "ink",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      from: { x: 0, y: 0, attach: { note: "n" } },
      to: { x: 10, y: 10 },
    };
    // A moved arrow lets go of what it was attached to.
    const unresolved = () => null;
    expect(moved(arrow, 5, 5, unresolved)).toMatchObject({
      x: 5,
      from: { x: 5, y: 5 },
      to: { x: 15, y: 15 },
    });
    expect(moved(arrow, 5, 5, unresolved).from!.attach).toBeUndefined();
    // It lets go from where it is drawn: its target moved since it was saved.
    const onBox: ShapeDraft = {
      ...arrow,
      x: 106,
      y: 25,
      w: 94,
      h: 0,
      from: { x: 106, y: 25, attach: { shape: "r" } },
      to: { x: 700, y: 25 },
    };
    const target = () => ({
      box: { ...rect, x: 500 },
      outline: "rect" as const,
    });
    const drawn = arrowEnds(onBox.from!, onBox.to!, target).a;
    expect(drawn.x).toBe(606);
    const dragged = moved(onBox, 10, 0, target);
    expect(dragged.from).toEqual({ x: 616, y: 25 });
    expect(dragged.to).toEqual({ x: 710, y: 25 });
    expect(dragged).toMatchObject({ x: 616, y: 25, w: 94, h: 0 });
    const pen: ShapeDraft = {
      ...rect,
      kind: "pen",
      w: 10,
      h: 20,
      points: [0, 0, 10, 20],
    };
    expect(resized(pen, { x: 0, y: 0, w: 20, h: 10 }).points).toEqual([
      0, 0, 20, 10,
    ]);
    expect(dragCorner(rect, "nw", { x: 40, y: 30 })).toEqual({
      x: 40,
      y: 30,
      w: 60,
      h: 20,
    });
    // Dragging past the fixed corner flips the box instead of inverting it.
    expect(dragCorner(rect, "se", { x: -20, y: 70 })).toEqual({
      x: -20,
      y: 0,
      w: 20,
      h: 70,
    });
  });

  test("undo reverts only drawings nobody changed since", () => {
    const saved = (shape: ShapeDraft, rev: number): BoardShape => ({
      ...shape,
      rev,
    });
    const blue = saved(rect, 1);
    const red = { ...rect, color: "red" as const };
    // Recolour: undo puts blue back over the recoloured revision.
    const recolour = changesFor(
      [{ op: "shape.put", shape: red, rev: 1 }],
      [blue],
    );
    expect(recolour).toEqual([{ id: "r", before: rect, after: red, rev: 2 }]);
    const now = [saved(red, 2)];
    const undo = revertOps(recolour, now)!;
    expect(undo).toEqual([{ op: "shape.put", shape: rect, rev: 2 }]);
    // Someone else changed it since: nothing is overwritten.
    expect(
      revertOps(recolour, [saved({ ...red, text: "elsewhere" }, 3)]),
    ).toBeNull();
    // Deleted and restored (revisions start again), but as the change left
    // it: the undo goes ahead, whatever order its fields are in.
    const reordered = Object.fromEntries(
      Object.entries(red).reverse(),
    ) as ShapeDraft;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(red));
    expect(revertOps(recolour, [saved(reordered, 1)])).toEqual([
      { op: "shape.put", shape: rect, rev: 1 },
    ]);
    // The undo is itself a change; reverting it (redo) puts red back.
    const redo = changesFor(undo, now);
    expect(redo).toEqual([{ id: "r", before: red, after: rect, rev: 3 }]);
    expect(revertOps(redo, [saved(rect, 3)])).toEqual([
      { op: "shape.put", shape: red, rev: 3 },
    ]);
    // Creating undoes to a delete, deleting undoes to a fresh put.
    const create = changesFor([{ op: "shape.put", shape: rect }], []);
    expect(revertOps(create, [blue])).toEqual([
      { op: "shape.delete", id: "r", rev: 1 },
    ]);
    const remove = changesFor(
      [{ op: "shape.delete", id: "r", rev: 1 }],
      [blue],
    );
    expect(revertOps(remove, [])).toEqual([{ op: "shape.put", shape: rect }]);
    // Someone drew it back in between: the undo is refused.
    expect(revertOps(remove, [blue])).toBeNull();
  });
});
