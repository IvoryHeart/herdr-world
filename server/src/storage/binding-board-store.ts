import {
  BoardStore,
  type BoardDocument,
  type BoardOp,
} from "../world/board-store";
import { boardBindingCaptures } from "../world/board-bindings";
import { STORAGE_BOUNDS } from "./world-protocol";
import type { WorldBindings } from "./world-bindings";

/** JSON remains the compatibility document; its binding captures drain to SQLite. */
export class BindingBoardStore extends BoardStore {
  private tail = Promise.resolve();
  private pending = 0;
  private signature: string | undefined;
  private failure: Error | undefined;
  private readonly fault = Promise.withResolvers<Error>();
  readonly failed = this.fault.promise;
  constructor(
    path: string,
    options: ConstructorParameters<typeof BoardStore>[1],
    private readonly bindings: WorldBindings,
  ) {
    super(path, options);
    this.capture(this.get());
  }
  override patch(ops: readonly BoardOp[]): BoardDocument {
    if (this.failure) throw this.failure;
    if (this.pending >= STORAGE_BOUNDS.queuedOperations)
      throw new Error("World binding capture admission limit reached");
    const document = super.patch(ops);
    this.capture(document);
    return document;
  }
  private capture(document: BoardDocument) {
    const captures = boardBindingCaptures(document);
    const signature = JSON.stringify(captures);
    if (signature === this.signature) return;
    this.signature = signature;
    this.pending++;
    const operation = this.bindings.captureLegacy(captures);
    this.tail = operation.then(
      () => {
        this.pending--;
      },
      (error: Error) => {
        this.pending--;
        this.failure ??= error;
        this.fault.resolve(this.failure);
      },
    );
  }
  async settled() {
    await this.tail;
    if (this.failure) throw this.failure;
  }
}
