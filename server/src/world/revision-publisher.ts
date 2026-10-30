/** The three revision-only controls; invalidations and ledger notices differ. */
export function createRevisionPublisher<Client>(
  clients: Iterable<Client>,
  safeSend: (client: Client, line: string, context: string) => unknown,
) {
  return (
    type:
      | "world_board_changed"
      | "world_profiles_changed"
      | "world_watchlist_changed",
    context: string,
  ) =>
    (revision: number) => {
      const line = JSON.stringify({ control: { type, revision } });
      for (const client of clients) safeSend(client, line, context);
    };
}
