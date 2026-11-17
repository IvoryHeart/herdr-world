/**
 * Core's terminals.rs: a first digit 1–9, then digits or consonants except
 * `l`. This is ID shape, not decimal or ordinary base 30: terminal 20 is
 * `t1b`. Keep World's existing ten-symbol bound; even core's u32 maximum
 * fits. Syntax never grants connection, generation or occupant authority.
 */
const ID = "t[1-9][0-9bcdfghjkmnpqrstvwxyz]{0,9}";
export const CORE_LOCAL_ADDRESS_PATTERN = `^${ID}$`;
const LOCAL = new RegExp(CORE_LOCAL_ADDRESS_PATTERN);
// Linked machines are observable, but never direct client/caller targets.
const OBSERVED = new RegExp(`^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}/)*${ID}$`);

export const isLocalCoreAddress = (address: string): boolean =>
  LOCAL.test(address);
export const isCoreAddress = (address: string): boolean =>
  OBSERVED.test(address);
