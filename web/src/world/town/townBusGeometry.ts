/** The bus and stop sprites' sizes, in world pixels (townBusSprites.ts). */
export const BUS_W = 62;
export const BUS_H = 42;
/**
 * The windows riders look out of, in sprite pixels from the bus's top left
 * (outline included): five upstairs, then three downstairs.
 */
export const BUS_SEATS = [
  ...[5, 15, 25, 35, 45].map((x) => ({ x, y: 6 })),
  ...[5, 15, 25].map((x) => ({ x, y: 22 })),
];
export const STOP_W = 20;
export const STOP_H = 42;
