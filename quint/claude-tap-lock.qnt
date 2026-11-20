module claude_tap_lock {
  var owner: int
  var phase: int
  var checked: bool
  var prepared: int
  var replacementDone: bool
  var reading: int
  var highest: int
  action init = all { owner' = 0, phase' = 0, checked' = false, prepared' = 0, replacementDone' = false, reading' = 20, highest' = 20 }
  action acquireAndRead = all {
    phase == 0, owner' = 1, phase' = 1, checked' = false,
    prepared' = if (reading > 22) reading else 22, replacementDone' = replacementDone, reading' = reading, highest' = highest,
  }
  action check = all {
    phase == 1, checked' = owner == 1, phase' = 2, owner' = owner,
    prepared' = prepared, replacementDone' = replacementDone, reading' = reading, highest' = highest,
  }
  // A can be paused after its check. B reclaims the aged token and commits.
  action reclaimAndCommit = all {
    not(replacementDone), owner' = 0, phase' = phase, checked' = checked,
    replacementDone' = true, prepared' = prepared, reading' = 23, highest' = 23,
  }
  action oldCommit = all {
    phase == 2, reading' = if (checked) prepared else reading,
    highest' = if (checked and prepared > highest) prepared else highest,
    owner' = if (owner == 1) 0 else owner, checked' = checked, phase' = 3,
    replacementDone' = replacementDone, prepared' = prepared,
  }
  action done = all { phase == 3, replacementDone, owner' = owner, phase' = phase, checked' = checked, reading' = reading, highest' = highest, replacementDone' = replacementDone, prepared' = prepared }
  action step = any { acquireAndRead, check, reclaimAndCommit, oldCommit, done }
  val safety = reading >= highest
}
