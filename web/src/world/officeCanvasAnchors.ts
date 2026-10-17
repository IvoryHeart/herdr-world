/** Viewport positions that connect Office scene entities to their windows. */
export type OfficeCanvasAnchor = {
  x: number;
  y: number;
  visible: boolean;
  edge: "top" | "right" | "bottom" | "left" | null;
};

export type OfficeCanvasAnchors = {
  agent: OfficeCanvasAnchor | null;
  workbench: OfficeCanvasAnchor | null;
};

export type OfficeConversationAnchorTarget = {
  id: string;
  selectedKey: string | null;
  targetKey: string;
};

export type OfficeConversationAnchors = Record<string, OfficeCanvasAnchors>;

export type OfficeCanvasHover = {
  key: string;
  clientX: number;
  clientY: number;
};
