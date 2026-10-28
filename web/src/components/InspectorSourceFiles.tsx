import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ConnectionClient } from "../api";
import type { AgentWorktreeView } from "../useAgentWorktree";
import {
  SourceFileLinkContext,
  parseSourceFileLink,
  sourceFileWithinWorktree,
} from "../sourceFileLinks";
import { requestFilePreview } from "./fileExplorerResources";
import type { ActiveFilePreviewSelection } from "./FilePreviewContent";

export type InspectorSourceFilesProps = {
  client: ConnectionClient;
  worktree?: AgentWorktreeView;
  paneId: string;
  sessionFingerprint?: string;
  workspaceId: string;
  previewRequestRef: React.MutableRefObject<number>;
  onSelection?: (selection: ActiveFilePreviewSelection) => void;
  onOpen(): void;
  onChoose(): void;
};

/** A Chat link can use only this Inspector's currently admitted resource binding. */
export function InspectorSourceFiles({
  source,
  children,
}: {
  source: InspectorSourceFilesProps;
  children: ReactNode;
}) {
  const { client, worktree } = source;
  const identity = JSON.stringify([
    client.connectionId,
    client.generation,
    client.serverRuntimeGeneration,
    source.workspaceId,
    source.paneId,
    source.sessionFingerprint,
    worktree?.target,
    worktree?.selected?.canonicalRoot,
  ]);
  const binding = useMemo(() => Symbol(identity), [identity]);
  const [noticeState, setNoticeState] = useState<{
    binding: symbol;
    message: string;
  } | null>(null);
  const notice = noticeState?.binding === binding ? noticeState.message : "";
  const setNotice = (message: string) => setNoticeState({ binding, message });
  const current = useRef<typeof binding | null>(binding);
  current.current = binding;
  useLayoutEffect(() => {
    current.current = binding;
    return () => {
      if (current.current === binding) current.current = null;
    };
  }, [binding]);
  const navigate = (href: string) => {
    const parsed = parseSourceFileLink(href);
    const target = worktree?.target;
    if (!client.isCurrent() || current.current !== binding) {
      setNotice(
        "This source link is unavailable because its host or worktree changed. Refresh or choose a worktree.",
      );
      return;
    }
    if (!target || !worktree?.selected || !source.onSelection) {
      setNotice(
        "Choose a current agent worktree before opening this source link.",
      );
      return;
    }
    if (
      target.subject.connectionId !== client.connectionId ||
      target.subject.generation !== client.serverRuntimeGeneration ||
      target.subject.paneId !== source.paneId ||
      target.subject.sessionFingerprint !==
        (source.sessionFingerprint ?? null) ||
      target.candidateId !== worktree.selected.candidateId ||
      JSON.stringify(client.agentWorktree) !== JSON.stringify(target)
    ) {
      setNotice(
        "This source link is unavailable for the current agent. Refresh or choose a worktree.",
      );
      return;
    }
    const link =
      parsed &&
      sourceFileWithinWorktree(worktree.selected.canonicalRoot, parsed);
    if (!link) {
      setNotice(
        "This source link is outside the selected worktree or has an unsupported location. Choose its worktree and try again.",
      );
      return;
    }
    setNotice("");
    const name = link.path.split("/").pop()!;
    const selection: ActiveFilePreviewSelection = {
      entry: {
        path: link.path,
        name,
        type: "file",
        size: 0,
        mtime_ms: 0,
        hidden: name.startsWith("."),
      },
      preview: null,
      loading: true,
      error: null,
      line: link.line,
      fragment: link.fragment,
    };
    const request = ++source.previewRequestRef.current;
    source.onSelection(selection);
    source.onOpen();
    const admitted = () =>
      client.isCurrent() &&
      current.current === binding &&
      source.previewRequestRef.current === request;
    void requestFilePreview(source.workspaceId, link.path, {
      client,
      refresh: true,
    })
      .then((preview) => {
        if (admitted())
          source.onSelection?.({ ...selection, preview, loading: false });
      })
      .catch((error: unknown) => {
        if (admitted())
          source.onSelection?.({
            ...selection,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
      });
  };
  return (
    <SourceFileLinkContext.Provider value={navigate}>
      {notice ? (
        <div className="workspace-inspector-unavailable" role="alert">
          <span>{notice}</span>
          <button type="button" onClick={source.onChoose}>
            Choose a worktree
          </button>
        </div>
      ) : null}
      {children}
    </SourceFileLinkContext.Provider>
  );
}
