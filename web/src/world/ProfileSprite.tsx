import { useEffect, useRef } from "react";
import type { AgentLook } from "../../../shared/agentProfile";
import { townLookOf } from "./agentProfiles";
import {
  townCharacter,
  type TownDirection,
  type TownPose,
} from "./town/townSprites";

/**
 * A profile's Town character, drawn with the same sprites as Town. With
 * `animate`, it walks on the spot, turns around and sits, as a live preview.
 */
export function ProfileSprite({
  look,
  scale = 3,
  animate = false,
  label,
}: {
  look: AgentLook;
  scale?: number;
  animate?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const town = townLookOf(look);
    const draw = (dir: TownDirection, frame: number, pose: TownPose) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(
        townCharacter(town, dir, frame, pose, false),
        0,
        0,
        canvas.width,
        canvas.height,
      );
    };
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduced) {
      draw("down", 0, "stand");
      return;
    }
    const steps: [TownDirection, number, TownPose][] = [
      ...[0, 1, 2, 3, 0, 1, 2, 3].map(
        (frame): [TownDirection, number, TownPose] => ["down", frame, "stand"],
      ),
      ["right", 0, "stand"],
      ["up", 0, "stand"],
      ["left", 0, "stand"],
      ["down", 0, "sit"],
      ["down", 1, "sit"],
    ];
    let index = 0;
    draw(...steps[0]!);
    const timer = setInterval(() => {
      index = (index + 1) % steps.length;
      draw(...steps[index]!);
    }, 220);
    return () => clearInterval(timer);
  }, [look, animate]);
  return (
    <canvas
      ref={ref}
      className="profile-sprite"
      width={14 * scale}
      height={20 * scale}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
