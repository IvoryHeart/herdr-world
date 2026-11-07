import type { TownCrowdMood } from "./townActors";
import { townHash } from "./townSprites";

/**
 * Blocked is urgent; a ledger question is quiet owner attention; a finish
 * follows both. An agent in the reception overflow crowd curses, then
 * snores, whatever it waits for: the crowd itself is the signal. An agent
 * whose state is unknown is confused, not asleep. An agent out of fuel
 * (stopped on its usage limit) shows an empty fuel can and a clock.
 */
export function townBubbleKind(
  status: string,
  asking: boolean,
  seen: boolean,
  level: string,
  mode: string,
  chatting: boolean,
  typingFrame: number,
  mood: TownCrowdMood | null = null,
  fuel = false,
) {
  if (mood === "grumble") return "curse";
  if (mood === "nap") return "sleep";
  // Out of fuel says so at every distance a waiting agent does.
  if (fuel) return "fuel";
  if (status === "blocked") return "blocked";
  if (asking) return "ask";
  if (status === "done" && !seen) return "done";
  if ((level === "room" || level === "desk") && status === "unknown")
    return "confused";
  if (level === "desk" && status === "idle" && mode === "stand") return "idle";
  if (
    (level === "room" || level === "desk") &&
    status === "idle" &&
    mode === "seat"
  )
    return "sleep";
  return chatting
    ? (`typing${typingFrame % 3}` as "typing0" | "typing1" | "typing2")
    : null;
}

/** Working agents chat in short bursts: a typing bubble a third of the time. */
export function townAgentChatting(
  key: string,
  clock: number,
  level: string,
  status: string,
  mode: string,
  animate: boolean,
) {
  const phase = clock * 0.35 + (townHash(key) % 97) / 97;
  return (
    (level === "room" || level === "desk") &&
    animate &&
    status === "working" &&
    mode === "seat" &&
    phase - Math.floor(phase) < 0.33
  );
}
