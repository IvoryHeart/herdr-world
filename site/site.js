const installCommand = `herdr

# In another terminal
VERSION=v0.1.0-rc.1
curl -fLO "https://github.com/IvoryHeart/herdr-world/releases/download/\${VERSION}/herdr-world-\${VERSION}-linux-x86_64.tar.gz"
curl -fLO "https://github.com/IvoryHeart/herdr-world/releases/download/\${VERSION}/herdr-world-\${VERSION}-linux-x86_64.tar.gz.sha256"
sha256sum --check "herdr-world-\${VERSION}-linux-x86_64.tar.gz.sha256"
tar -xzf "herdr-world-\${VERSION}-linux-x86_64.tar.gz"
cd "herdr-world-\${VERSION}-linux-x86_64"
bin/herdr-world`;

const copyButton = document.querySelector("[data-copy-install]");
const copyLabel = document.querySelector("[data-copy-label]");

copyButton?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(installCommand);
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
