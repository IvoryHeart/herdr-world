import type { ChatRow } from "./chat/chatSenders";
export function senderProps(
  row: ChatRow | undefined,
  agent: string | undefined,
) {
  if (!row || agent === undefined) return {};
  const { sender } = row;
  return {
    from:
      sender.kind === "relayed"
        ? sender.name
        : sender.kind === "user"
          ? "You"
          : agent,
    fromKind: sender.kind,
    continued: row.continued,
  };
}
