import {
  type CliCommand,
  type CliContext,
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_USAGE,
  parseCommandArgs,
  UsageError,
  wantsHelp,
} from "./command";
import { readWorldCliToken, sessionSecretPath } from "../config/session-secret";
import { isLoopbackAddress } from "../workspace/file-manager";
import {
  readServiceAccess,
  readServiceSetup,
  runtimeDataRoot,
} from "./service-context";
import { WORLD_SKILL } from "./world-skill";
import { GROUP_ACTIONS, groupHuman, parseGroupArgs } from "./world-groups";
import { renderGroupMarkdown } from "../../../shared/groupMarkdown";
import type { GroupView } from "../../../shared/groupViews";
import { readFileSync } from "node:fs";

/**
 * The agent CLI: `herdr-world board|town|colour|ask|result|spawned-by|whoami|
 * ls|history|undo`. Each call goes to the running World service's
 * /api/world/cli (http/world-cli-endpoint.ts, world/world-cli.ts) with the
 * caller's HERDR_PANE_ID; the service checks that claim and records the change.
 */

/** Exit codes agents can rely on (also in `herdr-world --skill`). */
export const WORLD_EXIT = {
  ok: EXIT_OK,
  failure: EXIT_FAILURE,
  usage: EXIT_USAGE,
  refused: 3,
  not_found: 4,
  timeout: 5,
  /** The question is recorded, but Herdr showed no alert to anyone. */
  not_delivered: 6,
} as const;

/** One held `ask get` call; the service holds at most 20 s. */
const POLL_MS = 20_000;

const CODE_EXIT: Record<string, number> = {
  usage: WORLD_EXIT.usage,
  refused: WORLD_EXIT.refused,
  not_found: WORLD_EXIT.not_found,
  unavailable: WORLD_EXIT.failure,
  not_delivered: WORLD_EXIT.not_delivered,
};

type Reply = {
  ok: boolean;
  code?: string;
  error?: string;
  actor?: { label: string; verified: boolean };
  result?: unknown;
  /** `ask` only: whether World recorded the question. */
  recorded?: boolean;
  retrying?: boolean;
  /**
   * `ask` only: what Herdr's alert to the owner reported; null when none was
   * sent, as for a repeated cause that returns its recorded question.
   */
  notified?: { shown: boolean; reason: string } | null;
};

/** Shows the owner an alert; `shown` is false when no Herdr client got it. */
export type OwnerAlert = (
  title: string,
  body: string,
) => { shown: boolean; reason: string };

/**
 * Herdr's own path to the owner: `herdr notification show` in the asking
 * pane's Herdr reaches its clients, every World connected to it and Web Push.
 */
export function herdrAlert(context: CliContext): OwnerAlert {
  return (title, body) => {
    const herdr = context.runtime.env.HERDR_BIN_PATH?.trim() || "herdr";
    let output: { code: number; stdout: string };
    try {
      output = context.captureCommand([
        herdr,
        "notification",
        "show",
        title,
        "--body",
        body,
        "--sound",
        "request",
      ]);
    } catch (error) {
      return {
        shown: false,
        reason: `could not run ${herdr}: ${(error as Error).message}`,
      };
    }
    let reply: {
      result?: { shown?: unknown; reason?: unknown };
      error?: { message?: unknown };
    } = {};
    try {
      reply = JSON.parse(output.stdout);
    } catch {
      // Reported below with the exit code.
    }
    const reason =
      reply.result?.reason ??
      reply.error?.message ??
      `${herdr} notification show exited ${output.code}`;
    return { shown: reply.result?.shown === true, reason: String(reason) };
  };
}

/**
 * Alert the owner about a new question, or about one World could not record,
 * so an ask reaches the owner whenever Herdr does. Fails loudly otherwise.
 */
function alertOwner(
  reply: Reply,
  question: string,
  context: CliContext,
  alert: OwnerAlert,
): Reply {
  if (reply.ok || reply.recorded === true) return reply;
  if (reply.code === "usage")
    return { ...reply, recorded: false, notified: null };
  const who =
    reply.actor?.label ??
    (context.runtime.env.HERDR_PANE_ID
      ? `pane ${context.runtime.env.HERDR_PANE_ID}`
      : "An agent");
  const status =
    reply.recorded === false
      ? "not recorded in World"
      : "recording not confirmed in World";
  const notified = alert(
    `${who} asks`,
    `${question} (${status}: ${reply.error ?? "failed"})`,
  );
  return {
    ...reply,
    code: "unavailable",
    recorded: false,
    notified,
    error: `World did not confirm recording the question: ${reply.error ?? "failed"}; ${notified.shown ? "the owner was alerted through Herdr" : `Herdr alert also failed: ${notified.reason}`}`,
  };
}

export type WorldCliTransport = (
  command: string,
  params: Record<string, unknown>,
) => Promise<Reply>;

/** Where the service listens and the CLI token it takes, as the CLI sees them. */
function serviceEndpoint(context: CliContext) {
  const env = context.runtime.env;
  let base = env.HERDR_WORLD_URL?.replace(/\/+$/, "");
  let token = env.HERDR_WORLD_TOKEN;
  let secretPath: string | undefined;
  if (!base || !token) {
    const setup = readServiceSetup(context.runtime);
    const access = readServiceAccess(setup);
    if (!base) {
      const wildcard = access.host === "0.0.0.0" || access.host === "::";
      const host = wildcard
        ? "127.0.0.1"
        : access.host.includes(":")
          ? `[${access.host}]`
          : access.host;
      base = `${access.tls ? "https" : "http"}://${host}:${access.port}`;
    }
    if (!token) {
      secretPath = sessionSecretPath(
        runtimeDataRoot(context.runtime, setup.env),
      );
      token = readWorldCliToken(secretPath) ?? undefined;
    }
  }
  // The token stays on this machine: the endpoint answers loopback only.
  const host = new URL(base).hostname.replace(/^\[|\]$/g, "");
  if (host !== "localhost" && !isLoopbackAddress(host))
    throw new Error(
      `the World service listens on ${host}; the agent CLI needs a loopback listener (or HERDR_WORLD_URL on 127.0.0.1)`,
    );
  if (!token)
    throw new Error(
      `no World CLI token in ${secretPath} for ${base}: start the World service once, or set HERDR_WORLD_TOKEN`,
    );
  return { url: `${base}/api/world/cli`, token, secretPath };
}

export function httpTransport(context: CliContext): WorldCliTransport {
  return async (command, params) => {
    let endpoint: ReturnType<typeof serviceEndpoint>;
    try {
      endpoint = serviceEndpoint(context);
    } catch (error) {
      return {
        ok: false,
        code: "unavailable",
        error: (error as Error).message,
      };
    }
    const { url, token, secretPath } = endpoint;
    // Every endpoint error names the service and the token it used, so a
    // mismatched instance can be found.
    const where = `${new URL(url).origin} (token from ${secretPath ?? "HERDR_WORLD_TOKEN"})`;
    const paneId = context.runtime.env.HERDR_PANE_ID;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command,
          params,
          caller: paneId ? { pane_id: paneId } : {},
        }),
        // The service is on this machine; its certificate is often self-signed.
        tls: { rejectUnauthorized: false },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      return {
        ok: false,
        code: "unavailable",
        error: `World service not reachable at ${where}: ${(error as Error).message}`,
      };
    }
    try {
      const reply = (await response.json()) as Reply;
      // Say which service refused which token, so a mismatch can be found.
      if (response.status === 401 && reply.code === "refused")
        reply.error = `${reply.error ?? "refused"} from ${where}`;
      return reply;
    } catch {
      return {
        ok: false,
        code: "unavailable",
        error: `World service at ${where} answered ${response.status} without JSON`,
      };
    }
  };
}

const COMMON = {
  json: { type: "boolean" },
  connection: { type: "string" },
} as const;

const pair = (value: string | undefined, what: string) => {
  const [x, y, ...rest] = (value ?? "").split(",").map(Number);
  if (rest.length || !Number.isFinite(x) || !Number.isFinite(y))
    throw new UsageError(`${what} takes X,Y numbers`);
  return { x: x!, y: y! };
};

/** Parse argv into the service's command name and parameters. */
export function parseWorldArgs(
  word: string,
  args: string[],
): { command: string; params: Record<string, unknown>; json?: boolean } {
  if (word === "group" || word === "pod" || word === "team")
    return parseGroupArgs(word, args);
  const need = (value: string | undefined, what: string) => {
    if (!value) throw new UsageError(`missing ${what}`);
    return value;
  };
  const sub = args[0];
  const rest = args.slice(1);
  const parsed = (
    list: string[],
    options: Record<string, { type: "string" | "boolean" }>,
    positionals: number,
  ) =>
    parseCommandArgs(list, { ...COMMON, ...options }, positionals) as {
      values: Record<string, unknown>;
      positionals: string[];
    };
  const base = (values: Record<string, unknown>) => ({
    ...(typeof values.connection === "string"
      ? { connection: values.connection }
      : {}),
  });
  switch (word) {
    case "whoami":
    case "ls": {
      const { values } = parsed(args, {}, 0);
      return {
        command: word,
        params: base(values),
        json: values.json as boolean,
      };
    }
    case "history": {
      const { values } = parsed(
        args,
        { actor: { type: "string" }, limit: { type: "string" } },
        0,
      );
      return {
        command: "history",
        params: { actor: values.actor, limit: Number(values.limit ?? 50) },
        json: values.json as boolean,
      };
    }
    case "undo": {
      const { values, positionals } = parsed(args, {}, 1);
      return {
        command: "undo",
        params: { id: need(positionals[0], "change ID") },
        json: values.json as boolean,
      };
    }
    case "board": {
      if (sub !== "card") throw new UsageError("use `board card <verb>`");
      const verb = rest[0];
      const tail = rest.slice(1);
      if (verb === "move") {
        const { values, positionals } = parsed(
          tail,
          { by: { type: "string" } },
          1,
        );
        return {
          command: "board card move",
          params: {
            ...base(values),
            target: need(positionals[0], "target"),
            ...pair(values.by as string, "--by"),
          },
          json: values.json as boolean,
        };
      }
      if (verb === "pin") {
        const { values, positionals } = parsed(tail, {}, 2);
        return {
          command: "board card pin",
          params: {
            ...base(values),
            target: need(positionals[0], "target"),
            ...pair(need(positionals[1], "X,Y"), "pin"),
          },
          json: values.json as boolean,
        };
      }
      if (verb === "unpin" || verb === "ungroup") {
        const { values, positionals } = parsed(tail, {}, 1);
        return {
          command: `board card ${verb}`,
          params: { ...base(values), target: need(positionals[0], "target") },
          json: values.json as boolean,
        };
      }
      if (verb === "group") {
        const { values, positionals } = parsed(
          tail,
          { with: { type: "string" } },
          1,
        );
        return {
          command: "board card group",
          params: {
            ...base(values),
            target: need(positionals[0], "target"),
            with: need(values.with as string, "--with TARGET"),
          },
          json: values.json as boolean,
        };
      }
      if (verb === "colour" || verb === "color") {
        const { values, positionals } = parsed(tail, {}, 2);
        const colour = need(positionals[1], "colour (or default)");
        return colour === "default"
          ? {
              command: "colour reset",
              params: {
                ...base(values),
                target: need(positionals[0], "target"),
              },
              json: values.json as boolean,
            }
          : {
              command: "colour set",
              params: {
                ...base(values),
                target: need(positionals[0], "target"),
                colour,
              },
              json: values.json as boolean,
            };
      }
      throw new UsageError(
        "board card verbs: move, pin, unpin, group, ungroup, colour",
      );
    }
    case "colour":
    case "color": {
      if (sub !== "set" && sub !== "reset")
        throw new UsageError(
          "use `colour set TARGET COLOUR` or `colour reset TARGET`",
        );
      const { values, positionals } = parsed(rest, {}, sub === "set" ? 2 : 1);
      const target = need(positionals[0], "target");
      if (target.startsWith("host:"))
        throw new UsageError(
          "hosts have no colour of their own yet; colour a workspace or tab",
        );
      return {
        command: `colour ${sub}`,
        params: {
          ...base(values),
          target,
          ...(sub === "set" ? { colour: need(positionals[1], "colour") } : {}),
        },
        json: values.json as boolean,
      };
    }
    case "town": {
      if (sub !== "desk" || rest[0] !== "move")
        throw new UsageError(
          "use `town desk move TARGET [--onto TARGET|--last] --herdr`",
        );
      const { values, positionals } = parsed(
        rest.slice(1),
        {
          onto: { type: "string" },
          last: { type: "boolean" },
          herdr: { type: "boolean" },
        },
        1,
      );
      if (Boolean(values.onto) === Boolean(values.last))
        throw new UsageError("give one of --onto TARGET or --last");
      return {
        command: "town desk move",
        params: {
          ...base(values),
          target: need(positionals[0], "target"),
          onto: values.last ? null : values.onto,
          herdr: values.herdr === true,
        },
        json: values.json as boolean,
      };
    }
    case "ask": {
      if (sub === "get" || sub === "answer" || sub === "withdraw") {
        const { values, positionals } = parsed(
          rest,
          {
            wait: { type: "boolean" },
            timeout: { type: "string" },
            ...(sub === "withdraw" ? { key: { type: "string" as const } } : {}),
          },
          sub === "answer" ? 2 : 1,
        );
        if (values.key && positionals.length)
          throw new UsageError("use either a question ID or --key");
        return {
          command: `ask ${sub}`,
          params: {
            ...(values.key
              ? { key: values.key }
              : { id: need(positionals[0], "question ID") }),
            ...(sub === "answer"
              ? { answer: need(positionals[1], "answer") }
              : {
                  wait: values.wait === true,
                  timeout: Number(values.timeout ?? 0),
                }),
          },
          json: values.json as boolean,
        };
      }
      const { values, positionals } = parsed(
        args,
        {
          options: { type: "string" },
          "owner-only": { type: "boolean" },
          key: { type: "string" },
          wait: { type: "boolean" },
          timeout: { type: "string" },
        },
        1,
      );
      return {
        command: "ask",
        params: {
          question: need(positionals[0], "question"),
          ...(values.key ? { key: values.key } : {}),
          options: values.options
            ? String(values.options)
                .split(",")
                .map((option) => option.trim())
                .filter(Boolean)
            : [],
          owner_only: values["owner-only"] === true,
          wait: values.wait === true,
          timeout: Number(values.timeout ?? 0),
        },
        json: values.json as boolean,
      };
    }
    case "result": {
      if (sub === "ls") {
        const { values } = parsed(rest, { task: { type: "string" } }, 0);
        return {
          command: "result ls",
          params: { task: values.task },
          json: values.json as boolean,
        };
      }
      const { values, positionals } = parsed(
        args,
        {
          task: { type: "string" },
          pr: { type: "string" },
          status: { type: "string" },
        },
        1,
      );
      return {
        command: "result",
        params: {
          task: need(values.task as string, "--task ID"),
          summary: need(positionals[0], "summary"),
          ...(values.pr !== undefined ? { pr: Number(values.pr) } : {}),
          ...(values.status ? { status: values.status } : {}),
        },
        json: values.json as boolean,
      };
    }
    case "spawned-by": {
      const { values, positionals } = parsed(args, {}, 1);
      return {
        command: "spawned-by",
        params: { parent: need(positionals[0], "parent pane") },
        json: values.json as boolean,
      };
    }
  }
  throw new UsageError(`unknown command ${word}`);
}

/** One line per result for people; agents should prefer --json. */
function human(command: string, reply: Reply): string {
  if (command.startsWith("group ")) return groupHuman(reply.result);
  const result = reply.result as Record<string, unknown> | unknown[] | null;
  const who = reply.actor
    ? `${reply.actor.label}${reply.actor.verified ? "" : " (unverified)"}`
    : "";
  if (command === "whoami") return who;
  if (Array.isArray(result))
    return result.map((entry) => JSON.stringify(entry)).join("\n") || "(none)";
  const entry = (result ?? {}) as Record<string, unknown>;
  if (command.startsWith("ask")) {
    const answer = entry.answer as { text?: string } | undefined;
    if (command === "ask withdraw" || entry.withdrawn)
      return `${String(entry.id)} withdrawn${answer?.text !== undefined ? ` (answered: ${String(answer.text)})` : entry.dismissed ? " (dismissed by the owner)" : ""}`;
    if (entry.dismissed)
      return `${String(entry.id)} dismissed by the owner, without an answer`;
    return answer?.text !== undefined
      ? String(answer.text)
      : `${String(entry.id)} waiting for an answer`;
  }
  if (typeof entry.summary === "string")
    return `${String(entry.id)} ${entry.summary} (by ${who})`;
  return JSON.stringify(result);
}

export async function runWorldCommand(
  word: string,
  args: string[],
  context: CliContext,
  transport: WorldCliTransport = httpTransport(context),
  isTty = Boolean(process.stdout.isTTY),
  alert: OwnerAlert = herdrAlert(context),
): Promise<number> {
  if (wantsHelp(args)) {
    context.log(WORLD_SKILL);
    return EXIT_OK;
  }
  const { command, params, json } = parseWorldArgs(word, args);
  const markdown = params.markdown_output === true;
  delete params.markdown_output;
  if (command === "group import") {
    if (params.confirmed !== true)
      throw new UsageError("one-time Pod import needs --yes");
    try {
      params.markdown = readFileSync(String(params.file), "utf8");
    } catch {
      throw new UsageError("could not read the Markdown import file");
    }
    delete params.file;
    if (String(params.markdown).length > 48_000)
      throw new UsageError("Pod import is limited to 48000 characters");
  }
  const asJson = json === true || !isTty;
  const wait = params.wait === true;
  const timeoutMs = Math.max(0, Number(params.timeout) || 0) * 1000;
  delete params.wait;
  delete params.timeout;
  let reply: Reply;
  if (command === "group add" && params.herdr === true) {
    reply = await transport(command, { ...params, preview: true });
    if (reply.ok) {
      const plan = reply.result as {
        status?: string;
        plan?: string;
        summary?: string;
      };
      if (
        plan.status !== "preview" ||
        typeof plan.plan !== "string" ||
        typeof plan.summary !== "string"
      )
        reply = {
          ok: false,
          code: "unavailable",
          error:
            "World did not return a complete move preview; no move was made",
        };
      else {
        (asJson ? context.error : context.log)(plan.summary);
        reply = await transport(command, {
          ...params,
          expected_plan: plan.plan,
        });
      }
    }
  } else reply = await transport(command, params);
  // The ask's recording and alert outcome, kept through --wait.
  let outcome: Pick<Reply, "recorded" | "notified" | "retrying"> = {};
  if (command === "ask") {
    if (!reply.ok && reply.recorded !== true)
      reply = alertOwner(reply, String(params.question), context, alert);
    if (reply.ok && reply.notified?.shown === false) {
      const id = String((reply.result as { id?: unknown }).id);
      reply = {
        ...reply,
        ok: false,
        code: "not_delivered",
        error: `recorded ${id}, but Herdr showed the owner no alert: ${reply.notified.reason}`,
      };
    }
    outcome = {
      recorded: reply.recorded,
      notified: reply.notified,
      ...(reply.retrying ? { retrying: true } : {}),
    };
  }
  // --wait: ask again until the owner (or an agent) answers.
  if (reply.ok && wait && (command === "ask" || command === "ask get")) {
    const id = String((reply.result as { id?: unknown }).id);
    const started = Date.now();
    for (;;) {
      const left = timeoutMs ? timeoutMs - (Date.now() - started) : POLL_MS;
      reply = {
        ...(await transport("ask get", {
          id,
          wait_ms: Math.max(0, Math.min(POLL_MS, left)),
        })),
        ...outcome,
      };
      const answered = Boolean(
        reply.ok && (reply.result as { answer?: unknown })?.answer,
      );
      const closed = reply.result as {
        withdrawn?: unknown;
        dismissed?: unknown;
      };
      if (!reply.ok || answered || closed?.withdrawn || closed?.dismissed)
        break;
      if (timeoutMs && Date.now() - started >= timeoutMs) {
        (asJson ? context.log : context.error)(
          asJson
            ? JSON.stringify({ ...reply, timed_out: true })
            : `${id}: no answer yet`,
        );
        return WORLD_EXIT.timeout;
      }
    }
  }
  const line =
    markdown && reply.ok
      ? renderGroupMarkdown(reply.result as GroupView[])
      : asJson
        ? JSON.stringify(reply)
        : reply.ok
          ? human(command, reply)
          : null;
  if (line !== null) {
    try {
      if (context.output) await context.output(line);
      else context.log(line);
    } catch {
      context.error("herdr-world: could not write standard output");
      return EXIT_FAILURE;
    }
  } else context.error(`herdr-world ${word}: ${reply.error ?? "failed"}`);
  if (
    reply.ok &&
    reply.actor?.verified &&
    (command === "ask get" || command === "ask")
  ) {
    const ask = reply.result as
      | {
          id?: unknown;
          answer?: { text?: unknown; occurrence?: unknown };
          delivery?: { answer?: { occurrence?: unknown; attempt?: unknown } };
        }
      | undefined;
    if (
      typeof ask?.id === "string" &&
      typeof ask.answer?.text === "string" &&
      typeof ask.answer.occurrence === "string" &&
      ask.delivery?.answer?.occurrence === ask.answer.occurrence &&
      Number.isSafeInteger(ask.delivery.answer.attempt)
    ) {
      // The service re-verifies the original asker and occurrence. A lost ACK
      // may leave a possible duplicate; it cannot turn a successful read into loss.
      try {
        await transport("ask acknowledge", {
          id: ask.id,
          occurrence: ask.answer.occurrence,
          attempt: ask.delivery.answer.attempt,
        });
      } catch {
        /* Retrieval already succeeded. */
      }
    }
  }
  return reply.ok ? EXIT_OK : (CODE_EXIT[reply.code ?? ""] ?? EXIT_FAILURE);
}

const WORDS: { name: string; summary: string; actions?: string[] }[] = [
  {
    name: "group",
    summary: "list Groups and edit World-owned Teams and Pods",
    actions: GROUP_ACTIONS,
  },
  { name: "pod", summary: "group alias for kind Pod", actions: GROUP_ACTIONS },
  {
    name: "team",
    summary: "group alias for kind Team",
    actions: GROUP_ACTIONS,
  },
  {
    name: "board",
    summary: "agents: move, pin, group or colour Board cards",
    actions: ["card"],
  },
  {
    name: "town",
    summary: "agents: reorder Town desks (Herdr tab order)",
    actions: ["desk"],
  },
  {
    name: "colour",
    summary: "agents: set or reset a tab or workspace colour",
    actions: ["set", "reset"],
  },
  {
    name: "ask",
    summary: "agents: ask the owner a question in World",
    actions: ["get", "answer"],
  },
  { name: "result", summary: "agents: report a task result", actions: ["ls"] },
  {
    name: "spawned-by",
    summary: "agents: record the pane that spawned this one",
  },
  { name: "whoami", summary: "agents: show who World thinks is calling" },
  { name: "ls", summary: "agents: list hosts, rooms, desks and agents" },
  { name: "history", summary: "agents: show recorded World changes" },
  { name: "undo", summary: "agents: undo a recorded World-side change" },
];

/** The agent verbs, registered with the CLI router (cli/index.ts). */
export function worldCommands(): CliCommand[] {
  return WORDS.map(({ name, summary, actions }) => ({
    name,
    summary,
    actions,
    flags: ["--json", "--connection"],
    help: () => WORLD_SKILL,
    run: (args, context) => runWorldCommand(name, args, context),
  }));
}
