/** The service refuses more than 64 KiB of keys in one call. */
export const MAX_FLOAT_INPUT_BYTES = 48 * 1024;

/**
 * The float shell's keys, sent one call at a time so they arrive in the order
 * typed; what is typed meanwhile joins the next call. A paste larger than one
 * call (xterm hands it over whole) goes out as consecutive calls, every byte
 * in order. After a failed call nothing more is sent or replayed: a person
 * sees what reached the shell and retypes.
 */
export class FloatShellInput {
  private pending: Uint8Array[] = [];
  private sending = false;

  constructor(
    private readonly send: (bytes: Uint8Array) => Promise<void>,
    /** Whether the stream is still open; checked before every call. */
    private readonly open: () => boolean,
    private readonly failed: (error: unknown) => void,
    private readonly maxBytes = MAX_FLOAT_INPUT_BYTES,
  ) {}

  push(bytes: Uint8Array): Promise<void> {
    for (let at = 0; at < bytes.byteLength; at += this.maxBytes)
      this.pending.push(bytes.subarray(at, at + this.maxBytes));
    return this.flush();
  }

  /** The stream is gone: what was not sent never will be. */
  clear() {
    this.pending = [];
  }

  private async flush() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.pending.length && this.open()) {
        let size = 0;
        let count = 0;
        while (
          count < this.pending.length &&
          size + this.pending[count]!.byteLength <= this.maxBytes
        )
          size += this.pending[count++]!.byteLength;
        const take = this.pending.splice(0, count);
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const part of take) {
          bytes.set(part, at);
          at += part.byteLength;
        }
        await this.send(bytes);
      }
    } catch (error) {
      this.pending = [];
      this.failed(error);
    } finally {
      this.sending = false;
    }
  }
}
