export type BoardControl =
  | "work"
  | "home"
  | "zoomOut"
  | "fit"
  | "zoomIn"
  | "tidy"
  | "menu";
export type BoardControlsLayout = {
  inline: BoardControl[];
  overflow: BoardControl[];
};

/** Measured widths, including margins; Work and the menu always retain their slots. */
export function boardControlsLayout({
  available,
  widths,
  count,
  phone,
  gap,
  chrome,
}: {
  available: number;
  widths: Readonly<Record<BoardControl, number>>;
  count: number;
  phone: boolean;
  gap: number;
  chrome: number;
}): BoardControlsLayout {
  let inline: BoardControl[] = [
    "work",
    ...(count > 0 ? ["home" as const] : []),
    "zoomOut",
    "fit",
    "zoomIn",
    ...(!phone ? ["tidy" as const] : []),
    "menu",
  ];
  const occupied = () =>
    chrome +
    Math.max(0, inline.length - 1) * gap +
    inline.reduce((total, control) => total + widths[control], 0);
  for (const control of ["home", "fit", "zoomIn", "zoomOut", "tidy"] as const) {
    if (Math.ceil(occupied()) <= Math.floor(available)) break;
    inline = inline.filter((entry) => entry !== control);
  }
  return {
    inline,
    overflow: (["home", "tidy", "fit", "zoomIn", "zoomOut"] as const).filter(
      (control) => !inline.includes(control),
    ),
  };
}
