import { fixtureApartmentsClient } from "../testing/apartmentsFixture";
import type { ApartmentsClient } from "./apartmentsStore";

export const APARTMENTS_PREVIEW_PARAM = "apartments-preview";

/**
 * Explicit, one-load testing switch: `?apartments-preview=avatars` shows
 * synthetic residents, one per way a resident finds its avatar, in place of
 * the service's. The page removes the parameter at once, so a reload shows
 * the real residents again. Nothing is written to the service.
 */
export function apartmentsPreviewClient(
  client: ApartmentsClient,
): ApartmentsClient {
  if (typeof window === "undefined") return client;
  const url = new URL(window.location.href);
  const mode = url.searchParams.get(APARTMENTS_PREVIEW_PARAM);
  if (!mode) return client;
  url.searchParams.delete(APARTMENTS_PREVIEW_PARAM);
  window.history.replaceState(window.history.state, "", url);
  return mode === "avatars" ? fixtureApartmentsClient(Date.now()) : client;
}
