import { isLocalCoreAddress } from "../../../shared/coreAddress";
import { CoreProtocolError, encodeFrame, FrameKind } from "./wire";

function localAddress(address: string) {
  if (!isLocalCoreAddress(address))
    throw new CoreProtocolError("World requires a local core terminal address");
  return address;
}

/** Core's reply to a send: the turn the text went in at (openrpc SendResult). */
export type CoreSendResult = {
  turn: number;
  /** The program's status word when the text went in (null: it never said). */
  status: string | null;
  /** Went `working` within a few seconds; null when it reports no status. */
  started: boolean | null;
};
export type CoreKeysResult = { turn: number; status: string | null };

/** The longest message World sends in one paste. */
export const MAX_CORE_SEND_TEXT = 16_000;
/**
 * Keys World presses to answer a program: one letter or digit (a menu's
 * option, y/n) or a named key that moves or confirms. No modifiers: World
 * answers a question, it does not interrupt or control a program.
 */
const ANSWER_KEY =
  /^(?:[a-z0-9]|enter|esc|tab|space|backspace|up|down|left|right)$/;

/** Fresh native parameters; automatic briefs require core's idle condition. */
export function coreSendParams(
  address: string,
  text: string,
  force: boolean,
  onlyIfIdle = false,
) {
  if (typeof text !== "string" || !text.trim())
    throw new CoreProtocolError("there is nothing to send");
  if (text.length > MAX_CORE_SEND_TEXT || text.includes("\0"))
    throw new CoreProtocolError("the message is too long or invalid");
  return {
    terminal: localAddress(address),
    text,
    force: force === true,
    ...(onlyIfIdle ? { if: "idle" as const } : {}),
  };
}

/**
 * A key the person pressed from Chat (Stop's Esc, a composer key control, a
 * menu's key): Chat's keys (shared/chatKeys.ts) in core's names, modifiers
 * included. Core refuses a name it cannot encode and types nothing.
 */
const CONTROL_KEY =
  /^(?:(?:ctrl|alt|shift)\+){0,3}(?:[!-~]|enter|esc|tab|backspace|space|up|down|left|right|f(?:[1-9]|1[0-2]))$/;

/**
 * Fresh native `terminal.keys` parameters: World's answer keys, or with
 * `control` a key the person pressed.
 */
export function coreKeysParams(
  address: string,
  keys: readonly string[],
  control = false,
) {
  const allowed = control ? CONTROL_KEY : ANSWER_KEY;
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.length > 8 ||
    !keys.every((key) => typeof key === "string" && allowed.test(key))
  )
    throw new CoreProtocolError(
      control ? "Chat cannot press that key" : "World presses only answer keys",
    );
  return { terminal: localAddress(address), keys: [...keys] };
}

/** Core cancellation is a channel-zero JSON-RPC notification for one request. */
export function coreCancelFrame(id: number) {
  return encodeFrame(
    0,
    FrameKind.DATA,
    new TextEncoder().encode(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "$/cancelRequest",
        params: { id },
      }),
    ),
  );
}

/** Native windows include startup, a 60-second draft hold, quiet and started checks. */
export function coreSendRequest(
  address: string,
  text: string,
  options: {
    force: boolean;
    onlyIfIdle?: boolean;
    cancel?: AbortSignal;
    timeoutMs?: number;
  },
) {
  return [
    "terminal.send",
    coreSendParams(address, text, options.force, options.onlyIfIdle),
    options.timeoutMs ?? 90000,
    options.cancel,
  ] as const;
}
export function coreKeysRequest(
  address: string,
  keys: readonly string[],
  timeoutMs: number,
  control = false,
) {
  return [
    "terminal.keys",
    coreKeysParams(address, keys, control),
    timeoutMs,
  ] as const;
}
