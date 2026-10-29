import { useEffect, useState } from "react";

/** Whether a media query matches, updating as the viewport changes. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.(query).matches === true,
  );
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
