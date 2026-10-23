import { createElement } from "react";
import { isSlashCommand } from "../../../../../shared/conversationInput";
import { CommandReceipt } from "./command";
import type { WorkItem, WorkLink } from "../../../../../shared/worldSources";
import type { HistoryEntry } from "../../agentHistory";
import {
  historyDecorationKey,
  type HistoryDecorator,
} from "../../historyDecoration";
import { PullRequestCard } from "../../../world/PullRequestCard";
import {
  StepDetailEvidence,
  StepRowEvidence,
  type ConversationStep,
} from "./steps";
export { ChatAfterBlocks } from "./after";

export type ChatBlockOwner = {
  connectionId: string;
  generation: number | null;
  paneId: string;
  sessionFingerprint?: string;
  label: string;
};
export type ChatBlockInput = {
  entries: readonly HistoryEntry[];
  steps: ReadonlyMap<string, ConversationStep>;
  items: readonly WorkItem[];
  links: readonly WorkLink[];
  owner: ChatBlockOwner;
  onAskAuthor?: (item: WorkItem) => void;
};

type MessageToken = {
  kind: "message";
  cards: { item: WorkItem; author: boolean }[];
  owner: ChatBlockOwner;
  onAskAuthor: ChatBlockInput["onAskAuthor"];
};
type BlockToken =
  | MessageToken
  | { kind: "step"; step: ConversationStep }
  | { kind: "command"; entry: HistoryEntry };

/** One module-level renderer; each bubble/step compares only its own token. */
export const decorateChat: HistoryDecorator = (target, value) => {
  const token = value as BlockToken | undefined;
  if (target.type === "message" && token?.kind === "command")
    return {
      message: createElement(CommandReceipt, {
        text: token.entry.text,
        at: token.entry.sent_at,
        observed: true,
      }),
    };
  if (target.type === "step" && token?.kind === "step") {
    const { step } = token;
    return {
      label: step.label,
      state:
        step.state === "failed"
          ? "error"
          : step.state === "interrupted"
            ? "interrupted"
            : undefined,
      row: createElement(StepRowEvidence, { step }),
      detail: createElement(StepDetailEvidence, { step }),
    };
  }
  if (target.type === "message" && token?.kind === "message") {
    return {
      after: token.cards.map(({ item, author }) =>
        createElement(PullRequestCard, {
          key: item.key,
          item,
          compact: true,
          agents: author
            ? [{ id: token.owner.paneId, label: token.owner.label }]
            : [],
          onAskAuthor: author ? token.onAskAuthor : undefined,
        }),
      ),
    };
  }
};

function sameMessage(a: MessageToken, b: MessageToken) {
  return (
    a.onAskAuthor === b.onAskAuthor &&
    a.owner.label === b.owner.label &&
    a.owner.paneId === b.owner.paneId &&
    a.cards.length === b.cards.length &&
    a.cards.every(
      (card, i) =>
        card.item === b.cards[i]!.item && card.author === b.cards[i]!.author,
    )
  );
}

export function chatBlockTokens(
  previous: ReadonlyMap<string, unknown>,
  input: ChatBlockInput,
): ReadonlyMap<string, unknown> {
  const { entries, steps, items, links, owner, onAskAuthor } = input;
  const claims = new Set(
    links
      .filter(
        (link) =>
          owner.sessionFingerprint &&
          link.connectionId === owner.connectionId &&
          link.generation === owner.generation &&
          link.paneId === owner.paneId &&
          link.sessionFingerprint === owner.sessionFingerprint,
      )
      .map((link) => link.itemKey),
  );
  const byNumber = new Map<number, WorkItem[]>();
  for (const item of items) {
    if (item.kind !== "pull_request" || !item.number) continue;
    const sameNumber = byNumber.get(item.number) ?? [];
    sameNumber.push(item);
    byNumber.set(item.number, sameNumber);
  }
  const next = new Map<string, BlockToken>();
  for (const entry of entries) {
    const key = historyDecorationKey(entry);
    if (next.has(key)) continue;
    const old = previous.get(key) as BlockToken | undefined;
    if (entry.role === "tool") {
      const step = entry.source_call_id
        ? steps.get(entry.source_call_id)
        : undefined;
      if (step)
        next.set(
          key,
          old?.kind === "step" && old.step === step
            ? old
            : { kind: "step", step },
        );
      continue;
    }
    if (entry.role === "user" && isSlashCommand(entry.text)) {
      next.set(
        key,
        old?.kind === "command" && old.entry === entry
          ? old
          : { kind: "command", entry },
      );
      continue;
    }
    // A user quoting a PR is not an agent announcing its work.
    if (entry.role !== "assistant" || entry.notice) continue;
    const cards: MessageToken["cards"] = [];
    const references =
      /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\b|(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g;
    for (const match of entry.text.matchAll(references)) {
      const repo = match[1] ?? match[3];
      const number = Number(match[2] ?? match[4]);
      let candidates = (byNumber.get(number) ?? []).filter(
        (item) => !repo || item.repo?.toLowerCase() === repo.toLowerCase(),
      );
      const announced =
        /\b(?:READY|opened)(?:\s+(?:PR|pull request))?\s*$/i.test(
          entry.text.slice(0, match.index),
        );
      if (!announced || candidates.length > 1)
        candidates = candidates.filter((item) => claims.has(item.key));
      if (candidates.length !== 1) continue;
      const item = candidates[0]!;
      if (!cards.some((card) => card.item.key === item.key))
        cards.push({ item, author: claims.has(item.key) });
    }
    if (!cards.length) continue;
    const token: MessageToken = { kind: "message", cards, owner, onAskAuthor };
    next.set(
      key,
      old?.kind === "message" && sameMessage(old, token) ? old : token,
    );
  }
  return next;
}
