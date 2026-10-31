import { randomBytes } from "node:crypto";

const base32 = "0123456789abcdefghjkmnpqrstvwxyz";

/** Store-issued World record IDs; clocks and restored counters cannot retarget them. */
export function newWorldId(
  kind: string,
  exists: (id: string) => boolean,
  bytes: () => Uint8Array = () => randomBytes(8),
): string {
  if (!/^[a-z]+$/.test(kind))
    throw new Error("World ID kind must be lowercase letters");
  for (let tries = 0; tries < 64; tries++) {
    const entropy = bytes();
    if (entropy.length !== 8)
      throw new Error("World IDs need eight random symbols");
    const id = `${kind}-${Array.from(entropy, (value) => base32[value & 31]).join("")}`;
    if (!exists(id)) return id;
  }
  throw new Error("World ID allocation exhausted collision retries");
}
