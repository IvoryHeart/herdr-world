import { useLayoutEffect, useRef } from "react";

/** A Desk card's screen lines, following the newest unless scrolled up. */
export function Screen({
  lines,
  live,
  fallback,
}: {
  lines: string[];
  live?: boolean;
  fallback: string;
}) {
  const ref = useRef<HTMLPreElement | null>(null);
  // Follow the newest lines (the question and its choices) unless the reader
  // has scrolled up to read earlier output.
  const pinned = useRef(true);
  const text = lines.join("\n");
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [text]);
  if (!lines.length) return <p className="desk-card-missing">{fallback}</p>;
  return (
    <pre
      ref={ref}
      className={`desk-screen${live ? " is-live" : ""}`}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinned.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      }}
    >
      {text}
    </pre>
  );
}
