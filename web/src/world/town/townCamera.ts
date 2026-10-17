/**
 * Office town camera: pan, zoom about a point, inertia and eased flights.
 * Pure state so the renderer, the DOM world layer and tests share one model.
 */

import { TOWN_TILE, type TownLayout } from "./townLayout";

export type TownViewport = {
  width: number;
  height: number;
  /** Space covered by surrounding chrome (rail, tray, docked Inspector). */
  inset: { top: number; right: number; bottom: number; left: number };
};

export type TownLevel = "town" | "overview" | "room" | "desk";

export type TownZoomLimits = {
  /** Zoom that fits every building; desktop default. */
  all: number;
  /** Default zoom for this form factor. */
  home: number;
  /** Below this, roofs cover the buildings. */
  roof: number;
  /** Below this, rooms show status cards instead of tables. */
  card: number;
  /** At and above this, characters and per-seat targets appear. */
  desk: number;
  min: number;
  max: number;
};

/** Above this many rooms, the default wide view shows roofs instead of cards. */
export const TOWN_OVERVIEW_ROOMS = 48;

export function townZoomLimits(
  layout: TownLayout,
  viewport: TownViewport,
): TownZoomLimits {
  const usableWidth = Math.max(
    160,
    viewport.width - viewport.inset.left - viewport.inset.right,
  );
  const usableHeight = Math.max(
    160,
    viewport.height - viewport.inset.top - viewport.inset.bottom,
  );
  const all =
    Math.min(
      usableWidth / (layout.width * TOWN_TILE),
      usableHeight / (layout.height * TOWN_TILE),
    ) * 0.98;
  const narrow = layout.formFactor === "narrow";
  const widest = Math.max(1, ...layout.buildings.map((b) => b.w));
  const home = narrow ? (usableWidth - 12) / ((widest + 2) * TOWN_TILE) : all;
  const desk = narrow ? 1.05 : 1.3;
  const card = narrow ? Math.max(0.5, home * 1.35) : 0.62;
  // A town too large for readable room cards opens at roof level; zooming in
  // past this point shows the cards of the buildings on screen.
  const rooms = layout.buildings.reduce((sum, b) => sum + b.rooms.length, 0);
  const roof = narrow
    ? home * 0.8
    : rooms > TOWN_OVERVIEW_ROOMS
      ? Math.min(card * 0.9, all * 1.5)
      : all * 0.88;
  return {
    all,
    home,
    roof,
    card,
    desk,
    min: Math.min(all * 0.85, roof * 0.8),
    max: narrow ? 4 : 5,
  };
}

export function townLevel(z: number, limits: TownZoomLimits): TownLevel {
  if (z < limits.roof) return "town";
  if (z < limits.card) return "overview";
  if (z < limits.desk) return "room";
  return "desk";
}

/** Smooth 0..1 blend for crossfading between levels. */
export function townBlend(from: number, to: number, z: number) {
  const t = Math.min(1, Math.max(0, (z - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export class TownCamera {
  x = 0;
  y = 0;
  z = 1;
  private targetZ = 1;
  private anchor: { x: number; y: number } | null = null;
  private velocity = { x: 0, y: 0 };
  private flight: null | {
    x0: number;
    y0: number;
    z0: number;
    x: number;
    y: number;
    z: number;
    t: number;
    duration: number;
    dip: number;
  } = null;
  viewport: TownViewport = {
    width: 1,
    height: 1,
    inset: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  bounds = { width: 1, height: 1 };
  limits: TownZoomLimits | null = null;
  reducedMotion = false;
  calm = false;

  configure(layout: TownLayout, viewport: TownViewport) {
    this.viewport = viewport;
    this.bounds = {
      width: layout.width * TOWN_TILE,
      height: layout.height * TOWN_TILE,
    };
    this.limits = townZoomLimits(layout, viewport);
    this.z = this.clampZoom(this.z);
    this.targetZ = this.clampZoom(this.targetZ);
    this.clampPosition();
  }

  clampZoom(z: number) {
    const limits = this.limits;
    return limits ? Math.min(limits.max, Math.max(limits.min, z)) : z;
  }

  private clampPosition() {
    this.x = Math.min(this.bounds.width, Math.max(0, this.x));
    this.y = Math.min(this.bounds.height, Math.max(0, this.y));
  }

  toWorld(sx: number, sy: number) {
    return {
      x: this.x + (sx - this.viewport.width / 2) / this.z,
      y: this.y + (sy - this.viewport.height / 2) / this.z,
    };
  }

  toScreen(wx: number, wy: number) {
    return {
      x: (wx - this.x) * this.z + this.viewport.width / 2,
      y: (wy - this.y) * this.z + this.viewport.height / 2,
    };
  }

  /** Screen point at the centre of the area not covered by chrome. */
  focusPoint() {
    const { width, height, inset } = this.viewport;
    return {
      x: inset.left + (width - inset.left - inset.right) / 2,
      y: inset.top + (height - inset.top - inset.bottom) / 2,
    };
  }

  /** Camera centre that places world point (wx, wy) at the focus point at zoom z. */
  centreFor(wx: number, wy: number, z: number) {
    const focus = this.focusPoint();
    return {
      x: wx - (focus.x - this.viewport.width / 2) / z,
      y: wy - (focus.y - this.viewport.height / 2) / z,
    };
  }

  jumpTo(wx: number, wy: number, z: number) {
    this.flight = null;
    this.z = this.targetZ = this.clampZoom(z);
    const centre = this.centreFor(wx, wy, this.z);
    this.x = centre.x;
    this.y = centre.y;
    this.velocity = { x: 0, y: 0 };
    this.clampPosition();
  }

  /** Ease to frame world point (wx, wy) at zoom z, dipping out for long trips. */
  flyTo(wx: number, wy: number, z: number, duration = 0.75) {
    const targetZ = this.clampZoom(z);
    const centre = this.centreFor(wx, wy, targetZ);
    if (this.reducedMotion || duration <= 0) {
      this.jumpTo(wx, wy, targetZ);
      return;
    }
    const length = this.calm ? Math.min(duration, 0.35) : duration;
    const distance =
      Math.hypot(centre.x - this.x, centre.y - this.y) *
      Math.min(this.z, targetZ);
    const dip =
      !this.calm && distance > this.viewport.width * 0.9
        ? Math.min(0.6, Math.log(distance / this.viewport.width + 1) * 0.5)
        : 0;
    this.velocity = { x: 0, y: 0 };
    this.flight = {
      x0: this.x,
      y0: this.y,
      z0: this.z,
      x: centre.x,
      y: centre.y,
      z: targetZ,
      t: 0,
      duration: length + (dip ? 0.25 : 0),
      dip,
    };
  }

  get flying() {
    return this.flight !== null;
  }

  stop() {
    this.flight = null;
    this.velocity = { x: 0, y: 0 };
  }

  panBy(dx: number, dy: number) {
    this.flight = null;
    this.x -= dx / this.z;
    this.y -= dy / this.z;
    this.clampPosition();
  }

  /** Record release velocity in screen pixels per second for inertia. */
  release(vx: number, vy: number) {
    if (this.reducedMotion) return;
    this.velocity = { x: -vx / this.z, y: -vy / this.z };
  }

  /** Multiply zoom by `factor`, keeping screen point (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number, smooth = true) {
    this.flight = null;
    this.targetZ = this.clampZoom(this.targetZ * factor);
    this.anchor = { x: sx, y: sy };
    if (!smooth || this.reducedMotion) this.applyZoom(this.targetZ);
  }

  setZoom(z: number, sx: number, sy: number) {
    this.flight = null;
    this.anchor = { x: sx, y: sy };
    this.targetZ = this.clampZoom(z);
    this.applyZoom(this.targetZ);
  }

  private applyZoom(next: number) {
    const anchor = this.anchor ?? {
      x: this.viewport.width / 2,
      y: this.viewport.height / 2,
    };
    const world = this.toWorld(anchor.x, anchor.y);
    this.z = next;
    this.x = world.x - (anchor.x - this.viewport.width / 2) / next;
    this.y = world.y - (anchor.y - this.viewport.height / 2) / next;
    this.clampPosition();
  }

  /** Advance by dt seconds; returns whether the camera moved. */
  update(dt: number) {
    if (this.flight) {
      const flight = this.flight;
      flight.t += dt / flight.duration;
      const e = easeInOut(Math.min(1, flight.t));
      this.x = flight.x0 + (flight.x - flight.x0) * e;
      this.y = flight.y0 + (flight.y - flight.y0) * e;
      this.z = Math.exp(
        Math.log(flight.z0) +
          (Math.log(flight.z) - Math.log(flight.z0)) * e -
          flight.dip * Math.sin(Math.PI * e),
      );
      this.targetZ = this.z;
      if (flight.t >= 1) this.flight = null;
      this.clampPosition();
      return true;
    }
    let moved = false;
    if (Math.abs(Math.log(this.targetZ / this.z)) > 0.0005) {
      this.applyZoom(
        this.z * (this.targetZ / this.z) ** (1 - Math.exp(-dt * 16)),
      );
      moved = true;
    } else if (this.z !== this.targetZ) {
      this.applyZoom(this.targetZ);
      moved = true;
    }
    if (Math.abs(this.velocity.x) + Math.abs(this.velocity.y) > 1) {
      this.x += this.velocity.x * dt;
      this.y += this.velocity.y * dt;
      const decay = Math.exp(-dt * 5);
      this.velocity.x *= decay;
      this.velocity.y *= decay;
      this.clampPosition();
      moved = true;
    }
    return moved;
  }
}
