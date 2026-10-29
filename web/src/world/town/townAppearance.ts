import { avatarLook } from "../../../../shared/appearance";
import { profileLookFor, profilesSnapshot, townLookOf } from "../agentProfiles";
import type { OfficeAgent } from "../herdrOfficeProjection";
import { townLookFor, type TownLook } from "./townSprites";
/** Keep frame reads allocation-free; retired immutable agent objects can be collected. */
export function createTownLookResolver(readProfiles = profilesSnapshot) {
  const cache = new WeakMap<
    OfficeAgent,
    { revision: number; avatar: string | undefined; look: TownLook }
  >();
  return (agent: OfficeAgent | undefined, key: string): TownLook => {
    if (!agent) return townLookFor(key);
    const profiles = readProfiles(),
      revision = profiles?.revision ?? -1,
      avatar = agent.appearance?.avatar;
    const previous = cache.get(agent);
    if (
      previous &&
      previous.revision === revision &&
      previous.avatar === avatar
    )
      return previous.look;
    const override = avatarLook(avatar),
      terminal = agent.currentTerminalRef;
    const look = override
      ? townLookOf(override)
      : profileLookFor(profiles, terminal.connectionId, terminal.nativeId) ||
        townLookFor(key);
    cache.set(agent, { revision, avatar, look });
    return look;
  };
}
