# Requirement validity control

Review properties before comparing their implementation mapping. All three
foundation contracts include allowed and forbidden examples, observable boundaries,
positive witnesses, fault controls and excluded claims. The companion models and
adapters make those examples executable; the accepted PR review checked their
mapping and repaired two harness weaknesses.

A deliberately incorrect requirement is: “a retired start may restore readiness
using a replacement runtime's identity.” Its allowed example is old transport
completion after stop/new-generation admission. Runtime federation requires
operations to remain qualified by captured connection and generation; the
incorrect example would authorize a retired context. Reject this requirement
against that source contract even if an implementation, model and test all agree.
The runtime foundation's late-start witness then exercises the intended rejection.

The corresponding refresh mistake is allowing an old reply to publish under a
new epoch; the allocation mistake is serving ordinary input-prefix spaces before
available relevant reservations. Both contradict their explicit forbidden
scenarios. Fault kills demonstrate that the harness detects these mistakes;
they do not independently decide which requirement is correct.

Future contract reviews must resolve ambiguity with the requirement owner rather
than copying current code into the expected result. Reviewers may reject the
requirement, abstraction, adapter or production behavior separately. A green
checker cannot resolve a disagreement about intended behavior.
