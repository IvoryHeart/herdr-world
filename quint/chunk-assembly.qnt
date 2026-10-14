module chunk_assembly {
  pure val BROKEN = false
  type Cell = { phase: str, next: int, ordinal: int, epoch: int, decoded: bool, finished: bool, aborted: bool }
  var cells: List[Cell]
  var epoch: int
  var connected: bool
  var calls: int
  var op: str
  var target: int
  var acceptedOld: bool
  pure val EMPTY = { phase: "empty", next: 0, ordinal: 0, epoch: 0, decoded: false, finished: true, aborted: false }
  action init = all {
    cells' = List(EMPTY, EMPTY), epoch' = 0, connected' = true, calls' = 0,
    op' = "init", target' = -1, acceptedOld' = false,
  }
  action change(h, cell, name) = all {
    cells' = cells.replaceAt(h, cell), epoch' = epoch, connected' = connected,
    calls' = calls, op' = name, target' = h, acceptedOld' = false,
  }
  action call(h) = all {
    connected, calls < 4, Set("empty", "done", "failed").contains(cells[h].phase), cells[h].finished,
    cells' = cells.replaceAt(h, { phase: "collecting", next: 0, ordinal: calls + 1, epoch: epoch, decoded: false, finished: true, aborted: false }),
    epoch' = epoch, connected' = connected, calls' = calls + 1, op' = "call", target' = h, acceptedOld' = false,
  }
  action fragment(h) = all {
    cells[h].phase == "collecting",
    val nextIndex = cells[h].next + 1
    change(h, { ...cells[h], next: nextIndex, phase: if (nextIndex == 3) "decoding" else "collecting",
      decoded: nextIndex == 3, finished: nextIndex != 3 }, "fragment"),
  }
  action invalid(h, name) = all {
    Set("collecting", "decoding").contains(cells[h].phase),
    name != "duplicate" or cells[h].next > 0,
    name != "wrongTotal" or (cells[h].phase == "collecting" and cells[h].next > 0),
    change(h, { ...cells[h], phase: "failed", aborted: cells[h].decoded }, name),
  }
  action finishDecode(h) = all {
    cells[h].decoded, not(cells[h].finished),
    change(h, { ...cells[h], finished: true, phase: if (cells[h].phase == "decoding") "done" else cells[h].phase }, "finishDecode"),
  }
  action disconnect = all {
    connected, epoch < 2,
    cells' = List(0, 1).foldl(List(), (xs, h) => xs.append(if (Set("collecting", "decoding").contains(cells[h].phase))
      { ...cells[h], phase: "failed", aborted: cells[h].decoded } else cells[h])),
    epoch' = epoch + 1, connected' = false, calls' = calls, op' = "disconnect", target' = -1, acceptedOld' = false,
  }
  action reconnect = all {
    not(connected), cells' = cells, epoch' = epoch, connected' = true, calls' = calls,
    op' = "reconnect", target' = -1, acceptedOld' = false,
  }
  // Final old-socket fragment has an immediate public decode-start observation.
  action oldSocket(h) = all {
    connected, epoch > 0, cells[h].phase == "collecting", cells[h].next == 2,
    cells' = if (BROKEN) cells.replaceAt(h, { ...cells[h], next: 3, decoded: true, finished: false, phase: "decoding" }) else cells,
    epoch' = epoch, connected' = connected, calls' = calls, op' = "oldSocket", target' = h, acceptedOld' = BROKEN,
  }
  action step = {
    nondet h = Set(0, 1).oneOf()
    any { call(h), fragment(h), invalid(h, "duplicate"), invalid(h, "wrongTotal"),
      invalid(h, "outOfOrder"), invalid(h, "qualifiedChunk"), finishDecode(h), disconnect, reconnect, oldSocket(h) }
  }
  val noOldSocket = not(acceptedOld)
  val completeBeforePublish = cells.indices().forall(h => cells[h].phase != "done" or (cells[h].next == 3 and cells[h].finished and not(cells[h].aborted)))
  val currentPublication = cells.indices().forall(h => cells[h].phase != "decoding" or cells[h].epoch == epoch)
  val safety = noOldSocket and completeBeforePublish and currentPublication
  val completed = op == "finishDecode" and cells[target].phase == "done"
  val cancelledDecode = op == "finishDecode" and cells[target].aborted
  val malformedRejected = Set("duplicate", "wrongTotal", "outOfOrder", "qualifiedChunk").contains(op)
  val parallelCalls = cells.indices().forall(h => Set("collecting", "decoding").contains(cells[h].phase))
  val oldSocketIgnored = op == "oldSocket" and not(acceptedOld)
}
