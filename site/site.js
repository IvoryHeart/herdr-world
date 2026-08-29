// Current public preview: v0.1.0-rc.8
const installCommands = {
  npm: `npm install --global @ivoryheart/herdr-world@next
herdr-world`,
  brew: `brew install IvoryHeart/tap/herdr-world-rc
herdr-world`,
  herdr: `herdr plugin install IvoryHeart/herdr-world --ref v0.1.0-rc.8
herdr plugin action invoke open --plugin ivoryheart.herdr-world`,
};

const installTabs = [...document.querySelectorAll("[data-install-tab]")];
const installPanels = [...document.querySelectorAll("[data-install-panel]")];
const copyButton = document.querySelector("[data-copy-install]");
const copyLabel = document.querySelector("[data-copy-label]");

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

if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  window.addEventListener("pointermove", (event) => {
    document.documentElement.style.setProperty("--pointer-x", `${event.clientX}px`);
    document.documentElement.style.setProperty("--pointer-y", `${event.clientY}px`);
  }, { passive: true });
}
