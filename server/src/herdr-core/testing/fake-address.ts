/** Core's terminals.rs allocation, independently checked by recorded vectors. */
export function fakeCoreAddress(ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 0xffff_ffff)
    throw new RangeError("core terminal ordinal is outside u32 allocation");
  const symbols = "0123456789bcdfghjkmnpqrstvwxyz";
  let rest = ordinal - 1;
  let size = 9;
  let length = 0;
  while (rest >= size) {
    rest -= size;
    size *= symbols.length;
    length++;
  }
  let tail = "";
  for (let i = 0; i < length; i++) {
    tail = symbols[rest % symbols.length] + tail;
    rest = Math.floor(rest / symbols.length);
  }
  return `t${rest + 1}${tail}`;
}
