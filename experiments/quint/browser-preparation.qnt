module browser_preparation {
  pure val BROKEN = false
  type Preparation = { epoch: int, captured: int, stage: str, issued: int, revision: int,
    published: int, status: str, catalogue: bool, queued: bool, selected: int, requested: int, live: List[bool], actionable: List[bool] }
  var preparation: Preparation
  var op: str
  var target: int
  action init = all {
    preparation' = { epoch: 0, captured: -1, stage: "idle", issued: 0, revision: 0,
      published: -1, status: "idle", catalogue: false, queued: false, selected: -1, requested: -1, live: List(true, true), actionable: List(false, false) },
    op' = "init", target' = -1,
  }
  action change(replacement, name) = all { preparation' = replacement, op' = name, target' = -1 }
  action request = all {
    preparation.stage == "idle", preparation.issued < 3,
    change({ ...preparation, captured: preparation.epoch, requested: preparation.selected, stage: "request", issued: preparation.issued + 1,
      status: if (preparation.status == "idle") "loading" else preparation.status }, "request"),
  }
  pure def completed(s) = if (s.queued) { ...s, stage: "request", issued: s.issued + 1,
    captured: s.epoch, requested: s.selected, queued: false } else { ...s, stage: "idle" }
  action priority(h) = all {
    preparation.stage != "idle", preparation.captured == preparation.epoch,
    preparation.issued < 3, preparation.selected != h,
    preparation' = { ...preparation, selected: h, queued: true }, op' = "priority", target' = h,
  }
  action advance(from, towards, name) = all {
    preparation.stage == from,
    change(if (preparation.captured == preparation.epoch) { ...preparation, stage: towards } else completed(preparation), name),
  }
  action admit = all {
    preparation.stage == "admission",
    val current = preparation.captured == preparation.epoch or BROKEN
    change(if (current) completed({ ...preparation, catalogue: true, status: "ready",
      published: preparation.captured, revision: preparation.issued, actionable: preparation.live })
      else completed(preparation), "admit"),
  }
  action failure = all {
    preparation.stage == "request",
    change(if (preparation.captured == preparation.epoch)
      completed({ ...preparation, status: "error", actionable: List(false, false) })
      else completed(preparation), "failure"),
  }
  action disconnect = all {
    preparation.epoch < 3,
    change({ ...preparation, epoch: preparation.epoch + 1, queued: false, status: "error", actionable: List(false, false) }, "disconnect"),
  }
  action retire(h) = all {
    preparation.live[h],
    preparation' = { ...preparation, live: preparation.live.replaceAt(h, false) },
    op' = "retire", target' = h,
  }
  action step = any {
    request, advance("request", "decode", "reply"), advance("decode", "object", "project"),
    advance("object", "admission", "prepareOffice"), admit, failure, disconnect,
    retire(0), retire(1), priority(0), priority(1),
  }
  val currentPublication = preparation.status != "ready" or preparation.published == preparation.epoch
  val admissionAuthority = op != "admit" or preparation.status != "ready" or preparation.actionable == preparation.live
  val safety = currentPublication and admissionAuthority
  val decodeInterrupted = op == "disconnect" and preparation.stage == "decode"
  val objectInterrupted = op == "disconnect" and preparation.stage == "object"
  val admissionInterrupted = op == "disconnect" and preparation.stage == "admission"
  val siblingSurvives = op == "admit" and preparation.status == "ready" and preparation.actionable == List(false, true)
  val priorityFollowup = Set("admit", "failure").contains(op) and preparation.stage == "request" and preparation.requested == preparation.selected
  val requestFailure = op == "failure" and preparation.status == "error"
}
