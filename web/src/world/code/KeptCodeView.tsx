import {
  type ComponentProps,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { lazyWithReload } from "../../lazyWithReload";
import type CodeView from "./CodeView";
import { LazyCodeView } from "./LazyCodeView";

type Size = { width: number; height: number };

// Lazy, as WorldControlPlane loads it: one chunk for both.
const WorldViewErrorBoundary = lazyWithReload("world-view-boundary", () =>
  import("../WorldViewErrorBoundary").then((module) => ({
    default: module.WorldViewErrorBoundary,
  })),
);

/**
 * The Code view, kept loaded once shown (#1262). Leaving Code for another
 * view (or Spaces) would unmount its VS Code frames, and coming back would
 * load each workbench again: open editors, unsaved edits, webviews and
 * scroll positions reset. So it stays mounted at one place in the tree,
 * and while another view is in front it is hidden in place at its last
 * size, unseen and unclickable, so the workbench keeps laying out as it
 * was. Its memory stays in use meanwhile; only a page reload, Stop or a
 * server that ends lets a workbench go.
 */
export function KeptCodeView({
  shown,
  ...props
}: { shown: boolean } & ComponentProps<typeof CodeView>) {
  const [kept, setKept] = useState(shown);
  if (shown && !kept) setKept(true);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!shown || !element) return;
    const measure = () =>
      setSize((current) => {
        const width = element.offsetWidth;
        const height = element.offsetHeight;
        // An unchanged size must not commit again.
        return current?.width === width && current.height === height
          ? current
          : { width, height };
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shown, kept]);

  if (!kept) return null;
  return (
    <div
      ref={ref}
      className="world-code-keeper"
      data-shown={shown ? "true" : "false"}
      style={!shown && size ? size : undefined}
    >
      <Suspense
        fallback={<div className="world-view-loading">Loading view…</div>}
      >
        <WorldViewErrorBoundary>
          <LazyCodeView {...props} />
        </WorldViewErrorBoundary>
      </Suspense>
    </div>
  );
}
