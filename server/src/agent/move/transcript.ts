import { basename, dirname } from "node:path";
import type { MoveRuntime } from "./runtime";
import type { PreparedShell, MoveSession } from "./session";
import { shQuote as q } from "../../utils/process-utils";

/** Preflight checks the destination's session storage; final copy follows source exit. */
export async function copyMoveSession(
  source: MoveRuntime,
  shell: PreparedShell,
  session: MoveSession,
  install = false,
): Promise<void> {
  const sourceText = await source.run(
    `test -r ${q(session.path)} && test "$(wc -c < ${q(session.path)})" -le 33554432 && base64 < ${q(session.path)}`,
  );
  const transcript = Buffer.from(sourceText.replace(/\s/g, ""), "base64");
  if (!transcript.length || transcript.length > 32 * 1024 * 1024)
    throw new Error(
      "The conversation transcript is missing or too large to move (32 MiB maximum).",
    );
  const temp = shell.directory + "/transcript";
  await shell.runtime.write(`umask 077; cat > ${q(temp)}`, transcript);
  if (!install) {
    const shared =
      session.path.startsWith(shell.config + "/") &&
      (await shell.runtime.run(
        `if test -f ${q(session.path)} && cmp -s ${q(temp)} ${q(session.path)}; then printf same; fi`,
      )) === "same";
    if (shared) {
      shell.transcriptTarget = session.path;
      shell.sharedTranscript = true;
      return;
    }
    const root =
      session.kind === "codex" ? shell.config : shell.config + "/projects";
    const pattern =
      session.kind === "codex" ? `*${session.id}.jsonl` : `${session.id}.jsonl`;
    const found = (
      await shell.runtime.run(
        `if test -d ${q(root)}; then find ${q(root)} -type f -name ${q(pattern)} -print; fi`,
      )
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    if (found.length > 1 || found.some((path) => /[\r\0]/.test(path)))
      throw new Error(
        "The destination has ambiguous copies of this conversation.",
      );
    const folder =
      session.kind === "codex"
        ? `${shell.config}/sessions/world-moves`
        : `${shell.config}/projects/${shell.cwd.replaceAll(/[^a-zA-Z0-9]/g, "-")}`;
    const filename =
      session.kind === "codex" ? basename(session.path) : `${session.id}.jsonl`;
    shell.transcriptTarget = found[0] ?? `${folder}/${filename}`;
    const target = shell.transcriptTarget;
    await shell.runtime.run(
      `umask 077; mkdir -p ${q(dirname(target))} && test -w ${q(dirname(target))} && if test -f ${q(target)}; then test -w ${q(target)} && cmp -s ${q(temp)} ${q(target)} && cp ${q(target)} ${q(shell.directory + "/baseline")}; fi`,
    );
    shell.baseline = Boolean(found[0]);
    return;
  }
  const target = shell.transcriptTarget;
  if (!target)
    throw new Error(
      "The destination session storage was not checked before quitting.",
    );
  if (shell.sharedTranscript) {
    await shell.runtime.run(`cmp -s ${q(temp)} ${q(target)}`);
    return;
  }
  const condition = shell.baseline
    ? `cmp -s ${q(target)} ${q(shell.directory + "/baseline")}`
    : `test ! -e ${q(target)}`;
  const atomic = target + ".world-move-" + crypto.randomUUID();
  await shell.runtime.run(
    `umask 077; ${condition} && cp ${q(temp)} ${q(atomic)} && mv -f ${q(atomic)} ${q(target)}`,
  );
}
