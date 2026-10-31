module effect_recovery {
  pure val BROKEN = false
  type Effect = { recovery: str, phase: str, resume: str, attempt: int, ever: bool, applied: int, receipt: bool, handle: bool, authorized: bool, cancelled: bool, binding: str, version: int, supported: int, owner: bool, peerClaimed: bool, peerAttempt: int }
  var effect: Effect
  var incarnation: int
  var op: str
  action init = {
    nondet recovery = Set("keyed", "reconcilable", "reattachable", "repeatable", "opaque").oneOf()
    all { effect' = { recovery: recovery, phase: "pending", resume: "pending", attempt: 0, ever: false, applied: 0, receipt: false, handle: false, authorized: true, cancelled: false, binding: "attached", version: 1, supported: 1, owner: false, peerClaimed: false, peerAttempt: 0 }, incarnation' = 1, op' = "init" }
  }
  action change(replacement, name) = all { effect' = replacement, incarnation' = incarnation, op' = name }
  val ready = effect.phase == "pending" and effect.attempt == 0 and not(effect.cancelled) and effect.version == effect.supported
  val admission = effect.authorized and effect.binding == "attached"
  action claimCrash = all { ready, change({ ...effect, phase: "claimed", attempt: 1 }, "claimCrash") }
  action dispatchCrash = all { ready, admission, change({ ...effect, phase: "dispatching", attempt: 1, ever: true, handle: effect.recovery == "reattachable" }, "dispatchCrash") }
  action sourceCrash = all { ready, admission, change({ ...effect, phase: "source", attempt: 1, ever: true, applied: 1, handle: effect.recovery == "reattachable" }, "sourceCrash") }
  action receipt = all { effect.phase == "source", change({ ...effect, phase: "delivered", receipt: true }, "receipt") }
  action crash = all {
    incarnation == 1, Set("claimed", "dispatching", "source").contains(effect.phase),
    effect' = { ...effect, phase: if (effect.phase == "claimed") "pending" else "uncertain", peerClaimed: false }, incarnation' = 2, op' = "crash",
  }
  action offline = all { effect.binding == "attached", effect.phase != "delivered", change({ ...effect, binding: "unresolved" }, "offline") }
  action attach = all { effect.binding == "unresolved", change({ ...effect, binding: "attached" }, "attach") }
  action gone = all { effect.binding != "ended", effect.phase != "delivered", change({ ...effect, binding: "ended" }, "gone") }
  action cancel = all { not(effect.cancelled), not(Set("claimed", "delivered", "refused", "cancelled").contains(effect.phase)), change({ ...effect, cancelled: true, resume: if (effect.ever) "uncertain" else "cancelled", phase: if (not(effect.ever)) "cancelled" else if (effect.phase == "pending") "uncertain" else effect.phase }, "cancel") }
  action revoke = all { effect.authorized, effect.phase != "delivered", change({ ...effect, authorized: false }, "revoke") }
  action upgrade = all { effect.supported == 1, not(Set("claimed", "dispatching", "source").contains(effect.phase)), change({ ...effect, supported: 2, peerClaimed: false, resume: effect.phase, phase: if (effect.phase == "pending" or effect.phase == "uncertain") "needs-migration" else effect.phase }, "upgrade") }
  action migrate = all { effect.version != effect.supported, change({ ...effect, version: effect.supported, phase: if (effect.phase == "needs-migration") effect.resume else effect.phase }, "migrate") }
  action ownerDecision = all { effect.phase == "uncertain", effect.recovery == "opaque", not(effect.owner), change({ ...effect, owner: true, cancelled: false, phase: "pending" }, "ownerDecision") }
  action permanent = all { ready, admission, change({ ...effect, phase: "refused", attempt: 1, ever: true, handle: effect.recovery == "reattachable" }, "permanent") }
  action peerClaim = all { effect.supported == 1, not(effect.peerClaimed), effect.peerAttempt < 2, change({ ...effect, peerClaimed: true, peerAttempt: effect.peerAttempt + 1 }, "peerClaim") }
  action duplicateClaim = all { effect.peerClaimed, change(effect, "duplicateClaim") }
  action recover = all {
    Set("pending", "uncertain").contains(effect.phase), effect.attempt < 2, effect.version == effect.supported,
    val observing = effect.ever and (effect.recovery == "reconcilable" or effect.recovery == "reattachable")
    val opaque = effect.phase == "uncertain" and effect.recovery == "opaque" and not(effect.owner)
    val noClaim = (opaque and not(BROKEN)) or (effect.cancelled and not(observing))
    val known = observing and effect.applied > 0 and effect.binding == "attached"
    val blocked = effect.cancelled or not(effect.authorized) or effect.binding != "attached" or (effect.ever and effect.recovery == "reattachable")
    val send = not(noClaim) and not(known) and not(blocked)
    val done = known or send
    val nextPhase = if (noClaim) effect.phase else if (done) "delivered" else if (effect.ever) "uncertain" else if (effect.binding == "unresolved" and effect.authorized) "pending" else "refused"
    change({ ...effect, phase: nextPhase, attempt: if (noClaim) effect.attempt else effect.attempt + 1, ever: effect.ever or send, applied: if (send and (effect.recovery != "keyed" or effect.applied == 0)) effect.applied + 1 else effect.applied, receipt: effect.receipt or done, handle: effect.handle or (send and effect.recovery == "reattachable") }, "recover"),
  }
  action step = any { claimCrash, dispatchCrash, sourceCrash, sourceCrash, sourceCrash, sourceCrash, sourceCrash, sourceCrash, sourceCrash, sourceCrash, crash, crash, crash, crash, crash, crash, crash, crash, recover, recover, recover, recover, recover, recover, recover, recover, receipt, offline, attach, gone, cancel, revoke, upgrade, migrate, ownerDecision, permanent, peerClaim, duplicateClaim }
  val automaticDuplicates = effect.applied <= 1 or effect.recovery == "repeatable" or effect.owner
  val receiptRequiresEffect = not(effect.receipt) or effect.applied > 0
  val safety = automaticDuplicates and receiptRequiresEffect
  val keyedRetry = effect.recovery == "keyed" and effect.phase == "delivered" and effect.attempt == 2
  val reconciled = effect.recovery == "reconcilable" and effect.phase == "delivered" and effect.attempt == 2
  val reattached = effect.recovery == "reattachable" and effect.phase == "delivered" and effect.attempt == 2
  val repeated = effect.recovery == "repeatable" and effect.applied == 2
  val opaqueStopped = effect.recovery == "opaque" and effect.phase == "uncertain"
  val claimReleased = incarnation == 2 and not(effect.ever) and effect.phase == "pending"
  val permanentRefusal = effect.phase == "refused"
  val migrationBlocked = effect.phase == "needs-migration"
  val migrated = effect.version == 2
  val cancelBefore = effect.cancelled and not(effect.ever)
  val cancelAfter = effect.cancelled and effect.receipt
  val revoked = not(effect.authorized) and effect.phase == "refused"
  val offlineWaits = effect.binding == "unresolved" and effect.phase == "pending" and effect.attempt > 0
  val goneAfterDispatch = effect.binding == "ended" and effect.phase == "uncertain"
  val peerFenced = op == "duplicateClaim"
}
