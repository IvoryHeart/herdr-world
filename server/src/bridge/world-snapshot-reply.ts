import {
  WORLD_SNAPSHOT_CHUNK_CHARACTERS,
  WORLD_SNAPSHOT_MAX_CHUNKS,
} from "../../../shared/worldSnapshotChunks";

/** Yield between bounded messages so scoped replies can use the same socket. */
export async function sendWorldSnapshotReply(
  id: string,
  result: unknown,
  chunks: boolean,
  send: (payload: string) => boolean,
  current: () => boolean = () => true,
) {
  const json = JSON.stringify(result);
  if (!chunks || json.length <= WORLD_SNAPSHOT_CHUNK_CHARACTERS) {
    if (current())
      send('{"id":' + JSON.stringify(id) + ',"result":' + json + "}");
    return;
  }
  const total = Math.ceil(json.length / WORLD_SNAPSHOT_CHUNK_CHARACTERS);
  if (total > WORLD_SNAPSHOT_MAX_CHUNKS)
    throw new Error("World snapshot exceeds transport bound");
  for (let index = 0; index < total; index++) {
    if (
      !current() ||
      !send(
        JSON.stringify({
          id,
          world_snapshot_chunk: {
            index,
            total,
            data: json.slice(
              index * WORLD_SNAPSHOT_CHUNK_CHARACTERS,
              (index + 1) * WORLD_SNAPSHOT_CHUNK_CHARACTERS,
            ),
          },
        }),
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
