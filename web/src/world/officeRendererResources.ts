export const OFFICE_SCENE_DESTROY_OPTIONS = Object.freeze({
  children: true,
  context: true,
  style: true,
});

type OfficeSceneChild = {
  destroy(options: typeof OFFICE_SCENE_DESTROY_OPTIONS): void;
};

type OfficeSceneContainer = {
  removeChildren(): OfficeSceneChild[];
};

/** Release scene-owned Pixi resources without destroying shared character textures. */
export function destroyOfficeSceneChildren(container: OfficeSceneContainer) {
  for (const child of container.removeChildren()) {
    child.destroy(OFFICE_SCENE_DESTROY_OPTIONS);
  }
}
