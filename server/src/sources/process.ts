import { runProcessWithCodeTimeout } from "../utils/process-utils";

/** Read work sources without interactive credential or terminal prompts. */
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
