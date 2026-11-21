/**
 * Links to a setting (#1035): `?setting=<id>` opens Settings at that entry,
 * page or category. The parameter is removed from the address at once, so a
 * reload does not open it again. `?settings=next`, the preview's old switch,
 * is removed too, so an old link still opens World cleanly.
 */

const LINK_PARAM = "setting";
const OLD_SWITCH_PARAM = "settings";

let read = false;
let pendingLink: string | null = null;

function take(href: string) {
  const url = new URL(href);
  const link = url.searchParams.get(LINK_PARAM);
  const old = url.searchParams.has(OLD_SWITCH_PARAM);
  if (link === null && !old) return null;
  if (link) pendingLink = link;
  url.searchParams.delete(LINK_PARAM);
  url.searchParams.delete(OLD_SWITCH_PARAM);
  return url;
}

/** The setting a link asked for, once; null after the first read. */
export function takeSettingsLink() {
  if (!read && typeof location !== "undefined") {
    read = true;
    const cleaned = take(location.href);
    if (cleaned && typeof history !== "undefined")
      history.replaceState(history.state, "", cleaned);
  }
  const link = pendingLink;
  pendingLink = null;
  return link;
}

/** The address that opens Settings at an entry or category. */
export function settingsLink(id: string, page = location.href) {
  const url = new URL(page);
  url.search = "";
  url.hash = "";
  url.searchParams.set(LINK_PARAM, id);
  return url.toString();
}

/** Tests: read links as a page loaded at `href` would. */
export function __loadSettingsLinkForTests(href: string) {
  read = true;
  pendingLink = null;
  take(href);
}
