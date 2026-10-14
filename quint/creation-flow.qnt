module creation_flow {
  pure val BROKEN = false
  type Request = { phase: str, attempt: int, retained: bool, mutated: bool, intent: int, available: bool, admission: str, focus: int, finished: bool }
  var requests: List[Request]
  var live: List[bool]
  var intent: int
  var op: str
  var target: int
  pure val EMPTY = { phase: "idle", attempt: 0, retained: false, mutated: false, intent: -1, available: false, admission: "none", focus: 0, finished: true }
  action init = all { requests' = List(EMPTY, EMPTY), live' = List(true, true), intent' = 0, op' = "init", target' = -1 }
  action change(h, replacement, name) = all { requests' = requests.replaceAt(h, replacement), live' = live, intent' = intent, op' = name, target' = h }
  action start(h) = all { requests[h].phase == "idle", live[h], change(h, { ...requests[h], phase: "preparing", retained: true, intent: intent }, "start") }
  action duplicate(h) = all { Set("preparing", "dispatching").contains(requests[h].phase), change(h, requests[h], "duplicate") }
  action beginAttach(h) = all { requests[h].phase == "preparing", requests[h].attempt < 2, change(h, { ...requests[h], attempt: requests[h].attempt + 1 }, "beginAttach") }
  action oldAck(h) = all { requests[h].phase == "preparing", requests[h].attempt == 2, change(h, requests[h], "oldAck") }
  action attach(h) = all { requests[h].phase == "preparing", requests[h].attempt > 0, change(h, { ...requests[h], phase: "dispatching", mutated: true }, "attach") }
  action retireAtReady(h) = all {
    requests[h].phase == "preparing", requests[h].attempt > 0,
    requests' = requests.replaceAt(h, { ...requests[h], phase: "failed", retained: false }), live' = live.replaceAt(h, false), intent' = intent, op' = "retireAtReady", target' = h,
  }
  pure def retired(r) = { ...r, phase: if (r.phase == "preparing") "failed" else if (r.phase == "dispatching") "uncertain" else r.phase,
    retained: false, admission: if (Set("waiting", "opening").contains(r.admission)) "rejected" else r.admission }
  action retire(h) = all { live[h], requests' = requests.replaceAt(h, retired(requests[h])), live' = live.replaceAt(h, false), intent' = intent, op' = "retire", target' = h }
  action result(h) = all {
    requests[h].phase == "dispatching",
    change(h, { ...requests[h], phase: "created", retained: false,
      admission: if (live[h] and (requests[h].intent == intent or BROKEN)) "waiting" else "rejected" }, "result"),
  }
  action topology(h) = all { requests[h].admission == "waiting", change(h, { ...requests[h], available: true, admission: "opening", finished: false }, "topology") }
  action finishFocus(h) = all { Set("opening", "rejected").contains(requests[h].admission), not(requests[h].finished),
    change(h, { ...requests[h], finished: true, admission: if (requests[h].admission == "opening") "opened" else "rejected",
      focus: if (requests[h].admission == "opening") 1 else requests[h].focus }, "finishFocus") }
  action newIntent = all {
    intent < 2,
    requests' = List(0, 1).foldl(List(), (rs, h) => rs.append(if (Set("waiting", "opening").contains(requests[h].admission)) { ...requests[h], admission: "rejected" } else requests[h])),
    live' = live, intent' = intent + 1, op' = "newIntent", target' = -1,
  }
  action lateResult(h) = all { requests[h].phase == "uncertain", change(h, requests[h], "lateResult") }
  action step = {
    nondet h = Set(0, 1).oneOf()
    any { start(h), duplicate(h), beginAttach(h), oldAck(h), attach(h), retireAtReady(h), retire(h), result(h), topology(h), finishFocus(h), newIntent, lateResult(h) }
  }
  val sourceLifetime = requests.indices().forall(h => requests[h].retained == Set("preparing", "dispatching").contains(requests[h].phase))
  val focusAuthority = requests.indices().forall(h => not(Set("waiting", "opening").contains(requests[h].admission)) or (live[h] and requests[h].intent == intent))
  val readinessRetirement = op != "retireAtReady" or not(requests[target].mutated)
  val safety = sourceLifetime and focusAuthority and readinessRetirement
  val sourcePrepared = op == "attach"
  val lateAttachmentIgnored = op == "oldAck"
  val duplicateCoalesced = op == "duplicate"
  val readinessRetired = op == "retireAtReady"
  val uncertainDispatch = requests.indices().exists(h => requests[h].phase == "uncertain")
  val conditionalFocus = op == "finishFocus" and requests[target].focus == 1
  val newerIntent = requests.indices().exists(h => requests[h].phase == "created" and requests[h].admission == "rejected" and requests[h].intent != intent)
}
