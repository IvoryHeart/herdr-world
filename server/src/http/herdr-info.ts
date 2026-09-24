type HerdrIdentity = {
  version: string;
  protocol: number;
};

export function createHerdrInfoHandler({
  ping,
}: {
  ping: () => Promise<HerdrIdentity>;
}) {
  async function handleHerdrInfo() {
    try {
      const info = await ping();
      if (
        typeof info.version !== "string" ||
        !info.version.trim() ||
        !Number.isInteger(info.protocol) ||
        info.protocol < 1
      ) {
        throw new Error("Herdr returned invalid server information");
      }
      return Response.json({
        version: info.version,
        protocol: info.protocol,
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 503 },
      );
    }
  }

  return { handleHerdrInfo };
}
