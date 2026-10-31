import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appearanceFor,
  appearanceKey,
  type AppearanceTarget,
} from "../../../shared/appearance";
import { BoardStore, moveFollowOps, type BoardOp } from "./board-store";
import {
  captureAppearanceChanges,
  trackAppearanceEdits,
  type AppearanceEdits,
} from "./appearance-edits";
import {
  moveAppearanceEditOps,
  reconciledAppearanceOps,
} from "./appearance-move";

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);
const source: AppearanceTarget = {
  connection_id: "connection-a",
  kind: "tab",
  native_id: "source",
  witness: ["terminal-1"],
  color_key: "connection-a:source",
};
const destination: AppearanceTarget = {
  ...source,
  native_id: "destination",
  color_key: "connection-a:destination",
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "appearance-edit-order-"));
  roots.push(root);
  const board = new BoardStore(join(root, "board.json"));
  const edits: AppearanceEdits = new Map();
  const patch = (ops: BoardOp[]) => {
    const next = board.patch(ops);
    trackAppearanceEdits(edits, ops, next);
    return next;
  };
  return {
    board,
    edits,
    patch,
    capture: () =>
      captureAppearanceChanges(edits, board.get().revision, () => board.get()),
  };
}

test("a reset is a changed field, while untouched fields stay absent from the move overlay", () => {
  const { patch, capture } = fixture();
  patch([
    {
      op: "appearance.set",
      target: source,
      fields: { status: "Before", color: "pink" },
    },
  ]);
  const changes = capture();
  expect(changes(source)).toEqual({});
  patch([{ op: "appearance.set", target: source, fields: { status: null } }]);
  expect(changes(source).status?.value).toBeNull();
  expect(changes(source).color).toBeUndefined();
  expect(changes({ ...source, connection_id: "connection-b" })).toEqual({});
});

test.each([true, false])(
  "source and destination writes merge by field commit order, source last=%s",
  (sourceLast) => {
    const { patch, capture, board, edits } = fixture();
    const before = patch([
      {
        op: "appearance.set",
        target: source,
        fields: { status: "Before", color: "pink" },
      },
    ]);
    const changes = capture();
    if (sourceLast) {
      patch([
        {
          op: "appearance.set",
          target: destination,
          fields: { status: "Destination", color: "teal" },
        },
      ]);
      patch([
        {
          op: "appearance.set",
          target: source,
          fields: { status: "Source later" },
        },
      ]);
    } else {
      patch([
        {
          op: "appearance.set",
          target: source,
          fields: { status: "Source earlier", color: "yellow" },
        },
      ]);
      patch([
        {
          op: "appearance.set",
          target: destination,
          fields: { status: "Destination", color: null },
        },
      ]);
    }
    const document = board.get(),
      workspaceIds = new Set(["room-1", "room-2"]);
    const ops = moveFollowOps(
      document,
      source.connection_id,
      source.native_id,
      {
        tab_id: destination.native_id,
        source_workspace_id: "room-1",
        workspace_id: "room-2",
        panes: [],
      },
      { before: before.layout.colors, workspaceIds },
    );
    patch([
      ...ops,
      ...moveAppearanceEditOps(document, ops, changes, {
        connectionId: source.connection_id,
        from: source.native_id,
        to: destination.native_id,
        workspaceIds,
      }),
    ]);
    const saved = board.get();
    expect(appearanceFor(saved.appearance, destination)?.status).toBe(
      sourceLast ? "Source later" : "Destination",
    );
    expect(
      saved.layout.colors[destination.color_key!] as string | undefined,
    ).toBe(sourceLast ? "teal" : undefined);
    expect(edits.size).toBe(1);
    expect(capture()(destination)).toEqual({});
  },
);

for (const destinationFirst of [true, false])
  for (const sourceLast of [true, false])
    for (const reset of [true, false])
      test(`compensation converges both aliases by field order: destination first=${destinationFirst}, source last=${sourceLast}, reset=${reset}`, () => {
        const { patch, board } = fixture();
        const sourceOp: BoardOp = {
          op: "appearance.set",
          target: source,
          fields: { status: "Before", color: "pink" },
        };
        const destinationOp: BoardOp = {
          op: "appearance.set",
          target: destination,
          fields: { status: "Older destination" },
        };
        patch(
          destinationFirst
            ? [destinationOp, sourceOp]
            : [sourceOp, destinationOp],
        );
        const changes = board.captureAppearanceChanges();
        patch([
          {
            op: "appearance.set",
            target: destination,
            fields: {
              status: reset ? null : "Destination",
              color: reset ? null : "teal",
            },
          },
        ]);
        if (sourceLast)
          patch([
            {
              op: "appearance.set",
              target: source,
              fields: { status: "Source later" },
            },
          ]);
        const document = board.get(),
          restored = {
            ...source,
            native_id: "restored",
            color_key: "connection-a:restored",
          };
        const ops = reconciledAppearanceOps(
          document,
          source.connection_id,
          [
            {
              terminal_id: "terminal-1",
              pane_id: "pane-restored",
              tab_id: restored.native_id,
            },
          ],
          new Set(),
        );
        patch([...ops, ...moveAppearanceEditOps(document, ops, changes, null)]);
        const saved = board.get();
        expect(appearanceFor(saved.appearance, restored)?.status).toBe(
          sourceLast ? "Source later" : reset ? undefined : "Destination",
        );
        if (reset)
          expect(saved.layout.colors[restored.color_key]).toBeUndefined();
        else expect(saved.layout.colors[restored.color_key]).toBe("teal");
        expect(saved.appearance?.[appearanceKey(source)]).toBeUndefined();
        expect(saved.appearance?.[appearanceKey(destination)]).toBeUndefined();
      });

test("field intent is bounded by live records and cannot cross occupant reuse or pruning", () => {
  const { patch, capture, board, edits } = fixture();
  patch([
    {
      op: "appearance.set",
      target: source,
      fields: { status: "Before", color: "pink" },
    },
  ]);
  const changes = capture();
  for (let index = 0; index < 24; index++) {
    const target = { ...source, witness: [`replacement-${index}`] };
    patch([
      { op: "appearance.set", target, fields: { status: "Current occupant" } },
    ]);
    expect(edits.size).toBe(Object.keys(board.get().appearance!).length);
    expect(changes(source)).toEqual({});
    expect(changes(target).color).toBeUndefined();
    patch([{ op: "appearance.prune", keys: [appearanceKey(target)] }]);
    expect(edits.size).toBe(0);
  }
});

test("compensation replays the effective restored value instead of a superseded field intent", () => {
  const { patch, capture, board } = fixture();
  const before = patch([
    {
      op: "appearance.set",
      target: source,
      fields: { status: "Before", color: "pink" },
    },
  ]);
  const changes = capture();
  patch([
    {
      op: "appearance.set",
      target: source,
      fields: { status: "After", color: "teal" },
    },
  ]);
  patch([
    {
      op: "appearance.restore",
      key: appearanceKey(source),
      record: before.appearance![appearanceKey(source)]!,
    },
    { op: "card.color", key: source.color_key!, color: "pink" },
  ]);
  expect(changes(source).status?.value).toBe("Before");
  expect(changes(source).color?.value).toBe(
    board.get().layout.colors[source.color_key!],
  );
});

test("metadata restoration cannot make an untouched source colour newer than a destination save", () => {
  const { patch, capture, board } = fixture();
  const before = patch([
    {
      op: "appearance.set",
      target: source,
      fields: { status: "Before", color: "pink" },
    },
  ]);
  const changes = capture();
  patch([
    {
      op: "appearance.set",
      target: source,
      fields: { status: "Temporary", color: "yellow" },
    },
  ]);
  patch([
    {
      op: "appearance.set",
      target: destination,
      fields: { status: "Destination", color: "teal" },
    },
  ]);
  patch([
    {
      op: "appearance.restore",
      key: appearanceKey(source),
      record: before.appearance![appearanceKey(source)]!,
    },
  ]);
  const document = board.get(),
    workspaceIds = new Set(["room-1", "room-2"]);
  const ops = moveFollowOps(
    document,
    source.connection_id,
    source.native_id,
    {
      tab_id: destination.native_id,
      source_workspace_id: "room-1",
      workspace_id: "room-2",
      panes: [],
    },
    { before: before.layout.colors, workspaceIds },
  );
  patch([
    ...ops,
    ...moveAppearanceEditOps(document, ops, changes, {
      connectionId: source.connection_id,
      from: source.native_id,
      to: destination.native_id,
      workspaceIds,
    }),
  ]);
  const saved = board.get();
  expect(appearanceFor(saved.appearance, destination)?.status).toBe("Before");
  expect(saved.layout.colors[destination.color_key!]).toBe("teal");
});
