import type { CSSProperties, ReactNode } from "react";

type HerdrClientFrameProps = {
  children: ReactNode;
  style: CSSProperties;
  sidebarOpen: boolean;
  notesOpen: boolean;
  resizingSidebar: boolean;
  resizingNotes: boolean;
  resizingNotesList: boolean;
  compact: boolean;
  touch: boolean;
  detail: boolean;
  primaryView: string;
};

export function HerdrClientFrame({
  children,
  style,
  sidebarOpen,
  notesOpen,
  resizingSidebar,
  resizingNotes,
  resizingNotesList,
  compact,
  touch,
  detail,
  primaryView,
}: HerdrClientFrameProps) {
  return (
    <div
      className="app"
      style={style}
      data-sidebar={sidebarOpen ? "open" : "closed"}
      data-notes={notesOpen ? "open" : "closed"}
      data-resizing-sidebar={resizingSidebar ? "true" : "false"}
      data-resizing-notes={resizingNotes ? "true" : "false"}
      data-resizing-notes-list={resizingNotesList ? "true" : "false"}
      data-compact={compact ? "true" : "false"}
      data-touch={touch ? "true" : "false"}
      data-detail={compact && detail ? "true" : "false"}
      data-primary-view={primaryView}
    >
      {children}
    </div>
  );
}
export function HerdrClientSidebar({ children }: { children: ReactNode }) {
  return (
    <aside className="sidebar" aria-label="Switcher">
      {children}
    </aside>
  );
}

export function HerdrMainStage({
  label,
  children,
  inert,
}: {
  label: string;
  children: ReactNode;
  inert?: boolean;
}) {
  return (
    <section className="stage" aria-label={label} inert={inert}>
      {children}
    </section>
  );
}
