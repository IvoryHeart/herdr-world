// Reading helpers are progressive enhancements: the whole tutorial is static HTML.
const article = document.querySelector(".tutorial-prose");

for (const [index, code] of [
  ...(article?.querySelectorAll("pre > code.language-bash") ?? []),
].entries()) {
  const pre = code.parentElement;
  if (!pre) continue;
  const row = document.createElement("div");
  row.className = "tutorial-copy-row";
  const hint = document.createElement("span");
  hint.textContent =
    "Copy only - check the host and placeholders before running";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Copy command";
  button.setAttribute("aria-label", `Copy command example ${index + 1}`);
  button.setAttribute("aria-live", "polite");
  row.append(hint, button);
  pre.before(row);
  let resetTimer = 0;

  button.addEventListener("click", async () => {
    try {
      if (!navigator.clipboard || !window.isSecureContext) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(code.textContent ?? "");
      button.textContent = "Copied";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      button.textContent = "Selected - copy manually";
    }
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      button.textContent = "Copy command";
    }, 2400);
  });
}

const checks = [...(article?.querySelectorAll('input[type="checkbox"]') ?? [])];
// Bump this key if the meaning or order of the final checklist changes.
const storageKey = "herdr-world-tutorial-checklist-v1";
let savedChecks = [];
let storageAvailable = true;
try {
  const raw = localStorage.getItem(storageKey);
  const stored = JSON.parse(raw ?? "[]");
  if (Array.isArray(stored)) savedChecks = stored;
} catch {
  storageAvailable = false;
}

const checkStatus = document.querySelector("[data-check-status]");
const updateCheckStatus = () => {
  if (!checkStatus) return;
  const completed = checks.filter((check) => check.checked).length;
  checkStatus.textContent = `Self-check: ${completed}/${checks.length} complete. ${storageAvailable ? "Saved only in this browser; uncheck any item to reset it." : "Progress cannot be saved here and will reset on reload."}`;
};

checks.forEach((check, index) => {
  check.disabled = false;
  check.checked = savedChecks[index] === true;
  const item = check.closest("li");
  if (item) {
    const label = document.createElement("label");
    label.append(...item.childNodes);
    item.append(label);
  }
  check.addEventListener("change", () => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify(checks.map((entry) => entry.checked)),
      );
      storageAvailable = true;
    } catch {
      storageAvailable = false;
    }
    updateCheckStatus();
  });
});
updateCheckStatus();

// Mark the chapter and section being read; CSS opens only that chapter's sections.
const headings = [...(article?.querySelectorAll("h2[id], h3[id]") ?? [])];
const links = [...document.querySelectorAll(".tutorial-toc a")];
let scheduled = false;
const updateChapter = () => {
  scheduled = false;
  let chapter;
  let section;
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top > 100) break;
    if (heading.tagName === "H2") {
      chapter = heading;
      section = undefined;
    } else section = heading;
  }
  chapter ??= headings.find((heading) => heading.tagName === "H2");
  for (const link of links) {
    if (link.hash === `#${chapter?.id}` || link.hash === `#${section?.id}`) {
      link.setAttribute("aria-current", "location");
    } else {
      link.removeAttribute("aria-current");
    }
  }
};
window.addEventListener(
  "scroll",
  () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(updateChapter);
  },
  { passive: true },
);
updateChapter();
