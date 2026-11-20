import { useState } from "react";
import "../board/boardAppearance.css";
import type { BoardShape } from "../../../../shared/boardShapes";
import { useBoardSketch } from "../board/BoardSketch";
import {
  BoardDocumentStore,
  type BoardDocument,
  type BoardOp,
  useBoardDocument,
} from "../board/boardDocument";

/** Synthetic service with a response gate, shared by the preview and DOM tests. */
export function createBoardTextFixture(kind: "text" | "rect" = "text") {
  let document: BoardDocument = {
    version: 1,
    revision: 1,
    layout: { anchors: {}, offsets: {}, pinned: {}, folded: [] },
    notes: [],
    strings: [],
    shapes: ["a", "b"].map((id, index) => ({
      id,
      kind,
      text: `Text ${id.toUpperCase()}`,
      color: "ink",
      x: 100 + index * 280,
      y: 100,
      w: 200,
      h: 80,
      rev: 1,
    })),
  };
  let gate: Promise<void> | null = null;
  const writes: BoardOp[][] = [];
  const store = new BoardDocumentStore({
    async call(method, params) {
      if (method === "world.board.get") return structuredClone(document);
      const ops = params!.ops as BoardOp[];
      writes.push(ops);
      const waiting = gate;
      gate = null;
      await waiting;
      const next = structuredClone(document);
      for (const op of ops) {
        if (op.op !== "shape.put" && op.op !== "shape.delete")
          throw new Error("The fixture accepts drawing edits only");
        const id = op.op === "shape.put" ? op.shape.id : op.id;
        const at = next.shapes!.findIndex((shape) => shape.id === id);
        if (op.rev !== next.shapes![at]?.rev)
          return {
            conflict: "That drawing changed elsewhere.",
            document: structuredClone(document),
          };
        if (op.op === "shape.delete") next.shapes!.splice(at, 1);
        else if (at < 0) next.shapes!.push({ ...op.shape, rev: 1 });
        else next.shapes![at] = { ...op.shape, rev: op.rev! + 1 };
      }
      document = { ...next, revision: next.revision + 1 };
      return { document: structuredClone(document) };
    },
    onControl: () => () => {},
    onStatus: () => () => {},
  });
  return {
    store,
    writes,
    saved: () => document,
    hold() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    async otherClient(id: string, fields: Partial<BoardShape> = {}) {
      const shape = document.shapes!.find((shape) => shape.id === id)!;
      document = {
        ...document,
        revision: document.revision + 1,
        shapes: document.shapes!.map((entry) =>
          entry.id === id
            ? {
                ...shape,
                text: `Other client ${id.toUpperCase()}`,
                color: "teal",
                ...fields,
                rev: shape.rev + 1,
              }
            : entry,
        ),
      };
      await store.refresh();
    },
  };
}

/** Testing-only canvas: no runtime, server writes or stored board data. */
export default function BoardTextConflictFixture() {
  const [fixture] = useState(() => {
    const value = createBoardTextFixture();
    void value.store.refresh();
    return value;
  });
  const [release, setRelease] = useState<(() => void) | null>(null);
  const [notice, setNotice] = useState("");
  const { document } = useBoardDocument(fixture.store);
  const sketch = useBoardSketch({
    store: fixture.store,
    shapes: document?.shapes ?? [],
    host: {
      toWorld: (x, y) => ({ x, y }),
      scale: () => 1,
      targetBox: () => null,
      cardAt: () => null,
      note() {},
      selected() {},
      notify: setNotice,
    },
  });
  return (
    <main style={{ padding: 24 }}>
      <h1>Board text conflict preview</h1>
      <p>
        Double-click A and type a draft. Change A from the other client, then
        double-click B and type there. Finish the pending save while B is open.
      </p>
      <button
        type="button"
        disabled={Boolean(release)}
        onPointerDown={(event) => event.preventDefault()}
        onClick={async () => {
          setRelease(() => fixture.hold());
          await fixture.otherClient("a");
        }}
      >
        Other client changes A
      </button>{" "}
      <button
        type="button"
        disabled={!release}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          release?.();
          setRelease(null);
        }}
      >
        Finish pending save
      </button>
      <p role="status">{notice}</p>
      <div className="board" style={{ position: "relative", height: 300 }}>
        {sketch.layer}
        {sketch.tools}
      </div>
      <p>Save B with Ctrl/⌘+Enter: A's draft reopens. Save it the same way.</p>
      <pre aria-label="Saved drawing text">
        {document?.shapes
          ?.map((shape) => `${shape.id.toUpperCase()}: ${shape.text ?? ""}`)
          .join("\n")}
      </pre>
    </main>
  );
}
