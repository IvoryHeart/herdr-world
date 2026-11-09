/**
 * The film's Town art: the application's own layout, painting, sprite and
 * routing code, bundled by `bun run build:site` into `film/town-art.js`. The
 * film draws its Town scenes with these functions, so its rooms, desks,
 * people, town center, post office, bus stops, thought bubbles and walks
 * are the ones the app draws rather than an approximation of them.
 */

import { TERMINAL_COLOR_HEX } from "../../web/src/world/terminalColor";
import {
  TownNavigation,
  townCrowdSpots,
} from "../../web/src/world/town/townActors";
import { townArrivalPath } from "../../web/src/world/town/townArrivals";
import {
  townBusRoute,
  townNearestStop,
  townQueueSpot,
} from "../../web/src/world/town/townBus";
import { townCenterEmblem } from "../../web/src/world/town/townCenter";
import { paintTownCenter } from "../../web/src/world/town/townCenterPaint";
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
  TOWN_POST_YARD_ROWS,
  townPostLot,
  townPostSlot,
} from "../../web/src/world/town/townPost";
import {
  paintTownPostHouse,
  paintTownPostYard,
} from "../../web/src/world/town/townPostPaint";
import { townStepGlyphUrl } from "../../web/src/world/town/townStepArt";
import { TOWN_STEP_WORDS } from "../../web/src/world/town/townSteps";
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
    TOWN_POST_YARD_ROWS,
    TOWN_STEP_WORDS,
    TOWN_TILE,
    TownNavigation,
    buildTownSprites,
    layoutTown,
    paintTownCenter,
    paintTownFacade,
    paintTownGround,
    paintTownInterior,
    paintTownPostHouse,
    paintTownPostYard,
    paintTownRoof,
    townArrivalPath,
    townBusRoute,
    townCarpetFor,
    townCenterEmblem,
    townCharacter,
    townCrowdSpots,
    townDeskSlots,
    townDeskTable,
    townLookFor,
    townNearestStop,
    townPostLot,
    townPostSlot,
    townQueueSpot,
    townScreen,
    townSeat,
    townStepGlyphUrl,
  },
});
