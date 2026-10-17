import { expect, test } from "bun:test";
import { Container, type PrepareSystem, type Renderer } from "pixi.js";
import { OfficeScenePreparation } from "./officeScenePreparation";

class RecordingPreparation extends OfficeScenePreparation {
  visited: Container[] = [];
  protected override resolveQueueItem(source: Container) {
    this.visited.push(source);
    return null;
  }
  protected override uploadQueueItem(
    _resource: Parameters<PrepareSystem["uploadQueueItem"]>[0],
  ) {}
}

test("cold preparation yields to ordinary tasks before completing a dense layer", async () => {
  const root = new Container();
  root.addChild(...Array.from({ length: 80 }, () => new Container()));
  const preparation = new RecordingPreparation({} as Renderer);
  let admittedAt = 0;
  const task = new Promise<void>((resolve) =>
    setTimeout(() => {
      admittedAt = preparation.visited.length;
      resolve();
    }, 0),
  );
  expect(await preparation.prepareScene(root, () => true)).toBe(true);
  await task;
  expect(admittedAt).toBeGreaterThan(0);
  expect(admittedAt).toBeLessThan(81);
  expect(preparation.visited).toHaveLength(81);
  preparation.destroy();
  root.destroy({ children: true });
});

test("superseded or disposed scene preparation stops before touching retired nodes", async () => {
  const root = new Container();
  root.addChild(...Array.from({ length: 80 }, () => new Container()));
  const preparation = new RecordingPreparation({} as Renderer);
  let current = true;
  setTimeout(() => {
    current = false;
    root.destroy({ children: true });
  }, 0);
  expect(await preparation.prepareScene(root, () => current)).toBe(false);
  expect(preparation.visited.length).toBeLessThan(81);
  preparation.destroy();
});
