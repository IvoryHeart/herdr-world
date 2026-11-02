import { Worker } from "node:worker_threads";
import { sshCommandArgv } from "../bridge/ssh-command";
import { shQuote } from "../utils/process-utils";
import type { CollectorOptions } from "./collector";
import { usageHostProgram } from "./program";
import {
  runUsageProcess,
  type SpawnUsageProcess,
  type UsageProcess,
} from "./process";

type Ports = {
  worker?(program: string): Worker;
  spawn?: SpawnUsageProcess;
};
type Channel = {
  send(value: string): Promise<void>;
  stop(): Promise<void>;
  failed: boolean;
};

/** One private parser cache on the transcript host, owned by one runtime generation. */
export class UsageReader {
  #channel?: Channel;
  #pending?: {
    id: number;
    resolve(value: unknown): void;
    reject(error: Error): void;
  };
  #serial = 0;
  #closed = false;
  #queue: Promise<unknown> = Promise.resolve();
  constructor(
    private host?: string,
    private ports: Ports = {},
  ) {}

  #start() {
    const fail = () => {
      channel.failed = true;
      this.#pending?.reject(new Error("Usage reader failed"));
    };
    const receive = (message: any) => {
      if (
        !this.#pending ||
        message?.id !== this.#pending.id ||
        message.error ||
        !message.value
      ) {
        fail();
        return;
      }
      this.#pending.resolve(message.value);
    };
    let channel: Channel;
    if (!this.host) {
      const program = usageHostProgram(undefined, "worker");
      const worker =
        this.ports.worker?.(program) ??
        new Worker(
          new URL(`data:text/javascript,${encodeURIComponent(program)}`),
        );
      worker.on("message", receive);
      worker.on("error", fail);
      worker.on("exit", fail);
      let stopped: Promise<void> | undefined;
      channel = {
        failed: false,
        send: async (value) => {
          worker.postMessage(JSON.parse(value));
        },
        stop: () =>
          (stopped ??= (async () => {
            await worker.terminate();
            worker.removeAllListeners();
          })()),
      };
    } else {
      const program = usageHostProgram(undefined, "ssh");
      const command = `if command -v bun >/dev/null 2>&1; then exec bun -e ${shQuote(program)}; elif command -v node >/dev/null 2>&1; then exec node --input-type=module -e ${shQuote(program)}; else exit 69; fi`;
      const owner = new AbortController();
      let child!: UsageProcess;
      const create: SpawnUsageProcess = (argv) => {
        child =
          this.ports.spawn?.(argv) ??
          Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
        return child;
      };
      const work = runUsageProcess(
        sshCommandArgv(this.host, `sh -c ${shQuote(command)}`),
        owner.signal,
        create,
        (frame) => {
          try {
            receive(JSON.parse(frame));
          } catch {
            throw new Error("Invalid usage frame");
          }
        },
      );
      // The pump is owned until stop/reap; no raw remote errors leave this boundary.
      void work.then(fail, fail);
      let stopped: Promise<void> | undefined;
      channel = {
        failed: false,
        send: async (value) => {
          await child.stdin.write!(value);
          await child.stdin.flush?.();
        },
        stop: () =>
          (stopped ??= (async () => {
            owner.abort();
            await work.catch(() => {});
          })()),
      };
    }
    this.#channel = channel;
    return channel;
  }

  read(options: CollectorOptions, signal: AbortSignal): Promise<unknown> {
    const work = this.#queue.then(async () => {
      signal.throwIfAborted();
      if (this.#closed) throw new Error("Usage reader closed");
      if (this.#channel?.failed) {
        await this.#channel.stop();
        this.#channel = undefined;
      }
      const channel = this.#channel ?? this.#start();
      const id = ++this.#serial;
      const request = JSON.stringify({ id, options }) + "\n";
      if (Buffer.byteLength(request) > 256 * 1024)
        throw new Error("Usage request limit");
      const result = new Promise<unknown>((resolve, reject) => {
        this.#pending = { id, resolve, reject };
      });
      const abort = () =>
        this.#pending?.reject(new Error("Usage reader cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      try {
        if (signal.aborted) abort();
        // Join send failure to the response promise before waiting on either.
        void channel.send(request).catch(() => {
          if (this.#pending?.id === id)
            this.#pending.reject(new Error("Usage request failed"));
        });
        return await result;
      } catch (error) {
        await channel.stop();
        if (this.#channel === channel) this.#channel = undefined;
        throw error;
      } finally {
        signal.removeEventListener("abort", abort);
        this.#pending = undefined;
      }
    });
    this.#queue = work.catch(() => {});
    return work;
  }

  async close() {
    this.#closed = true;
    this.#pending?.reject(new Error("Usage reader cancelled"));
    await this.#channel?.stop();
    this.#channel = undefined;
    await this.#queue;
  }
}
