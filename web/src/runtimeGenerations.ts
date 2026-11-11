export class RuntimeGenerationCatalogue {
  private hostGenerations = new Map<string, number>();
  private coreGenerations = new Map<string, number>();
  constructor(
    private readonly generations: Map<string, number>,
    private readonly leases: Map<string, object>,
  ) {}
  setHosts(
    connections: Array<{ id: string; generation: number; state?: string }>,
  ) {
    this.hostGenerations = new Map(
      connections
        .filter((c) => c.state === undefined || c.state === "ready")
        .map((c) => [c.id, c.generation]),
    );
    this.apply();
  }
  setCore(connections: Array<{ id: string; generation: number }>) {
    this.coreGenerations = new Map(
      connections.map((c) => [c.id, c.generation]),
    );
    this.apply();
  }
  private apply() {
    const next = new Map([...this.coreGenerations, ...this.hostGenerations]);
    for (const [id, generation] of next)
      if (this.generations.get(id) !== generation) this.leases.set(id, {});
    this.generations.clear();
    for (const [id, generation] of next) this.generations.set(id, generation);
    for (const id of this.leases.keys())
      if (!next.has(id)) this.leases.delete(id);
  }
}
