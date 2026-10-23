/**
 * The film's Town art: the application's own layout, painting and sprite
 * code, bundled by `bun run build:site` into `film/town-art.js`. The film
 * draws its Town scenes with these functions, so its rooms, desks and people
 * are the ones the app draws rather than an approximation of them.
 */

import { TERMINAL_COLOR_HEX } from "../../web/src/world/terminalColor";
import {
  TOWN_AGENT_SCALE,
  TOWN_FACADE,
  TOWN_TILE,
  layoutTown,
  townDeskSlots,
  townDeskTable,
  townSeat,
} from "../../web/src/world/town/townLayout";
import {
  TOWN_HOST_THEMES,
  paintTownFacade,
  paintTownGround,
  paintTownInterior,
  paintTownRoof,
  townCarpetFor,
} from "../../web/src/world/town/townPaint";
import {
  TOWN_DESK_COLORS,
  buildTownSprites,
  townCharacter,
  townLookFor,
  townScreen,
} from "../../web/src/world/town/townSprites";

Object.assign(window, {
  HerdrTownArt: {
    TERMINAL_COLOR_HEX,
    TOWN_AGENT_SCALE,
    TOWN_DESK_COLORS,
    TOWN_FACADE,
    TOWN_HOST_THEMES,
    TOWN_TILE,
    buildTownSprites,
    layoutTown,
    paintTownFacade,
    paintTownGround,
    paintTownInterior,
    paintTownRoof,
    townCarpetFor,
    townCharacter,
    townDeskSlots,
    townDeskTable,
    townLookFor,
    townScreen,
    townSeat,
  },
});
