import { EventEmitter } from "node:events";
import * as net from "node:net";
import { BinReader, BinWriter, encodeFrame } from "./bincode";
import type { FrameData } from "./thin-client";
import {
  SurfaceReader,
  type SurfaceBaseline,
  SURFACE_DELTA_KIND,
  SURFACE_REUSE_KIND,
  readFullSurface,
  readSurfacePatch,
  readSurfaceDelta,
  readSurfaceReuse,
} from "./endpoint-surface";

import { type PaneInputEvent, encodePaneInput } from "./vt-input-classifier";
import { isTerminalClipboardPayload } from "./terminal-clipboard";

const HANDSHAKE_TIMEOUT_MS = 8_000;

// ClientMessage tags used by the stable endpoint contract. The variant order is
// frozen for endpoint generation 1; compatible behavior arrives through
// EndpointControl, not new variants.
const CM = {
  ClientShellResize: 12,
  ClientShellPaneInput: 13,
  ClientShellEndpointRequest: 15,
  EndpointControl: 20,
} as const;

// ServerMessage tags (frozen for endpoint generation 1).
const SM = {
  Welcome: 0,
  Clipboard: 5,
  ClientShellSnapshot: 12,
  PaneSurface: 13,
  ClientShellError: 15,
  ClientShellEndpointResponseChunk: 18,
  PaneSurfacePatch: 19,
  EndpointControl: 20,
} as const;

const ENDPOINT_GENERATION = 1;
const HELLO_KIND = "endpoint.hello.v1";
const WELCOME_KIND = "endpoint.welcome.v1";
const SNAPSHOT_KIND = "shell.snapshot.v1";
const HEALTH_PING_KIND = "endpoint.health.ping.v1";
const HEALTH_PONG_KIND = "endpoint.health.pong.v1";

export interface EndpointWelcome {
  generation: number;
  serverVersion: string;
  methods: string[];
  capabilities: string[];
}

export interface EndpointSnapshot {
  bootId: string;
  revision: number;
  /** Parsed shell.snapshot.v1 JSON; additive fields are ignored. */
  raw: Record<string, unknown>;
}

export interface PaneSurfacePaneMeta {
  contentRevision: number;
  paneId: string;
  rect: { x: number; y: number; width: number; height: number };
  /** Content area inside decorations; crop targets this rect. */
  innerRect: { x: number; y: number; width: number; height: number };
  scroll: {
    offsetFromBottom: number;
    maxOffsetFromBottom: number;
    viewportRows: number;
  } | null;
  focused: boolean;
  mouseReporting: boolean;
}

export interface EndpointSurface {
  frame: FrameData;
  surfaceRevision: number;
  panes: PaneSurfacePaneMeta[];
}

/**
 * Client-owned shell connection to a Herdr >= 0.9.0 server over
 * herdr-client.sock, speaking the stable endpoint generation 1 contract:
 * bincode-envelope `EndpointControl` with JSON payloads, plus the frozen
 * PaneSurface/PaneSurfacePatch codecs and negotiated delta/reuse controls.
 *
 * `connect` waits for both the welcome and the first valid shell.snapshot.v1
 * so endpoint methods can use its boot ID. Full surfaces replace the
 * composed frame; patches are applied to it. Consumers only ever see a
 * complete `FrameData` per `surface` event.
 *
 * Input is intentionally not implemented here yet; see the bridge for the
 * semantic-input classifier.
 */
export class EndpointClient extends EventEmitter {
  private sock: net.Socket | null = null;
  private buf = Buffer.alloc(0);
  private closed = false;
  private welcomed = false;
  private welcome: EndpointWelcome | null = null;
  private pendingWelcome:
    | {
        resolve: () => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  private surface: SurfaceBaseline | null = null;
  private bootId = "";
  private requestSeq = 0;
  private pendingRequests = new Map<
    string,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      chunks: string[];
      timer?: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private socketPath: string,
    private surfaceCodecsEnabled = true,
  ) {
    super();
  }

  get isClosed() {
    return this.closed;
  }

  /** Latest composed surface, for consumers that join mid-stream. */
  get currentSurface(): EndpointSurface | null {
    return this.surface;
  }

  /** Advertisement belongs to this socket only, never a server-wide cache. */
  get negotiation(): EndpointWelcome | null {
    return this.closed || !this.welcome
      ? null
      : {
          ...this.welcome,
          methods: [...this.welcome.methods],
          capabilities: [...this.welcome.capabilities],
        };
  }

  assertMethod(method: string): void {
    if (this.closed) throw new Error("endpoint client closed");
    if (!this.welcome)
      throw new Error("Herdr endpoint availability is still loading");
    if (!this.welcome.methods.includes(method))
      throw new Error(`Herdr endpoint does not advertise ${method}`);
  }

  async connect(cols: number, rows: number): Promise<void> {
    if (this.sock) throw new Error("endpoint client is already connected");
    if (this.closed) throw new Error("endpoint client is closed");
    await new Promise<void>((resolve, reject) => {
      const sock = net.createConnection({ path: this.socketPath });
      this.sock = sock;
      const timer = setTimeout(() => {
        this.rejectWelcome(
          new Error(
            "timed out waiting for Herdr endpoint welcome and snapshot",
          ),
        );
        this.close();
      }, HANDSHAKE_TIMEOUT_MS);
      this.pendingWelcome = { resolve, reject, timer };
      sock.once("connect", () => this.sendHello(cols, rows));
      sock.on("data", (c) =>
        this.onData(Buffer.isBuffer(c) ? c : Buffer.from(c)),
      );
      sock.on("error", (e) => {
        this.rejectWelcome(e);
        this.emit("error", e);
      });
      sock.on("close", () => {
        this.close();
        this.emit("close");
      });
    });
  }

  private sendHello(cols: number, rows: number) {
    const hello = {
      generation: ENDPOINT_GENERATION,
      cell_width_px: 0,
      cell_height_px: 0,
      surface_size: { cols, rows },
      pixel_mouse: false,
      direct_graphics: false,
      endpoint_keybindings: false,
      mouse_capture: false,
      surface_active: true,
      surface_delta: this.surfaceCodecsEnabled,
      surface_reuse: this.surfaceCodecsEnabled,
      snapshot_codecs: ["shell.snapshot.v1"],
      surface_codecs: ["shell.surface.v1"],
      input_codecs: ["shell.input.semantic.v1"],
      blob_codecs: ["shell.blob.v1"],
    };
    this.sendControl(HELLO_KIND, JSON.stringify(hello));
  }

  private sendControl(kind: string, data: string) {
    const w = new BinWriter();
    w.variant(CM.EndpointControl);
    w.string(kind);
    w.string(data);
    this.write(w.toBuffer());
  }

  private assertNegotiatedCodecs() {
    if (this.closed) throw new Error("endpoint client closed");
    if (!this.welcome)
      throw new Error("Herdr endpoint codecs have not been negotiated");
  }

  resize(cols: number, rows: number) {
    this.assertNegotiatedCodecs();
    const w = new BinWriter();
    w.variant(CM.ClientShellResize);
    w.varint(0); // cell_width_px
    w.varint(0); // cell_height_px
    w.varint(cols);
    w.varint(rows);
    w.bool(false); // pixel_mouse
    this.write(w.toBuffer());
  }

  /** Probe the server; any inbound message (pong or otherwise) is liveness. */
  ping() {
    if (this.welcome?.capabilities.includes("health_check"))
      this.sendControl(HEALTH_PING_KIND, "{}");
  }

  /** Deliver classified semantic input to one pane. */
  sendPaneInput(paneId: string, events: PaneInputEvent[]) {
    if (events.length === 0) return;
    this.assertNegotiatedCodecs();
    this.write(encodePaneInput(paneId, events));
  }

  /** Invoke an advertised endpoint method (e.g. pane.focus, pane.scroll). */
  callEndpoint(
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error("endpoint client closed"));
    }
    if (!this.bootId) {
      return Promise.reject(new Error("endpoint snapshot has not arrived yet"));
    }
    try {
      this.assertMethod(method);
    } catch (error) {
      return Promise.reject(error);
    }
    const requestId = `gui_${++this.requestSeq}`;
    const w = new BinWriter();
    w.variant(CM.ClientShellEndpointRequest);
    w.string(this.bootId);
    w.string(JSON.stringify({ id: requestId, method, params }));
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              this.pendingRequests.delete(requestId);
              reject(new Error(`Endpoint ${method} timed out`));
            }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        chunks: [],
        timer,
      });
      this.write(w.toBuffer());
    });
  }

  close() {
    this.closed = true;
    this.surface = null;
    this.rejectWelcome(new Error("endpoint client closed during handshake"));
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("endpoint client closed"));
    }
    this.pendingRequests.clear();
    this.sock?.destroy();
  }

  private write(msg: Buffer) {
    if (this.sock && !this.closed) this.sock.write(encodeFrame(msg));
  }

  private resolveWelcome() {
    if (!this.welcomed || !this.bootId) return;
    const pending = this.pendingWelcome;
    if (!pending) return;
    this.pendingWelcome = undefined;
    clearTimeout(pending.timer);
    pending.resolve();
  }

  private rejectWelcome(error: Error) {
    const pending = this.pendingWelcome;
    if (!pending) return;
    this.pendingWelcome = undefined;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private onData(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32LE(0);
      if (len > 32 * 1024 * 1024) {
        const error = new Error(`oversized frame: ${len}`);
        this.buf = Buffer.alloc(0);
        this.rejectWelcome(error);
        this.close();
        this.emit("error", error);
        return;
      }
      if (this.buf.length < 4 + len) return;
      const payload = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      this.handlePayload(payload);
      if (this.closed) return;
    }
  }

  private handlePayload(payload: Buffer) {
    if (this.closed) return;
    try {
      const r = new BinReader(payload);
      const variant = r.variant();
      if (variant === SM.EndpointControl) {
        this.handleControl(r.string(), r.string());
      } else if (variant === SM.Clipboard) {
        // Tagged 0.9.0: one base64 String, with no producing pane identity.
        const data = r.string();
        if (r.remaining === 0 && isTerminalClipboardPayload(data)) {
          this.emit("clipboard", { data });
        }
      } else if (
        variant === SM.PaneSurface ||
        variant === SM.PaneSurfacePatch
      ) {
        this.assertNegotiatedCodecs();
        const reader = new SurfaceReader(payload);
        reader.variant();
        this.acceptSurface(
          variant === SM.PaneSurface
            ? readFullSurface(reader)
            : readSurfacePatch(reader, this.surface),
        );
      } else if (variant === SM.ClientShellSnapshot) {
        // The server delivers snapshots as EndpointControl JSON; this variant
        // exists in the frozen enum but is not currently sent.
      } else if (variant === SM.ClientShellError) {
        this.emit("shell_error", r.string());
      } else if (variant === SM.ClientShellEndpointResponseChunk) {
        r.string(); // boot_id
        const requestId = r.string();
        const finalChunk = r.bool();
        const data = r.bytes().toString("utf8");
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          pending.chunks.push(data);
          if (finalChunk) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(requestId);
            try {
              const parsed = JSON.parse(pending.chunks.join(""));
              if (parsed.error) {
                pending.reject(
                  new Error(parsed.error.message ?? "endpoint request failed"),
                );
              } else {
                pending.resolve(parsed.result);
              }
            } catch (e) {
              pending.reject(e instanceof Error ? e : new Error(String(e)));
            }
          }
        }
      } else if (variant === SM.Welcome) {
        // Legacy same-install welcome: means the server predates endpoint
        // generation 1 and could not parse our hello as EndpointControl.
        const error = new Error(
          "Herdr server does not speak endpoint generation 1 (needs >= 0.9.0)",
        );
        this.rejectWelcome(error);
        this.close();
        this.emit("error", error);
      }
      // Other optional server messages are ignored.
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      this.rejectWelcome(error);
      this.close();
      this.emit("error", error);
    }
  }

  private handleControl(kind: string, data: string) {
    if (kind === WELCOME_KIND) {
      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        const error = new Error("malformed endpoint welcome");
        this.rejectWelcome(error);
        this.close();
        this.emit("error", error);
        return;
      }
      if (parsed.error) {
        const error = new Error(
          `Herdr rejected endpoint hello (${parsed.error.code}): ${parsed.error.message}`,
        );
        this.rejectWelcome(error);
        this.close();
        this.emit("error", error);
        return;
      }
      if (
        parsed.generation !== ENDPOINT_GENERATION ||
        parsed.snapshot_codec !== "shell.snapshot.v1" ||
        parsed.surface_codec !== "shell.surface.v1" ||
        parsed.input_codec !== "shell.input.semantic.v1" ||
        parsed.blob_codec !== "shell.blob.v1"
      ) {
        throw new Error("Unsupported Herdr endpoint generation or codecs");
      }
      for (const field of ["methods", "capabilities"]) {
        if (
          parsed[field] !== undefined &&
          (!Array.isArray(parsed[field]) ||
            parsed[field].some((v: unknown) => typeof v !== "string"))
        )
          throw new Error(`Malformed Herdr endpoint ${field}`);
      }
      const welcome: EndpointWelcome = {
        generation: parsed.generation,
        serverVersion: parsed.server_version,
        methods: parsed.methods ?? [],
        capabilities: parsed.capabilities ?? [],
      };
      this.welcome = welcome;
      this.welcomed = true;
      this.emit("welcome", welcome);
      this.resolveWelcome();
      return;
    }
    if (kind === SNAPSHOT_KIND) {
      try {
        const raw = JSON.parse(data);
        const snapshot: EndpointSnapshot = {
          bootId: typeof raw.boot_id === "string" ? raw.boot_id : "",
          revision: raw.revision ?? 0,
          raw,
        };
        if (this.bootId && snapshot.bootId && this.bootId !== snapshot.bootId) {
          this.close();
          throw new Error("Herdr endpoint boot changed; reconnect required");
        }
        this.bootId = snapshot.bootId;
        this.emit("snapshot", snapshot);
        this.resolveWelcome();
      } catch (e) {
        this.emit("error", e instanceof Error ? e : new Error(String(e)));
      }
      return;
    }
    if (kind === HEALTH_PING_KIND) {
      if (this.welcome?.capabilities.includes("health_check"))
        this.sendControl(HEALTH_PONG_KIND, data);
      return;
    }
    if (kind === SURFACE_DELTA_KIND || kind === SURFACE_REUSE_KIND) {
      const capability =
        kind === SURFACE_DELTA_KIND ? "surface_delta" : "surface_reuse";
      if (
        !this.surfaceCodecsEnabled ||
        !this.welcome?.capabilities.includes(capability)
      )
        throw new Error(`Herdr sent unnegotiated ${capability}`);
      this.acceptSurface(
        kind === SURFACE_DELTA_KIND
          ? readSurfaceDelta(data, this.surface)
          : readSurfaceReuse(data, this.surface),
      );
      return;
    }
    // Unknown named controls are optional and ignored per the contract.
  }

  private acceptSurface(surface: SurfaceBaseline) {
    if (
      surface.bootId !== this.bootId ||
      (this.surface &&
        (surface.surfaceRevision <= this.surface.surfaceRevision ||
          surface.projectionRevision < this.surface.projectionRevision))
    )
      throw new Error(
        "Invalid endpoint surface identity or revision; reconnect required",
      );
    this.surface = surface;
    this.emit("surface", surface);
  }
}
