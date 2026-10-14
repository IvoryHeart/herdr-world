module runtime_drain {
  pure val BROKEN = false
  type Drain = { kind: int, cleanupFirst: bool, failed: bool, phase: str, gen: int, transportDone: bool, backgroundWait: bool, backgroundFailed: bool, backgroundDone: bool, cleanupDone: bool, readySeen: bool, stage: str }
  var drain: Drain
  var op: str
  action init = all {
    drain' = { kind: -1, cleanupFirst: false, failed: false, phase: "absent", gen: 0, transportDone: false, backgroundWait: false, backgroundFailed: false, backgroundDone: false, cleanupDone: false, readySeen: false, stage: "empty" }, op' = "init",
  }
  action choose = {
    nondet kind = 0.to(5).oneOf()
    nondet cleanupFirst = Set(false, true).oneOf()
    nondet failed = Set(false, true).oneOf()
    nondet backgroundWait = Set(false, true).oneOf()
    nondet backgroundFailed = Set(false, true).oneOf()
    all {
      Set("empty", "done").contains(drain.stage), kind != 5 or (not(cleanupFirst) and not(backgroundWait)), not(backgroundFailed) or backgroundWait,
      drain' = { kind: kind, cleanupFirst: cleanupFirst, failed: failed, phase: "connecting", gen: 1,
        transportDone: false, backgroundWait: backgroundWait, backgroundFailed: backgroundFailed, backgroundDone: false, cleanupDone: false, readySeen: false, stage: "starting" }, op' = "choose",
    }
  }
  action enterBackground = all {
    drain.stage == "starting", drain.backgroundWait, not(drain.transportDone),
    drain' = { ...drain, transportDone: true }, op' = "enterBackground",
  }
  action retire = all {
    drain.stage == "starting", not(drain.backgroundWait) or drain.transportDone,
    drain' = { ...drain, phase: if (drain.kind >= 4) "error" else "stopping",
      gen: if (drain.kind == 1) 3 else 2, transportDone: drain.transportDone or drain.kind == 5, stage: "draining" }, op' = "retire",
  }
  pure def finishedPhase(s) = if (s.kind == 2) "removed" else if (s.failed or s.kind >= 4) "error" else "disconnected"
  action finishFirst = all {
    drain.stage == "draining", drain.kind != 5,
    drain' = { ...drain, cleanupDone: drain.cleanupFirst, transportDone: drain.transportDone or not(drain.cleanupFirst), backgroundDone: drain.backgroundWait and not(drain.cleanupFirst),
      readySeen: BROKEN and not(drain.cleanupFirst) and not(drain.backgroundFailed), stage: "half" }, op' = "finishFirst",
  }
  action finishSecond = all {
    drain.stage == "half" or (drain.stage == "draining" and drain.kind == 5),
    drain' = { ...drain, cleanupDone: true, transportDone: true, backgroundDone: drain.backgroundWait,
      readySeen: drain.readySeen or (BROKEN and drain.kind != 5 and not(drain.backgroundFailed)),
      phase: finishedPhase(drain), stage: "done" }, op' = "finishSecond",
  }
  action step = any { choose, enterBackground, retire, finishFirst, finishSecond }
  val noRetiredReadiness = not(drain.readySeen)
  val drainBeforeRemoval = drain.phase != "removed" or (drain.transportDone and drain.cleanupDone and (not(drain.backgroundWait) or drain.backgroundDone))
  val safety = noRetiredReadiness and drainBeforeRemoval
  val replacedDuringStart = drain.stage == "done" and drain.kind == 1
  val removedDuringStart = drain.stage == "done" and drain.kind == 2
  val shutdownDuringStart = drain.stage == "done" and drain.kind == 3
  val currentErrorDuringStart = drain.stage == "done" and drain.kind == 4
  val failedStart = drain.stage == "done" and drain.kind == 5
  val cleanupBeforeTransport = drain.stage == "done" and drain.cleanupFirst
  val transportBeforeCleanup = drain.stage == "done" and not(drain.cleanupFirst)
  val retiredDuringBackground = drain.stage == "done" and drain.backgroundWait
  val failedBackground = drain.stage == "done" and drain.backgroundFailed
  val failedDrain = drain.stage == "done" and drain.failed
}
