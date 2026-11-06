module observation_base {
  pure val BROKEN = false
  pure def pair(f) = [f(0), f(1)]
  var s: { inc: int, gen: List[int], token: List[int], epoch: int,
    heldInc: int, contentInc: List[int], heldGen: List[int], heldToken: List[int], live: List[bool], actionable: List[bool],
    phase: str, issued: int, captured: int, baseInc: int, baseGen: List[int], baseToken: List[int],
    replyInc: int, replyGen: List[int], replyToken: List[int], confirms: List[bool],
    fresh: bool, validConfirmation: bool }
  var outcome: str
  var op: str
  var host: int
  action init = all {
    s' = { inc: 0, gen: [1, 1], token: [0, 0], epoch: 0,
      heldInc: -1, contentInc: [-1, -1], heldGen: [-1, -1], heldToken: [-1, -1], live: [true, true], actionable: [false, false],
      phase: "idle", issued: 0, captured: -1, baseInc: -1, baseGen: [-1, -1], baseToken: [-1, -1],
      replyInc: -1, replyGen: [-1, -1], replyToken: [-1, -1], confirms: [false, false],
      fresh: true, validConfirmation: true },
    op' = "init", host' = -1, outcome' = "none",
  }
  // Source updates linearize before the reply. Retirement after it is the
  // separate browserRetire action; drop commutes with reply construction.
  action change(h: int): bool = all { s.phase == "requested", s.token[h] < 2,
    s' = { ...s, token: s.token.replaceAt(h, s.token[h] + 1) }, op' = "change", host' = h, outcome' = "none" }
  action retire(h: int): bool = all { s.phase == "requested", s.gen[h] == 1,
    s' = { ...s, gen: s.gen.replaceAt(h, 2), token: s.token.replaceAt(h, 0),
      live: s.live.replaceAt(h, true), actionable: s.actionable.replaceAt(h, false) }, op' = "retire", host' = h, outcome' = "none" }
  action browserRetire(h: int): bool = all { s.phase != "idle", s.live[h],
    s' = { ...s, live: s.live.replaceAt(h, false), actionable: s.actionable.replaceAt(h, false) },
    op' = "browserRetire", host' = h, outcome' = "none" }
  action drop(h: int): bool = all { s.phase == "replied", s.heldGen[h] > 0,
    s' = { ...s, heldGen: s.heldGen.replaceAt(h, -1), heldToken: s.heldToken.replaceAt(h, -1),
      actionable: s.actionable.replaceAt(h, false) }, op' = "drop", host' = h, outcome' = "none" }
  action restart = all { s.inc == 0, s.epoch < 2,
    s' = { ...s, inc: 1, gen: [1, 1], token: [0, 0], epoch: s.epoch + 1,
      live: [true, true], actionable: [false, false] }, op' = "restart", host' = -1, outcome' = "none" }
  action disconnect = all { s.epoch < 2,
    s' = { ...s, epoch: s.epoch + 1, actionable: [false, false] }, op' = "disconnect", host' = -1, outcome' = "none" }
  action request = all { s.phase == "idle", s.issued < 6,
    s' = { ...s, phase: "requested", issued: s.issued + 1, captured: s.epoch,
      baseInc: s.heldInc, baseGen: pair(h => if (s.heldGen[h] == s.gen[h]) s.heldGen[h] else -1),
      baseToken: pair(h => if (s.heldGen[h] == s.gen[h]) s.heldToken[h] else -1) }, op' = "request", host' = -1, outcome' = "none" }
  action reply = all { s.phase == "requested",
    val confirmations = pair(h => s.baseInc == s.inc and s.baseToken[h] == s.token[h] and
      (s.baseGen[h] == s.gen[h] or BROKEN))
    s' = { ...s, phase: "replied", replyInc: s.inc, replyGen: s.gen, replyToken: s.token,
      confirms: confirmations }, op' = "reply", host' = -1, outcome' = "none" }
  action apply = all { s.phase == "replied",
    val admit = s.captured == s.epoch
    val missing = Set(0, 1).exists(h => s.confirms[h] and s.heldGen[h] < 0)
    val generation = if (missing) s.gen else pair(h => if (s.confirms[h]) s.heldGen[h] else s.replyGen[h])
    val tokens = if (missing) s.token else pair(h => if (s.confirms[h]) s.heldToken[h] else s.replyToken[h])
    all {
    not(admit and missing) or s.issued < 6,
    s' = { ...s, issued: s.issued + (if (admit and missing) 1 else 0), phase: "idle", heldInc: if (admit) (if (missing) s.inc else s.replyInc) else s.heldInc,
      contentInc: if (admit) pair(h => if (missing) s.inc else if (s.confirms[h]) s.contentInc[h] else s.replyInc) else s.contentInc,
      heldGen: if (admit) generation else s.heldGen, heldToken: if (admit) tokens else s.heldToken,
      actionable: if (admit) pair(h => s.live[h] and generation[h] == s.gen[h]) else s.actionable,
      captured: -1, baseInc: -1, baseGen: [-1, -1], baseToken: [-1, -1],
      replyInc: -1, replyGen: [-1, -1], replyToken: [-1, -1], confirms: [false, false],
      fresh: not(admit) or (generation == (if (missing) s.gen else s.replyGen) and tokens == (if (missing) s.token else s.replyToken)),
      validConfirmation: not(admit) or Set(0, 1).forall(h => generation[h] > 0) },
    op' = "apply", host' = -1,
    outcome' = if (not(admit)) "ignored" else if (missing) "discarded" else
      if (s.heldInc >= 0 and s.heldInc != s.replyInc) "restarted" else
      if (Set(0, 1).exists(h => s.confirms[h] and not(s.live[h]))) "retired" else
      if (s.confirms[0] != s.confirms[1]) "replaced" else
      if (s.confirms == [true, true]) "unchanged" else "complete",
    },
  }

  action step = any { nondet h = Set(0, 1).oneOf()
    any { change(h), retire(h), browserRetire(h), drop(h) }, restart, disconnect, request, reply, apply }
  val replyEqualsFresh = s.fresh
  val noResurrection = Set(0, 1).forall(h => not(s.actionable[h]) or (s.live[h] and s.heldGen[h] == s.gen[h]))
  val incarnationReset = Set(0, 1).forall(h => s.heldGen[h] < 0 or s.contentInc[h] == s.heldInc)
  val confirmationHeld = s.validConfirmation
  val safety = replyEqualsFresh and noResurrection and incarnationReset and confirmationHeld
  val unchangedSkip = op == "apply" and outcome == "unchanged"
  val oneHostReplaced = op == "apply" and outcome == "replaced"
  val incarnationChanged = op == "apply" and outcome == "restarted"
  val retiredDuringRequest = op == "apply" and outcome == "retired"
  val discardedConfirmation = op == "apply" and outcome == "discarded"
}
