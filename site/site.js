// Current public preview: v0.1.0
const installCommands = {
  npm: `npm install --global @ivoryheart/herdr-world@latest
herdr-world`,
  brew: `brew install IvoryHeart/tap/herdr-world
herdr-world`,
  herdr: `herdr plugin install IvoryHeart/herdr-world --ref v0.1.0
herdr plugin action invoke open --plugin ivoryheart.herdr-world`,
  cli: `VERSION=v0.1.0
PLATFORM=linux-x86_64
curl -fLO "https://github.com/IvoryHeart/herdr-world/releases/download/\${VERSION}/herdr-world-\${VERSION}-\${PLATFORM}.tar.gz"
curl -fLO "https://github.com/IvoryHeart/herdr-world/releases/download/\${VERSION}/herdr-world-\${VERSION}-\${PLATFORM}.tar.gz.sha256"
tar -xzf "herdr-world-\${VERSION}-\${PLATFORM}.tar.gz"
cd "herdr-world-\${VERSION}-\${PLATFORM}"
bin/herdr-world`,
};

const installTabs = [...document.querySelectorAll("[data-install-tab]")];
const installPanels = [...document.querySelectorAll("[data-install-panel]")];
const copyButton = document.querySelector("[data-copy-install]");
const copyLabel = document.querySelector("[data-copy-label]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function selectInstallTab(name, shouldFocus = false) {
  for (const tab of installTabs) {
    const selected = tab.dataset.installTab === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && shouldFocus) tab.focus();
  }

  for (const panel of installPanels) {
    panel.hidden = panel.dataset.installPanel !== name;
  }
}

for (const [index, tab] of installTabs.entries()) {
  tab.addEventListener("click", () => selectInstallTab(tab.dataset.installTab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? installTabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + installTabs.length) % installTabs.length;
    selectInstallTab(installTabs[nextIndex].dataset.installTab, true);
  });
}

copyButton?.addEventListener("click", async () => {
  const selectedTab = installTabs.find((tab) => tab.getAttribute("aria-selected") === "true");
  const command = selectedTab ? installCommands[selectedTab.dataset.installTab] : null;
  if (!command) return;

  try {
    await navigator.clipboard.writeText(command);
    if (copyLabel) copyLabel.textContent = "Copied";
  } catch {
    if (copyLabel) copyLabel.textContent = "Select text";
  }

  window.setTimeout(() => {
    if (copyLabel) copyLabel.textContent = "Copy";
  }, 1800);
});

const carousel = document.querySelector("[data-carousel]");

if (carousel) {
  const track = carousel.querySelector("[data-carousel-track]");
  const slides = [...carousel.querySelectorAll("[data-carousel-slide]")];
  const dots = [...carousel.querySelectorAll("[data-carousel-go-to]")];
  const previous = carousel.querySelector("[data-carousel-previous]");
  const next = carousel.querySelector("[data-carousel-next]");
  const toggle = carousel.querySelector("[data-carousel-toggle]");
  const toggleLabel = carousel.querySelector("[data-carousel-toggle-label]");
  const status = carousel.querySelector("[data-carousel-status]");
  let activeIndex = 0;
  let timer = null;
  let userPaused = reducedMotion.matches;
  let pointerPaused = false;
  let focusPaused = false;

  const isPaused = () => userPaused || pointerPaused || focusPaused || document.hidden;

  function scheduleAdvance() {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (slides.length < 2 || isPaused()) return;
    timer = window.setTimeout(() => selectSlide(activeIndex + 1), 5200);
  }

  function syncToggle() {
    const label = userPaused ? "Play" : "Pause";
    if (toggleLabel) toggleLabel.textContent = label;
    toggle?.setAttribute("aria-label", `${label} product previews`);
  }

  function selectSlide(nextIndex, announce = false) {
    if (!track || slides.length === 0) return;
    activeIndex = (nextIndex + slides.length) % slides.length;
    track.style.transform = `translate3d(-${activeIndex * 100}%, 0, 0)`;
    for (const [index, slide] of slides.entries()) {
      slide.setAttribute("aria-hidden", String(index !== activeIndex));
    }
    for (const [index, dot] of dots.entries()) {
      dot.setAttribute("aria-current", String(index === activeIndex));
    }
    if (announce && status) status.textContent = slides[activeIndex].getAttribute("aria-label") ?? "";
    scheduleAdvance();
  }

  previous?.addEventListener("click", () => selectSlide(activeIndex - 1, true));
  next?.addEventListener("click", () => selectSlide(activeIndex + 1, true));
  for (const dot of dots) {
    dot.addEventListener("click", () => selectSlide(Number(dot.dataset.carouselGoTo), true));
  }
  toggle?.addEventListener("click", () => {
    userPaused = !userPaused;
    syncToggle();
    scheduleAdvance();
  });
  carousel.addEventListener("pointerenter", () => {
    pointerPaused = true;
    scheduleAdvance();
  });
  carousel.addEventListener("pointerleave", () => {
    pointerPaused = false;
    scheduleAdvance();
  });
  carousel.addEventListener("focusin", () => {
    focusPaused = true;
    scheduleAdvance();
  });
  carousel.addEventListener("focusout", (event) => {
    if (event.relatedTarget instanceof Node && carousel.contains(event.relatedTarget)) return;
    focusPaused = false;
    scheduleAdvance();
  });
  document.addEventListener("visibilitychange", scheduleAdvance);
  syncToggle();
  selectSlide(0);
}

if (!reducedMotion.matches) {
  window.addEventListener("pointermove", (event) => {
    document.documentElement.style.setProperty("--pointer-x", `${event.clientX}px`);
    document.documentElement.style.setProperty("--pointer-y", `${event.clientY}px`);
  }, { passive: true });
}
