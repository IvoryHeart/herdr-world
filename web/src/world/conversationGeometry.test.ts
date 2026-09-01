import { describe, expect, it } from "vitest";
import {
  CONVERSATION_MIN_HEIGHT,
  CONVERSATION_MIN_WIDTH,
  clampConversationGeometry,
  defaultConversationGeometry,
  defaultGraphConversationGeometry,
  moveConversationGeometry,
  resizeConversationGeometry,
} from "./conversationGeometry";

describe("conversation geometry", () => {
  it("centers the default desktop footprint", () => {
    const geometry = defaultConversationGeometry(1120, 810);
    expect(geometry.width).toBeGreaterThanOrEqual(CONVERSATION_MIN_WIDTH);
    expect(geometry.height).toBeGreaterThanOrEqual(CONVERSATION_MIN_HEIGHT);
    expect(geometry.left + geometry.width / 2).toBeCloseTo(560);
    expect(geometry.top + geometry.height / 2).toBeCloseTo(405);
  });

  it("places the smaller Graph default against the lower-right edge", () => {
    const geometry = defaultGraphConversationGeometry(1120, 810);
    expect(geometry.width).toBeCloseTo(582.4);
    expect(geometry.height).toBeCloseTo(388.8);
    expect(geometry.left + geometry.width).toBeCloseTo(1108);
    expect(geometry.top + geometry.height).toBeCloseTo(798);
  });

  it("clamps position and size to the stage", () => {
    expect(clampConversationGeometry({
      left: -100,
      top: 900,
      width: 10_000,
      height: 10_000,
    }, 1120, 810)).toMatchObject({
      left: 12,
      top: 12,
      width: 1096,
      height: 786,
    });
  });

  it("moves without changing the terminal footprint", () => {
    const initial = defaultConversationGeometry(1120, 810);
    const moved = moveConversationGeometry(initial, 80, -40, 1120, 810);
    expect(moved.width).toBe(initial.width);
    expect(moved.height).toBe(initial.height);
    expect(moved.left).toBe(initial.left + 80);
    expect(moved.top).toBe(initial.top - 40);
  });

  it("resizes while preserving position and respecting bounds", () => {
    const initial = defaultConversationGeometry(1120, 810);
    const resized = resizeConversationGeometry(initial, 120, 90, 1120, 810);
    expect(resized.left).toBe(initial.left);
    expect(resized.top).toBe(initial.top);
    expect(resized.width).toBeCloseTo(initial.width + 120);
    expect(resized.height).toBeCloseTo(initial.height + 90);
    const clamped = resizeConversationGeometry(resized, -10_000, -10_000, 1120, 810);
    expect(clamped.width).toBe(CONVERSATION_MIN_WIDTH);
    expect(clamped.height).toBe(CONVERSATION_MIN_HEIGHT);
  });
});
