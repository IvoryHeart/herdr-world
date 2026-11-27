/** herdr-app mirror::Document / layout::Node wire shape (pinned in capability notes). */
export function appLayoutFixture(
  ...spaces: Array<{
    id: string;
    name?: string;
    folder?: string;
    tabs?: Array<{ id: string; name?: string; terminals?: string[] }>;
  }>
) {
  return {
    spaces: spaces.map((space) => ({
      id: space.id,
      name: space.name ?? "",
      folder: space.folder ?? "",
      tabs: (space.tabs ?? []).map((tab) => ({
        id: tab.id,
        name: tab.name ?? "",
        root: {
          id: tab.id,
          type: "row",
          children: (tab.terminals ?? []).map((terminal, i) => ({
            id: `p${i}`,
            type: "block",
            content: { terminal },
          })),
        },
      })),
    })),
  };
}
