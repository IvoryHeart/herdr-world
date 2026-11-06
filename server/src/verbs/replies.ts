import { CONNECTION_CHANGED_DURING_REQUEST } from "../connections/protocol";
import { checkVerbResult } from "./admission";
import { registeredVerb } from "./registry";

/** Terminal/settings retain their existing serializers and exact error identity. */
export function commandReplies(args: {
  id: string;
  method: string;
  current(): boolean;
  error(message: string): void;
  send(message: Record<string, unknown>, context: string): boolean;
}) {
  const fail = (message: string) => {
    const effectiveMessage = args.current()
      ? message
      : CONNECTION_CHANGED_DURING_REQUEST;
    args.error(effectiveMessage);
    return args.send(
      {
        id: args.id,
        error: { message: effectiveMessage },
        command_evidence: { stage: "failed" },
      },
      `${args.method}-error`,
    );
  };
  const reply = (result: unknown) => {
    const verb = registeredVerb("rpc", args.method);
    if (!verb) return fail("unregistered verb");
    checkVerbResult(verb, result);
    return args.current()
      ? args.send(
          { id: args.id, result, command_evidence: { stage: "accepted" } },
          args.method,
        )
      : fail(CONNECTION_CHANGED_DURING_REQUEST);
  };
  return { fail, reply };
}
