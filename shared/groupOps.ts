import type {
  GroupAttrs,
  GroupMemberInput,
  GroupRef,
  GroupSender,
} from "./groups";
import type { TerminalRef } from "./relations";

type Sender = { sender?: GroupSender };
export type GroupOp = (
  | {
      op: "group.create";
      id: string;
      kind: string;
      name?: string;
      members?: GroupMemberInput[];
      attrs?: GroupAttrs;
    }
  | {
      op: "group.join";
      id: string;
      refs: GroupRef[];
      roles?: string[];
      replace?: boolean;
    }
  | {
      op: "group.join";
      id: string;
      members: TerminalRef[];
      target: TerminalRef[];
    }
  | { op: "group.leave"; id: string; refs: GroupRef[] }
  | { op: "group.leave"; members: TerminalRef[] }
  | {
      op: "group.set_roles";
      id: string;
      refs: GroupRef[];
      roles: string[];
      replace?: boolean;
    }
  | {
      op: "group.set_attrs";
      id: string;
      name?: string | null;
      attrs?: GroupAttrs | null;
    }
  | { op: "group.delete"; id: string }
  | {
      op: "group.promote";
      id: string;
      name: string;
      mapping: { from: TerminalRef; to: string; roles?: string[] }[];
      replace?: boolean;
    }
) &
  Sender;
