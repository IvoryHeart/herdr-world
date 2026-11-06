import { afterEach, expect, test } from "bun:test";
import { sshCommandArgv } from "./ssh-command";
import { registerSshMaster, unregisterSshMaster } from "./ssh-sessions";

const owners: object[] = [];
afterEach(() => {
  for (const owner of owners.splice(0)) unregisterSshMaster(owner);
});

test("an unqualified command never borrows a different runtime's SSH master", () => {
  const owner = {};
  owners.push(owner);
  registerSshMaster(owner, {
    destination: "dev.example",
    controlPath: "/tmp/synthetic-owner/master",
    isListening: () => true,
    isAlive: async () => true,
  });
  expect(sshCommandArgv("dev.example", "true")).not.toContain("-S");
});
