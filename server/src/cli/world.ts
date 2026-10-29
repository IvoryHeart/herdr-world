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
import { dataRoot } from "../config/data-paths";
import { worldEnv } from "../config/environment";
import { readWorldCliToken, sessionSecretPath } from "../config/session-secret";
import { isLoopbackAddress } from "../workspace/file-manager";
import { readServiceAccess, readServiceSetup } from "./service-context";
import { WORLD_SKILL } from "./world-skill";

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
} as const;

/** One held `ask get` call; the service holds at most 20 s. */
const POLL_MS = 20_000;

const CODE_EXIT: Record<string, number> = {
  usage: WORLD_EXIT.usage,
  refused: WORLD_EXIT.refused,
  not_found: WORLD_EXIT.not_found,
  unavailable: WORLD_EXIT.failure,
};

type Reply = {
  ok: boolean;
  code?: string;
  error?: string;
  actor?: { label: string; verified: boolean };
  result?: unknown;
};

export type WorldCliTransport = (
  command: string,
  params: Record<string, unknown>,
) => Promise<Reply>;

/** Where the service listens and the CLI token it takes, as the CLI sees them. */
function serviceEndpoint(context: CliContext) {
  const env = context.runtime.env;
  let base = env.HERDR_WORLD_URL?.replace(/\/+$/, "");
  let token = env.HERDR_WORLD_TOKEN;
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
    token ??=
      readWorldCliToken(
        sessionSecretPath(
          worldEnv("SETTINGS_PATH", env) ??
            worldEnv("SETTINGS_PATH", setup.env),
          dataRoot(context.runtime.homeDir, context.runtime.platform),
        ),
      ) ?? undefined;
  }
  // The token stays on this machine: the endpoint answers loopback only.
  const host = new URL(base).hostname.replace(/^\[|\]$/g, "");
  if (host !== "localhost" && !isLoopbackAddress(host))
    throw new Error(
      `the World service listens on ${host}; the agent CLI needs a loopback listener (or HERDR_WORLD_URL on 127.0.0.1)`,
    );
  if (!token)
    throw new Error(
      "no World CLI token: start the World service once, or set HERDR_WORLD_TOKEN",
    );
  return { url: `${base}/api/world/cli`, token };
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
    const { url, token } = endpoint;
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
        error: `World service not reachable at ${new URL(url).origin}: ${(error as Error).message}`,
      };
    }
    try {
      return (await response.json()) as Reply;
    } catch {
      return {
        ok: false,
        code: "unavailable",
        error: `World service answered ${response.status} without JSON`,
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
      return `${String(entry.id)} withdrawn${answer?.text !== undefined ? ` (answered: ${String(answer.text)})` : ""}`;
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
): Promise<number> {
  if (wantsHelp(args)) {
    context.log(WORLD_SKILL);
    return EXIT_OK;
  }
  const { command, params, json } = parseWorldArgs(word, args);
  const asJson = json === true || !isTty;
  const wait = params.wait === true;
  const timeoutMs = Math.max(0, Number(params.timeout) || 0) * 1000;
  delete params.wait;
  delete params.timeout;
  let reply = await transport(command, params);
  // --wait: ask again until the owner (or an agent) answers.
  if (reply.ok && wait && (command === "ask" || command === "ask get")) {
    const id = String((reply.result as { id?: unknown }).id);
    const started = Date.now();
    for (;;) {
      const left = timeoutMs ? timeoutMs - (Date.now() - started) : POLL_MS;
      reply = await transport("ask get", {
        id,
        wait_ms: Math.max(0, Math.min(POLL_MS, left)),
      });
      const answered = Boolean(
        reply.ok && (reply.result as { answer?: unknown })?.answer,
      );
      if (
        !reply.ok ||
        answered ||
        (reply.result as { withdrawn?: unknown })?.withdrawn
      )
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
  if (asJson) context.log(JSON.stringify(reply));
  else if (reply.ok) context.log(human(command, reply));
  else context.error(`herdr-world ${word}: ${reply.error ?? "failed"}`);
  return reply.ok ? EXIT_OK : (CODE_EXIT[reply.code ?? ""] ?? EXIT_FAILURE);
}

const WORDS: { name: string; summary: string; actions?: string[] }[] = [
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
