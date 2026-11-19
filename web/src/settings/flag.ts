/**
 * The Settings prototype's switch and links (#1035).
 *
 * `?settings=next` turns the prototype on for this browser tab: the short
 * Menu, the Settings screen and settings in the command box. It lasts until
 * the tab closes or `?settings=off` turns it off; the parameter is removed
 * from the address at once.
 *
 * `?setting=<id>` opens the Settings screen at that setting (or category)
 * and turns the prototype on too; it is removed once read, so a reload does
 * not open it again.
 */

import { worldSessionStorage } from "../browserStorage";

const FLAG_PARAM = "settings";
const LINK_PARAM = "setting";
const FLAG_KEY = "settingsPrototype.v1";

let on: boolean | undefined;
let pendingLink: string | null = null;

function take(href: string) {
  const url = new URL(href);
  const flag = url.searchParams.get(FLAG_PARAM);
  const link = url.searchParams.get(LINK_PARAM);
  if (flag === null && link === null) return false;
  if (flag === "off") {
    on = false;
    try {
      worldSessionStorage.removeItem(FLAG_KEY);
    } catch {
      // Storage refused: the switch lasts for this page.
    }
  } else if (flag === "next" || link) {
    on = true;
    try {
      worldSessionStorage.setItem(FLAG_KEY, "1");
    } catch {
      // Storage refused: the switch lasts for this page.
    }
  }
  if (link) pendingLink = link;
  url.searchParams.delete(FLAG_PARAM);
  url.searchParams.delete(LINK_PARAM);
  return url;
}

function load() {
  if (on !== undefined) return;
  if (typeof location !== "undefined") {
    const cleaned = take(location.href);
    if (cleaned && typeof history !== "undefined")
      history.replaceState(history.state, "", cleaned);
  }
  if (on === undefined) {
    try {
      on = worldSessionStorage.getItem(FLAG_KEY) === "1";
    } catch {
      on = false;
    }
  }
}

/** Whether this tab shows the Settings prototype. */
export function settingsPrototypeOn() {
  load();
  return on === true;
}

/** The setting a link asked for, once; null after the first read. */
export function takeSettingsLink() {
  load();
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

/** Tests: read the switch as a page loaded at `href` would. */
export function __loadSettingsFlagForTests(href: string) {
  on = undefined;
  pendingLink = null;
  take(href);
  if (on === undefined) on = false;
}
