Use world-test-behavior to derive scenarios from the authorized behavior before implementation.
Inspect the source and relevant runbooks independently. The candidate is read-only.
Return qa.planned with scenarios: [{id, acceptanceIds, steps, expected}]. Cover every
supervisor acceptance ID and relevant failure paths with executable steps and observable
expected results. Scale to the task: a document correction can use a source cross-check;
a pure helper can use direct assertions; browser behavior needs fixture interaction.
Do not require unrelated tests, live deployments or changes to protected harness controls.
Produce scenarios, not a baseline test run. Inspect only the source/config needed to make
the steps executable; run an experiment only for a specific uncertainty that changes them.
QA can use `node /control/scripts/agent/fixture.mjs` from /workspace to prepare a writable
test copy with real dependencies. Do not invent a temporary-project setup in this phase.
Use oracle.requested for a concrete technical uncertainty, task.blocked for a missing
product decision. Do not silently redefine acceptance to fit the current implementation.
