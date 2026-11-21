import { runProcessWithCodeTimeout } from "../utils/process-utils";

/**
 * Runs a built-in source's CLI (gh, jira) without prompts or colour. A
 * missing binary reads as exit 127 rather than throwing.
 */
export async function runSourceProcess(argv: string[], timeoutMs: number) {
  try {
    return await runProcessWithCodeTimeout(argv, timeoutMs, {
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "1",
        GIT_TERMINAL_PROMPT: "0",
        NO_COLOR: "1",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { code: 127, stdout: "", stderr: "" };
    throw error;
  }
}
