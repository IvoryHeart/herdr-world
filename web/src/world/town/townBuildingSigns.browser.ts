type WaitFor = (
  condition: () => boolean,
  message: string | (() => string),
) => Promise<void>;

/** Production Town DOM: no projection refresh or forced sign styling. */
export async function checkTownBuildingSigns(
  host: HTMLElement,
  waitFor: WaitFor,
  check: (condition: boolean, message: string) => void,
) {
  await waitFor(
    () => window.__HERDR_TOWN_RENDERER__?.ready === true,
    "cold recovery renderer never became ready",
  );
  const renderer = window.__HERDR_TOWN_RENDERER__!;
  const canvas = host.querySelector<HTMLElement>(".town-canvas-host")!;
  const key = (value: string, count: number) => {
    for (let index = 0; index < count; index++)
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", { key: value, bubbles: true }),
      );
  };
  const atRoofLevel = async () => {
    const before = renderer.frames;
    key("-", 12);
    await waitFor(
      () =>
        renderer.frames > before &&
        renderer.level === "town" &&
        !renderer.flying,
      "recovery proof never reached roof level through normal camera input",
    );
  };
  const signs = () => [
    ...host.querySelectorAll<HTMLElement>("[data-building-sign]"),
  ];
  const visible = (node: HTMLElement | null | undefined) => {
    if (!node?.isConnected) return false;
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return (
      node.style.opacity !== "" &&
      style.visibility === "visible" &&
      Number(style.opacity) > 0.5 &&
      box.width > 0 &&
      box.height > 0 &&
      box.right > 0 &&
      box.left < window.innerWidth &&
      box.bottom > 0 &&
      box.top < window.innerHeight
    );
  };
  const visibleReception = (sign: HTMLElement) => {
    const reception = sign
      .closest(".town-building-layer")
      ?.querySelector<HTMLElement>(".town-reception");
    if (!reception) return false;
    const box = reception.getBoundingClientRect();
    const style = getComputedStyle(reception);
    return (
      style.visibility === "visible" &&
      Number(style.opacity) > 0.5 &&
      box.width > 0 &&
      box.height > 0 &&
      box.bottom > 0 &&
      box.top < window.innerHeight
    );
  };
  const visiblePair = () =>
    signs().length === 2 &&
    signs().every((sign) => visible(sign) && visibleReception(sign));

  await atRoofLevel();
  await waitFor(
    visiblePair,
    "cold mount did not show both building signs and receptions at roof level",
  );
  const geometry = renderer.layout?.geometry;
  const stale = signs().find((sign) =>
    sign.closest('.town-building-layer[data-stale="true"]'),
  )!;
  const healthy = signs().find((sign) => sign !== stale)!;
  check(Boolean(stale), "the cold fixture lost its failed cached host");
  if (!stale) return;
  check(
    stale.textContent?.includes("Disconnected") === true &&
      stale.querySelector('button[aria-label^="Reconnect "]') !== null,
    "failed building sign lost its explicit recovery control",
  );
  check(
    stale
      .closest(".town-building-layer")
      ?.querySelector('.town-reception button[aria-label^="Reconnect "]') !==
      null,
    "failed reception lost its explicit recovery control",
  );
  check(
    healthy.querySelector(".connection-recovery") === null,
    "the healthy sibling acquired failed-host recovery presentation",
  );

  key("+", 12);
  await waitFor(
    () => renderer.zoom > 2,
    "normal zoom did not open the roofs before culling",
  );
  await waitFor(
    () => !stale.isConnected || stale.style.visibility === "hidden",
    "normal open-roof behavior left the failed building sign visible",
  );
  key("ArrowRight", 80);
  key("ArrowDown", 80);
  await waitFor(
    () => !stale.isConnected,
    "normal camera culling did not detach the original failed-host sign",
  );

  const before = renderer.frames;
  host
    .querySelector<HTMLButtonElement>('[aria-label="Show the whole town"]')!
    .click();
  await waitFor(
    () => renderer.frames > before && !renderer.flying,
    "return from culling did not finish its camera flight",
  );
  await atRoofLevel();
  await waitFor(
    visiblePair,
    "returning culled buildings did not restore both signs and receptions",
  );
  const replacement = signs().find(
    (sign) => sign.dataset.buildingSign === stale.dataset.buildingSign,
  );
  check(
    replacement !== stale,
    "culling did not commit a replacement sign node",
  );
  check(
    renderer.layout?.geometry === geometry,
    "the sign proof changed layout instead of exercising committed nodes",
  );
  check(renderer.lastError === null, "recovery sign rendering raised an error");
  check(
    renderer.activeApplications === 1,
    "recovery sign proof leaked a renderer",
  );
}
