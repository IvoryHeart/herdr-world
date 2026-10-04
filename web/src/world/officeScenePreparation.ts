import { PrepareSystem, type Container } from "pixi.js";
import { yieldWorldTask } from "./worldObject";

/** Upload text and tessellate graphics before paint, with input turns between batches. */
export class OfficeScenePreparation extends PrepareSystem {
  async prepareScene(root: Container, current: () => boolean) {
    const pending = [root];
    const uploaded = new Set<Parameters<PrepareSystem["uploadQueueItem"]>[0]>();
    let began = performance.now();
    let count = 0;
    while (pending.length) {
      if (!current()) return false;
      const node = pending.pop()!;
      const resources: Parameters<PrepareSystem["uploadQueueItem"]>[0][] = [];
      this.resolveQueueItem(node, resources);
      for (const resource of resources) {
        if (!uploaded.has(resource)) {
          this.uploadQueueItem(resource);
          uploaded.add(resource);
        }
      }
      pending.push(...node.children);
      if (++count >= 64 || performance.now() - began >= 4) {
        await yieldWorldTask();
        if (!current()) return false;
        began = performance.now();
        count = 0;
      }
    }
    return current();
  }
}
