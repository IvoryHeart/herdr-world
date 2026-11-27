import { coreFixtureEnabled } from "./coreFixture";
import { moveBoardRefuses } from "./world/moveBoardRefuses";
import { coreInstallFake } from "./coreInstall";
import { integrationsFixtureEnabled } from "./integrationsFixture";
import { initializeLayoutPreferences } from "./layoutPreferences";
import { initializeShortcutPreferences } from "./shortcutPreferences";
import { initializeInstanceName } from "./instanceName";
import { consumeFocusTest } from "./world/focusTest";
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/vendor.css";
import { OverlayScrollbarLayer } from "./components/OverlayScrollbarLayer";
import TitleSpinnerFixture from "./testing/TitleSpinnerFixture";
import ClaudeTapLockFixture from "./testing/ClaudeTapLockFixture";

// Testing-only preview: consume the switch before view routing rewrites the URL.
const previewUrl = new URL(location.href);
const questionBacklogFixture = previewUrl.searchParams.has(
  "questionBacklogFixture",
);
const titleSpinnerFixture = previewUrl.searchParams.has("titleSpinnerFixture");
const claudeTapLockFixture = previewUrl.searchParams.has(
  "claudeTapLockFixture",
);
const boardTextConflictFixture = previewUrl.searchParams.has(
  "boardTextConflictFixture",
);
// Testing-only: `?focusTest=1` offers 1-minute focus sessions in this tab.
const focusTest = consumeFocusTest(previewUrl);
const siblingQuestionsFixture = previewUrl.searchParams.has(
  "siblingQuestionsFixture",
);
if (
  siblingQuestionsFixture ||
  titleSpinnerFixture ||
  claudeTapLockFixture ||
  boardTextConflictFixture ||
  questionBacklogFixture ||
  focusTest
) {
  previewUrl.searchParams.delete("questionBacklogFixture");
  previewUrl.searchParams.delete("siblingQuestionsFixture");
  previewUrl.searchParams.delete("claudeTapLockFixture");
  previewUrl.searchParams.delete("titleSpinnerFixture");
  previewUrl.searchParams.delete("boardTextConflictFixture");
  history.replaceState(history.state, "", previewUrl);
}
const WorldFoundationApp = React.lazy(
  () => import("./world/WorldFoundationApp"),
);
const BoardTextConflictFixture = React.lazy(() =>
  import("./world/BoardView").then((module) => ({
    default: module.BoardTextConflictFixture,
  })),
);

const QuestionBacklogFixture = React.lazy(
  () => import("./testing/QuestionBacklogFixture"),
);
const SiblingQuestionsFixture = React.lazy(
  () => import("./testing/SiblingQuestionsFixture"),
);

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <pre
          style={{
            color: "#ff9a9a",
            padding: 20,
            whiteSpace: "pre-wrap",
            fontFamily: "monospace",
          }}
        >
          {this.state.error.message}
          {"\n\n"}
          {this.state.error.stack}
        </pre>
      );
    }
    return this.props.children;
  }
}

initializeLayoutPreferences();
initializeShortcutPreferences();
// Testing switches: read `?coreFixture`, `?coreInstall`,
// `?integrationsFixture` and `?moveBoardRefuses` before any view rewrites
// the URL; each drops its parameter at once.
coreFixtureEnabled();
coreInstallFake();
moveBoardRefuses();
integrationsFixtureEnabled();
const stopInstanceNameSync =
  siblingQuestionsFixture ||
  titleSpinnerFixture ||
  claudeTapLockFixture ||
  boardTextConflictFixture ||
  questionBacklogFixture
    ? () => {}
    : initializeInstanceName();
if (import.meta.hot) import.meta.hot.dispose(stopInstanceNameSync);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <React.Suspense fallback={null}>
        {questionBacklogFixture ? (
          <QuestionBacklogFixture />
        ) : siblingQuestionsFixture ? (
          <SiblingQuestionsFixture />
        ) : titleSpinnerFixture ? (
          <TitleSpinnerFixture />
        ) : claudeTapLockFixture ? (
          <ClaudeTapLockFixture />
        ) : boardTextConflictFixture ? (
          <BoardTextConflictFixture />
        ) : (
          <WorldFoundationApp />
        )}
      </React.Suspense>
      <OverlayScrollbarLayer />
    </ErrorBoundary>
  </React.StrictMode>,
);
