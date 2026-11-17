// HOME must be set before Bun starts: os.homedir() is cached.
// The wrapper reads the durable tripwire log after the process exits, so a
// caught error still fails the run without poisoning unrelated file teardown.
import { ISOLATION } from "./test-isolation";
import "./test-process-preload";

if (!process.env[ISOLATION])
  throw new Error(
    "Use bun run test <files>; direct bun test cannot isolate Bun's cached home",
  );
