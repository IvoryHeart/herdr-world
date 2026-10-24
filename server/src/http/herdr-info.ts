import { observeHerdrIdentity } from "../../../shared/herdrIdentity";

type HerdrIdentity = {
  version: string;
  protocol: number;
};

export function createHerdrInfoHandler({
  ping,
  now = Date.now,
}: {
  ping: () => Promise<HerdrIdentity>;
  now?: () => number;
}) {
  async function handleHerdrInfo() {
    try {
      const info = await ping();
      const observation = observeHerdrIdentity(info, now());
      if (!observation) {
        throw new Error("Herdr returned invalid server information");
      }
      return Response.json(observation);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 503 },
      );
    }
  }

  return { handleHerdrInfo };
}
