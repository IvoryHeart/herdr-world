module runtime_control {
  pure val BROKEN = false
  pure val GENERATION_BOUND = 6
  type Control = { gen: int, phase: str, factory: int, runtimeFactory: int, runtimeGen: int, mode: str, blocked: bool }
  var control: Control
  var op: str
  action init = all {
    control' = { gen: 0, phase: "down", factory: 0, runtimeFactory: -1, runtimeGen: -1, mode: "none", blocked: false },
    op' = "init",
  }
  action change(replacement, name) = all { control' = replacement, op' = name }
  action start = all {
    control.phase == "down", not(control.blocked), control.gen < GENERATION_BOUND,
    change({ ...control, gen: control.gen + 1, runtimeGen: control.gen + 1,
      runtimeFactory: control.factory, phase: "ready" }, "start"),
  }
  action currentError = all {
    control.phase == "ready", control.gen < GENERATION_BOUND,
    change({ ...control, gen: if (BROKEN) control.gen else control.gen + 1,
      phase: if (BROKEN) "ready" else "error" }, "currentError"),
  }
  action stop = all {
    Set("ready", "error").contains(control.phase), control.runtimeFactory >= 0, control.gen < GENERATION_BOUND,
    change({ ...control, gen: control.gen + 1, phase: "stopping", mode: "stop" }, "stop"),
  }
  action replace = all {
    Set("down", "ready", "error").contains(control.phase), not(control.blocked),
    control.factory < 2, control.gen < GENERATION_BOUND - 1,
    change({ ...control, factory: control.factory + 1,
      gen: control.gen + (if (control.runtimeFactory == -1) 1 else 2),
      phase: if (control.runtimeFactory == -1) "down" else "stopping",
      mode: if (control.runtimeFactory == -1) "none" else "replace" }, "replace"),
  }
  action remove = all {
    Set("down", "ready", "error").contains(control.phase), not(control.blocked), control.gen < GENERATION_BOUND,
    change({ ...control, gen: control.gen + (if (control.runtimeFactory == -1) 0 else 1),
      phase: if (control.runtimeFactory == -1) "removed" else "stopping",
      mode: if (control.runtimeFactory == -1) "none" else "remove" }, "remove"),
  }
  action cleanup(failed) = all {
    control.phase == "stopping",
    change({ ...control, phase: if (control.mode == "remove") "removed" else if (failed) "error" else "down",
      runtimeFactory: -1, runtimeGen: -1, mode: "none" }, if (failed) "failCleanup" else "finishCleanup"),
  }
  action shutdown = all {
    not(control.blocked), Set("down", "ready", "error").contains(control.phase), control.gen < GENERATION_BOUND,
    change({ ...control, blocked: true,
      gen: control.gen + (if (control.runtimeFactory == -1) 0 else 1),
      phase: if (control.runtimeFactory == -1) "down" else "stopping",
      mode: if (control.runtimeFactory == -1) "none" else "shutdown" }, "shutdown"),
  }
  action duplicateStart = all { control.phase == "ready", not(control.blocked), change(control, "duplicateStart") }
  action duplicateStop = all { control.phase == "stopping", control.mode != "remove", change(control, "duplicateStop") }
  action deniedStart = all {
    control.blocked or control.phase == "removed" or control.mode == "remove",
    change(control, "deniedStart"),
  }
  action obsoleteError = all {
    control.runtimeGen >= 0, control.runtimeGen < control.gen, change(control, "obsoleteError"),
  }
  // Error with no retained runtime can be cleared without another retirement.
  action clearError = all {
    control.phase == "error", control.runtimeFactory == -1,
    change({ ...control, phase: "down" }, "clearError"),
  }
  action step = any { start, currentError, stop, replace, remove, cleanup(false), cleanup(true),
    shutdown, duplicateStart, duplicateStop, deniedStart, obsoleteError, clearError }
  val errorInvalidates = op != "currentError" or control.phase == "error"
  val readyAuthority = control.phase != "ready" or
    (control.runtimeGen == control.gen and control.runtimeFactory == control.factory and not(control.blocked))
  val removedOwnership = control.phase != "removed" or control.runtimeFactory == -1
  val safety = errorInvalidates and readyAuthority and removedOwnership
  val replaced = op == "replace"
  val removed = control.phase == "removed"
  val failedCleanup = op == "failCleanup"
  val stoppedAll = control.blocked
  val currentFailure = op == "currentError"
  val reentrantStart = op == "start"
  val reentrantStop = control.phase == "stopping"
  val duplicate = Set("duplicateStart", "duplicateStop").contains(op)
}
