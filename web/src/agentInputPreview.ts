// Testing only. main.tsx loads this before routing or any lazy view can
// rewrite the URL. Keep the refusal for this page's lifetime, without storage;
// reloading the cleaned URL restores normal delivery.
export const previewAgentInputRefused = (() => {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  const enabled = url.searchParams.get("agentInputGuard") === "refused";
  if (url.searchParams.has("agentInputGuard")) {
    url.searchParams.delete("agentInputGuard");
    window.history.replaceState(window.history.state, "", url);
  }
  return enabled;
})();
