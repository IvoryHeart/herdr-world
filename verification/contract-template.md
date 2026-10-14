# Contract: descriptive behavior name

## Intended behavior

Link current requirements and accepted delivery evidence. Name the source owner.
List concrete allowed and forbidden scenarios and distinguish unspecified behavior
from behavior the current implementation happens to exhibit. Explain why this
contract needs model exploration or direct alternative evidence.

## Model and implementation mapping

Name model files and the adapter/consumer evidence. For every state variable and
transition, explain the observable real operation, its completion boundary and the
captured authority. State which asynchronous boundaries are independently driven.
Keep generation, observation epoch, socket/batch identity and intent version distinct.
Explain all assumptions between component models and their real consumers.

## Properties, witnesses and negative controls

Name each invariant and its intended requirement. State which reachable scenarios
exercise its preconditions. Count witnesses on actual production replay, not only
simulator traces. Name model and code faults and the expected conformance observation
that rejects them; parser, adapter and cleanup errors do not count as a kill.

## Domain, environment and limitations

Record finite host/resource domains, generation/epoch bounds, seeds and checker
backend. Explain sensitivity checks and why any finite abstraction is appropriate.
State external-runtime, browser, OS and durability assumptions. Distinguish safety
from temporal progress and state any fairness assumptions explicitly. Retain actual
integration/browser/platform checks for behavior the model cannot establish.

## Evidence and promotion

Identify reproducible commands, manifest fields, source/model/tool identifiers and
execution artifacts. Identify the independent reviewer and reviewed boundary.
List which checks are candidate requirements, unresolved limitations and the
acceptance decision. A green run or reviewed foundation is not approval of an
expanded model, changed property or assumption.
