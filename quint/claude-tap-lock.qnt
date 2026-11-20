module claude_tap_lock {
  // Four suspension boundaries, two processes, one comparable reset window.
  // Death is irreversible. Age alone gives no authority to reclaim a live PID.
  pure val STEAL_LIVE = false
  var boundary: int
  var stopped: bool
  var pc: int
  var contended: bool
  var owner: int
  var prepared: int
  var checked: bool
  var commits: List[int]
  action init = {
    nondet pause = 0.to(3).oneOf()
    nondet dies = Set(false, true).oneOf()
    all { boundary' = pause, stopped' = dies, pc' = 0, contended' = false,
      owner' = 0, prepared' = 0, checked' = false, commits' = [20] }
  }
  val reading = commits[commits.length() - 1]
  val atBoundary = (boundary == 0 and pc == 0) or (boundary == 1 and pc == 1)
    or (boundary == 2 and pc == 3) or (boundary == 3 and pc == 4)
  action contender = {
    // B acquires only an unowned lock or one whose process is confirmed dead.
    val admitted = owner == 0 or stopped or STEAL_LIVE
    all {
    not(contended), atBoundary,
    commits' = if (admitted) commits.append(if (reading > 23) reading else 23) else commits,
    owner' = if (admitted) 0 else owner,
    pc' = if (stopped) 5 else pc, contended' = true,
    boundary' = boundary, stopped' = stopped, prepared' = prepared, checked' = checked,
  }
  }
  action acquireRead = all {
    pc == 0, not(atBoundary) or contended,
    owner' = 1, prepared' = if (reading > 22) reading else 22, pc' = 1,
    boundary' = boundary, stopped' = stopped, contended' = contended, checked' = checked, commits' = commits,
  }
  action prepare = all {
    pc == 1, not(atBoundary) or contended, pc' = 2,
    boundary' = boundary, stopped' = stopped, contended' = contended, owner' = owner,
    prepared' = prepared, checked' = checked, commits' = commits,
  }
  action check = all {
    pc == 2, checked' = owner == 1, pc' = 3,
    boundary' = boundary, stopped' = stopped, contended' = contended, owner' = owner, prepared' = prepared, commits' = commits,
  }
  action publish = all {
    pc == 3, not(atBoundary) or contended,
    // No second check here: exclusive ownership must cover the rename itself.
    commits' = if (checked) commits.append(prepared) else commits, pc' = 4,
    boundary' = boundary, stopped' = stopped, contended' = contended, owner' = owner, prepared' = prepared, checked' = checked,
  }
  action release = all {
    pc == 4, not(atBoundary) or contended, owner' = 0, pc' = 5,
    boundary' = boundary, stopped' = stopped, contended' = contended, prepared' = prepared, checked' = checked, commits' = commits,
  }
  action retry = all {
    pc == 5, commits' = commits.append(if (reading > 23) reading else 23), pc' = 6,
    boundary' = boundary, stopped' = stopped, contended' = contended, owner' = owner, prepared' = prepared, checked' = checked,
  }
  action done = all {
    pc == 6, pc' = pc, boundary' = boundary, stopped' = stopped, contended' = contended,
    owner' = owner, prepared' = prepared, checked' = checked, commits' = commits,
  }
  action step = any { contender, acquireRead, prepare, check, publish, release, retry, done }
  val safety = commits.indices().forall(i => i == 0 or commits[i] >= commits[i - 1])
}
