import { useEffect, useState } from "react";
import { ZoomablePreview, type PreviewDimensions } from "./ZoomablePreview";

export function ImagePreview({ src, name }: { src: string; name: string }) {
  const [state, setState] = useState<{
    src: string;
    dimensions?: PreviewDimensions;
    error?: boolean;
  } | null>(null);
  useEffect(() => {
    const image = new Image();
    image.onload = () =>
      setState(
        image.naturalWidth && image.naturalHeight
          ? {
              src,
              dimensions: {
                width: image.naturalWidth,
                height: image.naturalHeight,
              },
            }
          : { src, error: true },
      );
    image.onerror = () => setState({ src, error: true });
    image.src = src;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [src]);
  if (state?.src !== src)
    return (
      <div className="file-preview-state" role="status">
        Loading image
      </div>
    );
  if (state.error || !state.dimensions)
    return (
      <div className="file-preview-state is-error" role="alert">
        This image could not be decoded by your browser. Use Download from the
        file menu.
      </div>
    );
  return (
    <ZoomablePreview
      key={src}
      dimensions={state.dimensions}
      label={`Image: ${name}`}
      className="file-preview-visual"
    >
      <img src={src} alt={name} draggable={false} />
    </ZoomablePreview>
  );
}
