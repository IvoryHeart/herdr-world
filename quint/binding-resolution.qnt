module binding_resolution {
  pure val BROKEN = false
  var binding: { policy: str, native: int, witness: int, state: str,
    source: int, terminal: int, present: bool, duplicate: bool, health: str,
    gen: int, inc: int, lost: bool, followedLost: bool, endedByListing: bool, allowed: bool, absenceSafe: bool, retargetSafe: bool, preserved: bool }
  var op: str
  action init = {
    nondet policy = Set("board", "appearance").oneOf()
    all { binding' = { policy: policy, native: 0, witness: 0, state: "unresolved",
      source: 0, terminal: 0, present: true, duplicate: false, health: "current",
      gen: 1, inc: 0, lost: false, followedLost: false, endedByListing: false, allowed: false, absenceSafe: true, retargetSafe: true, preserved: true }, op' = "init" }
  }
  def invalidated = { ...binding, state: if (binding.state == "ended") "ended" else "unresolved", allowed: false,
    absenceSafe: true, retargetSafe: true, preserved: true, followedLost: false, endedByListing: false }
  action observeComplete = {
    val sameTerminal = binding.present and binding.terminal == binding.witness
    val exact = sameTerminal and binding.source == binding.native
    val absent = not(binding.present) or binding.terminal != binding.witness
    val badAbsence = BROKEN and binding.policy == "board" and (not(binding.present) or binding.source != binding.native)
    val ended = binding.policy == "appearance" and absent or badAbsence
    val state = if (binding.state == "ended") "ended" else
      if (binding.duplicate) "unresolved" else
      if (exact or (binding.policy == "appearance" and sameTerminal)) "attached" else
      if (ended) "ended" else
      if (binding.present and binding.source == binding.native) "unconfirmed" else "unresolved"
    val native = if (state == "attached") binding.source else binding.native
    all {
      binding' = { ...binding, health: "current", state: state, native: native, allowed: state == "attached",
        followedLost: binding.lost and binding.policy == "appearance" and state == "attached" and native != binding.native,
        endedByListing: binding.state != "ended" and state == "ended" and binding.policy == "appearance" and absent and not(binding.duplicate),
        absenceSafe: state != "ended" or binding.state == "ended" or (binding.policy == "appearance" and absent),
        retargetSafe: native == binding.native or (binding.policy == "appearance" and sameTerminal and not(binding.duplicate)),
        preserved: state != "unresolved" or native == binding.native }, op' = "observeComplete"
    }
  }
  action observePartial = all { binding' = { ...invalidated, health: "partial" }, op' = "observePartial" }
  action offline = all { binding' = { ...invalidated, health: "offline" }, op' = "offline" }
  action herdrRestart = all { binding.gen == 1,
    binding' = { ...invalidated, gen: 2, source: 0, terminal: 1 - binding.witness, present: true, duplicate: false, health: "partial" },
    op' = "herdrRestart" }
  action worldRestart = all { binding.inc == 0,
    binding' = { ...invalidated, inc: 1, health: "partial" }, op' = "worldRestart" }
  action moveByWorld = all { binding.health == "current", binding.present, not(binding.duplicate),
    binding.state != "ended", binding.source == binding.native, binding.terminal == binding.witness,
    binding' = { ...binding, native: 1 - binding.source, source: 1 - binding.source, state: "attached", allowed: true,
      absenceSafe: true, retargetSafe: true, preserved: true }, op' = "moveByWorld" }
  action moveReplyLost = all { binding.health == "current", binding.present, not(binding.duplicate),
    binding' = { ...invalidated, source: 1 - binding.source, lost: true }, op' = "moveReplyLost" }
  action moveOutside = all { binding.health == "current", binding.present,
    binding' = { ...invalidated, source: 1 - binding.source }, op' = "moveOutside" }
  action closeObserved = all { binding.health == "current", binding.present, not(binding.duplicate),
    val ended = binding.state == "ended" or (binding.policy == "board" and binding.source == binding.native)
    binding' = { ...invalidated, present: false, duplicate: false, state: if (ended) "ended" else "unresolved" },
    op' = "closeObserved" }
  action notFound = all { binding.health == "current", not(binding.duplicate), not(binding.present) or binding.source != binding.native,
    binding' = { ...invalidated, state: if (binding.state == "ended" or binding.policy == "board") "ended" else "unresolved" }, op' = "notFound" }
  action duplicate = all { binding.present, not(binding.duplicate),
    binding' = { ...invalidated, duplicate: true }, op' = "duplicate" }
  action userKeep = all { binding.health == "current", binding.present, not(binding.duplicate),
    binding' = { ...invalidated, native: binding.source, witness: binding.terminal, state: "unresolved" }, op' = "userKeep" }
  action userDetach = all { binding' = { ...invalidated, state: "ended" }, op' = "userDetach" }
  action lookAlike = all { binding.present,
    binding' = { ...invalidated, source: binding.native, terminal: 1 - binding.witness, duplicate: false }, op' = "lookAlike" }
  action step = any { observeComplete, observePartial, offline, herdrRestart, worldRestart,
    moveByWorld, moveReplyLost, moveOutside, closeObserved, notFound, duplicate, userKeep, userDetach, lookAlike }

  val noUnverifiedRetarget = binding.retargetSafe
  val absenceOnlyDeclared = binding.absenceSafe
  val reuseNeverAttaches = binding.state != "attached" or (binding.present and binding.terminal == binding.witness and binding.source == binding.native)
  val ambiguousNeverAttaches = not(binding.duplicate) or binding.state != "attached"
  val unresolvedPreserves = binding.preserved
  val onlyAttachedActs = not(binding.allowed) or (binding.state == "attached" and binding.health == "current" and not(binding.duplicate))
  val safety = noUnverifiedRetarget and absenceOnlyDeclared and reuseNeverAttaches and ambiguousNeverAttaches and unresolvedPreserves and onlyAttachedActs
  val restartUnconfirmed = op == "observeComplete" and binding.policy == "board" and binding.gen == 2 and binding.state == "unconfirmed"
  val worldRestartReattached = op == "observeComplete" and binding.inc == 1 and binding.state == "attached"
  val partialKept = op == "observePartial" and binding.state == "unresolved"
  val closeEnded = op == "closeObserved" and binding.policy == "board" and binding.state == "ended"
  val allTerminalsGoneEnded = op == "observeComplete" and binding.endedByListing
  val moveFollowed = op == "moveByWorld" and binding.state == "attached"
  val lostReplyFollowedByTerminal = op == "observeComplete" and binding.followedLost
  val outsideMoveUnresolved = op == "observeComplete" and binding.policy == "board" and binding.present and binding.terminal == binding.witness and binding.source != binding.native and binding.state == "unresolved"
  val duplicateUnresolved = op == "observeComplete" and binding.duplicate and binding.state == "unresolved"
  val lookAlikeRejected = op == "observeComplete" and binding.present and binding.source == binding.native and binding.terminal != binding.witness and binding.state != "attached"
}
