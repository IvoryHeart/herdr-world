import { CoreProtocolError, encodeFrame, FrameKind } from "./wire";

function localAddress(address: string) {
  if (!/^t[1-9][0-9]{0,9}$/.test(address))
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

/** Fresh native `terminal.send` parameters: no caller, wait or condition. */
export function coreSendParams(address: string, text: string, force: boolean) {
  if (typeof text !== "string" || !text.trim())
    throw new CoreProtocolError("there is nothing to send");
  if (text.length > MAX_CORE_SEND_TEXT || text.includes("\0"))
    throw new CoreProtocolError("the message is too long or invalid");
  return { terminal: localAddress(address), text, force: force === true };
}

/** Fresh native `terminal.keys` parameters from World's answer keys. */
export function coreKeysParams(address: string, keys: readonly string[]) {
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.length > 8 ||
    !keys.every((key) => typeof key === "string" && ANSWER_KEY.test(key))
  )
    throw new CoreProtocolError("World presses only answer keys");
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
  options: { force: boolean; cancel?: AbortSignal; timeoutMs?: number },
) {
  return [
    "terminal.send",
    coreSendParams(address, text, options.force),
    options.timeoutMs ?? 90000,
    options.cancel,
  ] as const;
}
export function coreKeysRequest(
  address: string,
  keys: readonly string[],
  timeoutMs: number,
) {
  return ["terminal.keys", coreKeysParams(address, keys), timeoutMs] as const;
}
