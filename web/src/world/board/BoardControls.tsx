import {
  EllipsisVertical,
  GitPullRequest,
  Maximize2,
  Minus,
  Plus,
  Sparkles,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useLayer } from "../../layerStack";
import {
  boardControlsLayout,
  type BoardControl,
  type BoardControlsLayout,
} from "./boardControlsLayout";
import "./boardControls.css";

const CONTROLS: readonly BoardControl[] = [
  "work",
  "home",
  "zoomOut",
  "fit",
  "zoomIn",
  "tidy",
  "menu",
];
const INITIAL_WIDTHS = {
  work: 76,
  home: 140,
  zoomOut: 36,
  fit: 36,
  zoomIn: 36,
  tidy: 36,
  menu: 36,
};
const icon = (control: BoardControl) => {
  const Icon = {
    work: GitPullRequest,
    home: null,
    zoomOut: Minus,
    fit: Maximize2,
    zoomIn: Plus,
    tidy: Sparkles,
    menu: EllipsisVertical,
  }[control];
  return Icon ? <Icon size={16} aria-hidden="true" /> : null;
};

/** One measured row: primary modes stay visible; secondary actions remain in the menu. */
export function BoardControls(props: {
  workRef: RefObject<HTMLButtonElement>;
  workOpen: boolean;
  onWork(): void;
  count: number;
  onHome(): void;
  onZoom(factor: number): void;
  onFit(): void;
  onTidy(): void;
  tidyLabel: string;
  pulses: boolean;
  onPulses(): void;
  tracing: boolean;
  onTrace?(): void;
}) {
  const space = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const measurements = useRef(new Map<BoardControl, HTMLSpanElement>());
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<BoardControlsLayout>(() =>
    boardControlsLayout({
      available: Infinity,
      widths: INITIAL_WIDTHS,
      count: props.count,
      phone: false,
      gap: 2,
      chrome: 10,
    }),
  );
  useLayer(open, () => setOpen(false), {
    element: () => menu.current,
    anchors: () => [trigger.current],
  });
  useEffect(() => {
    if (open)
      menu.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });
  }, [open]);
  useLayoutEffect(() => {
    const measure = () => {
      if (
        !space.current ||
        !row.current ||
        measurements.current.size !== CONTROLS.length
      )
        return;
      const style = getComputedStyle(row.current);
      const number = (value: string) => Number.parseFloat(value) || 0;
      const widths = Object.fromEntries(
        CONTROLS.map((control) => {
          const node = measurements.current.get(control)!;
          const style = getComputedStyle(node);
          return [
            control,
            node.getBoundingClientRect().width +
              number(style.marginLeft) +
              number(style.marginRight),
          ];
        }),
      ) as Record<BoardControl, number>;
      const next = boardControlsLayout({
        available: space.current.clientWidth,
        widths,
        count: props.count,
        phone:
          getComputedStyle(space.current)
            .getPropertyValue("--board-control-phone")
            .trim() === "1",
        gap: number(style.columnGap),
        chrome:
          number(style.paddingLeft) +
          number(style.paddingRight) +
          number(style.borderLeftWidth) +
          number(style.borderRightWidth),
      });
      setLayout((before) =>
        before.inline.join() === next.inline.join() &&
        before.overflow.join() === next.overflow.join()
          ? before
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(space.current!);
    for (const node of measurements.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [props.count]);
  const label = (control: BoardControl) =>
    ({
      work: "Work",
      home: `Needs a home · ${props.count}`,
      zoomOut: "Zoom out",
      fit: "Fit everything",
      zoomIn: "Zoom in",
      tidy: "Tidy",
      menu: "Board settings",
    })[control];
  const accessible = (control: BoardControl) =>
    control === "work"
      ? "Work: pull requests and tickets"
      : control === "home"
        ? `Needs a home: ${props.count} string${props.count === 1 ? "" : "s"}`
        : control === "tidy"
          ? props.tidyLabel
          : label(control);
  const content = (control: BoardControl, inMenu = false) => (
    <>
      {icon(control)}
      {control === "work" || control === "home" || inMenu ? (
        <span>
          {inMenu && control === "home"
            ? `Needs a home (${props.count})`
            : label(control)}
        </span>
      ) : null}
    </>
  );
  const className = (control: BoardControl, measuring = false) =>
    `board-control board-control-${control}${control === "home" && !measuring ? " board-tray-button" : ""}`;
  const act = (control: BoardControl) => {
    setOpen(false);
    if (control === "work") props.onWork();
    else if (control === "home") props.onHome();
    else if (control === "fit") props.onFit();
    else if (control === "zoomIn") props.onZoom(1.25);
    else if (control === "zoomOut") props.onZoom(1 / 1.25);
    else if (control === "tidy") props.onTidy();
  };
  return (
    <div ref={space} className="board-controls-space">
      <div
        ref={row}
        className="board-controls"
        role="group"
        aria-label="Board controls"
      >
        {layout.inline.map((control) =>
          control === "menu" ? (
            <div className="board-menu-wrap" key={control}>
              <button
                ref={trigger}
                type="button"
                className={className(control)}
                aria-label="Board settings"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                {content(control)}
              </button>
              {open && (
                <div
                  ref={menu}
                  className="board-menu"
                  role="menu"
                  onKeyDown={(event) => {
                    if (
                      !["ArrowDown", "ArrowUp", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    const buttons = [
                      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                        "button",
                      ),
                    ];
                    const current = buttons.indexOf(
                      document.activeElement as HTMLButtonElement,
                    );
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? buttons.length - 1
                          : (current +
                              (event.key === "ArrowDown" ? 1 : -1) +
                              buttons.length) %
                            buttons.length;
                    event.preventDefault();
                    buttons[next]?.focus();
                  }}
                >
                  {layout.overflow.map((control) => (
                    <button
                      type="button"
                      key={control}
                      className={className(control)}
                      role="menuitem"
                      aria-label={accessible(control)}
                      onClick={() => act(control)}
                    >
                      {content(control, true)}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={props.pulses}
                    onClick={props.onPulses}
                  >
                    Status pulses <span className="board-switch" />
                  </button>
                  {props.onTrace && (
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={props.tracing}
                      onClick={props.onTrace}
                    >
                      Event trace <span className="board-switch" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              key={control}
              className={className(control)}
              ref={control === "work" ? props.workRef : undefined}
              aria-label={accessible(control)}
              aria-pressed={control === "work" ? props.workOpen : undefined}
              onClick={() => act(control)}
            >
              {content(control)}
            </button>
          ),
        )}
      </div>
      <div className="board-controls board-controls-measure" aria-hidden="true">
        {CONTROLS.map((control) => (
          <span
            key={control}
            className={className(control, true)}
            ref={(node) => {
              if (node) measurements.current.set(control, node);
              else measurements.current.delete(control);
            }}
          >
            {content(control)}
          </span>
        ))}
      </div>
    </div>
  );
}
