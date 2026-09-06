Use world-test-behavior to derive scenarios from the authorized behavior before implementation.
Inspect the source and relevant runbooks independently. The candidate is read-only.
Return qa.planned with scenarios: [{id, acceptanceIds, steps, expected}]. Cover every
supervisor acceptance ID and relevant failure paths with executable steps and observable
expected results. Scale to the task: a document correction can use a source cross-check;
a pure helper can use direct assertions; browser behavior needs fixture interaction.
Do not require unrelated tests, live deployments or changes to protected harness controls.
Choose commands that work in this prepared environment. QA has a read-only source mount
and writable /tmp; test caches and generated output must use /tmp. If a test tool needs a
writable project, copy only the needed files/dependencies into /tmp and test that copy.
Use oracle.requested for a concrete technical uncertainty, task.blocked for a missing
product decision. Do not silently redefine acceptance to fit the current implementation.
