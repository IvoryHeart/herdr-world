import { createContext, useContext } from "react";
import type { CSSProperties, ReactNode } from "react";

import { StageThemeSwitcher } from "./StageThemeSwitcher";

type FrameLayout = {
  sidebarOpen: boolean;
  compact: boolean;
};

const FrameLayoutContext = createContext<FrameLayout>({ sidebarOpen: true, compact: true });

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
    <FrameLayoutContext.Provider value={{ sidebarOpen, compact }}>
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
    </FrameLayoutContext.Provider>
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
  const { sidebarOpen, compact } = useContext(FrameLayoutContext);
  return (
    <section className="stage" aria-label={label} inert={inert}>
      {!sidebarOpen && !compact ? <StageThemeSwitcher /> : null}
      {children}
    </section>
  );
}
