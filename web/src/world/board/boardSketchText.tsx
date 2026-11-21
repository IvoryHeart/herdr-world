import { type CSSProperties, type RefObject, useRef, useState } from "react";
import type { BoardShapeColor } from "../../../../shared/boardShapes";
import { type ShapeDraft, TEXT_SIZE, textBox } from "./boardSketchGeometry";

/** Board drawings' text (BoardSketch.tsx): its colours, lines and editor. */

export const COLORS: Record<BoardShapeColor, string> = {
  ink: "var(--board-ink)",
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#d49a00",
  green: "#30a46c",
  teal: "#12a594",
  blue: "#3e63dd",
  purple: "#8e4ec6",
};
/** A label inside a shape, in Board units. */
export const LABEL_SIZE = 18;

/** Lines of text, as SVG text, from a corner or around a centre. */
export function lines(
  text: string,
  x: number,
  y: number,
  size: number,
  anchor: "start" | "middle",
) {
  const rows = text.split("\n");
  const step = size * 1.3;
  const top =
    anchor === "middle" ? y - ((rows.length - 1) * step) / 2 : y + size * 0.8;
  return (
    <text
      className="board-sketch-text"
      x={x}
      y={top}
      textAnchor={anchor}
      dominantBaseline={anchor === "middle" ? "middle" : "alphabetic"}
      style={{ fontSize: size }}
    >
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity
        <tspan key={index} x={x} y={top + index * step}>
          {row || " "}
        </tspan>
      ))}
    </text>
  );
}

export function TextEditor({
  shape,
  initial,
  inputRef,
  onDone,
}: {
  shape: ShapeDraft;
  initial: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onDone(text: string): void;
}) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  const box = shape.kind === "text";
  const size = textBox(text);
  const style: CSSProperties = box
    ? {
        left: shape.x,
        top: shape.y,
        width: Math.max(size.w, 120),
        height: size.h,
        fontSize: TEXT_SIZE,
        color: COLORS[shape.color],
      }
    : {
        left: shape.x,
        top: shape.y,
        width: Math.max(shape.w, 80),
        height: Math.max(shape.h, 40),
        fontSize: LABEL_SIZE,
        textAlign: "center",
        color: COLORS[shape.color],
      };
  return (
    <textarea
      ref={inputRef}
      className={`board-sketch-edit board-sketch-live${box ? "" : " board-sketch-edit-label"}`}
      aria-label={box ? "Drawing text" : "Drawing label"}
      // biome-ignore lint/a11y/noAutofocus: the text is typed where it was placed
      autoFocus
      value={text}
      style={style}
      onChange={(event) => setText(event.target.value)}
      onBlur={finish}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          event.key === "Escape" ||
          (event.key === "Enter" && (event.metaKey || event.ctrlKey))
        ) {
          event.preventDefault();
          finish();
        }
      }}
    />
  );
}
