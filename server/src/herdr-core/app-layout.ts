import { isLocalCoreAddress } from "../../../shared/coreAddress";

/** Read-only projection of herdr-app's mirror::Document; never serialized back. */
type CoreAppTab = { id: string; name: string; terminals: string[] };
type CoreAppSpace = {
  id: string;
  name: string;
  folder: string;
  tabs: CoreAppTab[];
};
export type CoreAppLayout = { spaces: CoreAppSpace[] };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Herdr app layout");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string")
    throw new Error("Invalid Herdr app layout string");
  return value;
}

/** Core caps documents at 1 MiB. Ignore unrelated/new fields, bound tree traversal. */
export function readCoreAppLayout(value: unknown): CoreAppLayout | null {
  if (value === null) return null;
  if (Buffer.byteLength(JSON.stringify(value)) > 1 << 20)
    throw new Error("Herdr app layout exceeds 1 MiB");
  const doc = object(value);
  const spaces = doc.spaces === undefined ? [] : doc.spaces;
  if (!Array.isArray(spaces)) throw new Error("Invalid Herdr app spaces");
  let nodes = 0;
  const placed = new Set<string>();
  const spaceIds = new Set<string>();
  const tabIds = new Set<string>();
  const terminals = (value: unknown, depth = 0): string[] => {
    if (++nodes > 16384 || depth > 64)
      throw new Error("Herdr app layout tree exceeds observation limit");
    const node = object(value);
    const result: string[] = [];
    const content = (value: unknown) => {
      const block = object(value);
      if (block.terminal === undefined) return;
      const address = string(block.terminal);
      if (!isLocalCoreAddress(address) || placed.has(address))
        throw new Error("Invalid or duplicate Herdr app terminal");
      placed.add(address);
      result.push(address);
    };
    if (node.type === "block") content(node.content);
    else if (["row", "column", "stack"].includes(String(node.type))) {
      if (!Array.isArray(node.children))
        throw new Error("Invalid Herdr app children");
      for (const child of node.children)
        result.push(...terminals(child, depth + 1));
    } else throw new Error("Unknown Herdr app node type");
    if (node.floating !== undefined) {
      if (!Array.isArray(node.floating))
        throw new Error("Invalid Herdr app floats");
      for (const float of node.floating) content(object(float).content);
    }
    return result;
  };
  return {
    spaces: spaces.map((value) => {
      const space = object(value);
      const id = string(space.id);
      if (!id || spaceIds.has(id))
        throw new Error("Invalid Herdr app space ID");
      spaceIds.add(id);
      const tabs = space.tabs === undefined ? [] : space.tabs;
      if (!Array.isArray(tabs)) throw new Error("Invalid Herdr app tabs");
      return {
        id,
        name: string(space.name),
        folder: string(space.folder),
        tabs: tabs.map((value) => {
          const tab = object(value);
          const id = string(tab.id);
          if (!id || tabIds.has(id))
            throw new Error("Invalid Herdr app tab ID");
          tabIds.add(id);
          return {
            id,
            name: string(tab.name),
            terminals: tab.root === undefined ? [] : terminals(tab.root),
          };
        }),
      };
    }),
  };
}

export function coreAppPlacement(app: CoreAppLayout | null, address: string) {
  for (const space of app?.spaces ?? [])
    for (const tab of space.tabs)
      if (tab.terminals.includes(address)) return { space, tab };
  return null;
}
