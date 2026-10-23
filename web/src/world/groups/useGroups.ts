import { useEffect, useMemo } from "react";
import { buildGroupViews } from "../../../../shared/groupViews";
import { sharedBoardStore, useBoardDocument } from "../board/boardDocument";
import { groupRuntimeObservations } from "../groupObservations";
import { useWorldRuntime } from "../runtimeStore";
import { useWorldSources } from "../worldSources";

/** One read model shared by the roster and spatial signs. */
export function useGroups() {
  const boardStore = sharedBoardStore();
  const board = useBoardDocument(boardStore);
  const runtime = useWorldRuntime();
  const sources = useWorldSources();
  useEffect(() => {
    boardStore.start();
    return () => {
      boardStore.stop();
    };
  }, [boardStore]);
  const observations = useMemo(
    () => groupRuntimeObservations(runtime.connections),
    [runtime.connections],
  );
  const groups = useMemo(
    () =>
      buildGroupViews(
        board.document?.relations?.groups ?? [],
        observations,
        sources,
      ),
    [board.document?.relations?.groups, observations, sources],
  );
  return { ...board, groups, observations, boardStore };
}
