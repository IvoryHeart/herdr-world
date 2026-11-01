import { avatarLook } from "../../../../shared/appearance";
import { profileFor, profilesSnapshot, townLookOf } from "../agentProfiles";
import type { OfficeAgent } from "../herdrOfficeProjection";
import { townLookFor, type TownLook } from "./townSprites";
/** Keep frame reads allocation-free; retired immutable agent objects can be collected. */
export function createTownLookResolver(readProfiles = profilesSnapshot) {
  const cache = new WeakMap<
    OfficeAgent,
    {
      revision: number;
      key: string;
      avatar: string | undefined;
      look: TownLook;
    }
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
    const input =
      override ??
      profileFor(profiles, terminal.connectionId, terminal.nativeId)?.look;
    const inputKey = input ? JSON.stringify(input) : key;
    const look =
      previous?.key === inputKey
        ? previous.look
        : input
          ? townLookOf(input)
          : townLookFor(key);
    cache.set(agent, { revision, avatar, key: inputKey, look });
    return look;
  };
}
