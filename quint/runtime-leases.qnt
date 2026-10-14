module runtime_leases {
  pure val BROKEN = false
  pure val GENERATION_BOUND = 4
  type Host = { gen: int, startGen: int, phase: str, pending: bool, lease: int }
  var hosts: List[Host]
  var op: str
  var target: int
  var lateStartSeen: bool
  var obsoleteErrorSeen: bool

  action init = all {
    hosts' = List(
      { gen: 0, startGen: -1, phase: "down", pending: false, lease: -1 },
      { gen: 0, startGen: -1, phase: "down", pending: false, lease: -1 }),
    op' = "init", target' = -1,
    lateStartSeen' = false, obsoleteErrorSeen' = false,
  }
  action change(h, replacement, name) = all {
    hosts' = hosts.replaceAt(h, replacement), op' = name, target' = h,
    lateStartSeen' = lateStartSeen, obsoleteErrorSeen' = obsoleteErrorSeen,
  }
  action start(h) = all {
    hosts[h].phase == "down", hosts[h].gen < GENERATION_BOUND,
    change(h, { ...hosts[h], gen: hosts[h].gen + 1,
      startGen: hosts[h].gen + 1, phase: "starting", pending: true }, "start"),
  }
  action finishStart(h) = all {
    hosts[h].pending,
    hosts' = hosts.replaceAt(h, { ...hosts[h], pending: false,
      phase: if (hosts[h].phase == "starting" or BROKEN) "ready" else hosts[h].phase }),
    op' = "finishStart", target' = h,
    lateStartSeen' = (lateStartSeen or hosts[h].phase == "stopping"),
    obsoleteErrorSeen' = obsoleteErrorSeen,
  }
  action capture(h) = all {
    hosts[h].phase == "ready", hosts[h].lease != hosts[h].gen,
    change(h, { ...hosts[h], lease: hosts[h].gen }, "capture"),
  }
  action stop(h) = all {
    Set("starting", "ready").contains(hosts[h].phase), hosts[h].gen < GENERATION_BOUND,
    change(h, { ...hosts[h], gen: hosts[h].gen + 1, phase: "stopping" }, "stop"),
  }
  action finishStop(h) = all {
    hosts[h].phase == "stopping", not(hosts[h].pending),
    change(h, { ...hosts[h], phase: "down" }, "finishStop"),
  }
  action obsoleteError(h) = all {
    hosts[h].lease >= 0, hosts[h].lease != hosts[h].gen,
    hosts' = hosts, op' = "obsoleteError", target' = h,
    lateStartSeen' = lateStartSeen, obsoleteErrorSeen' = true,
  }
  action step = {
    nondet h = Set(0, 1).oneOf()
    any { start(h), finishStart(h), capture(h), stop(h), finishStop(h), obsoleteError(h) }
  }
  val readyMatchesStart = hosts.indices().forall(h =>
    hosts[h].phase != "ready" or hosts[h].gen == hosts[h].startGen)
  val pendingIsNotReady = hosts.indices().forall(h =>
    not(hosts[h].pending) or hosts[h].phase != "ready")
  val safety = readyMatchesStart and pendingIsNotReady
  val lateStart = lateStartSeen
  val obsoleteCallback = obsoleteErrorSeen
  val twoReady = hosts.indices().forall(h => hosts[h].phase == "ready")
}
