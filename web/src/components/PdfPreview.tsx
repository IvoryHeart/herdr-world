import { Suspense } from "react";
import { lazyWithReload } from "../lazyWithReload";

// PDF.js only loads when a PDF is shown by it.
const PdfPages = lazyWithReload("pdf-pages", () => import("./PdfPages"));

/**
 * Whether the browser shows a PDF in a frame itself. Chrome on Android and
 * Safari on iOS do not: their PDFs are drawn with PDF.js instead.
 */
function framesShowPdf() {
  return (
    navigator.pdfViewerEnabled === true &&
    !window.matchMedia("(pointer: coarse)").matches
  );
}

/** A PDF in the browser's own viewer, or drawn with PDF.js where it has none. */
export function PdfPreview({ url, name }: { url: string; name: string }) {
  return framesShowPdf() ? (
    <iframe
      className="file-preview-pdf"
      src={url}
      title={`PDF preview: ${name}`}
    />
  ) : (
    <Suspense
      fallback={<div className="file-preview-state">Loading the PDF...</div>}
    >
      <PdfPages key={url} url={url} name={name} />
    </Suspense>
  );
}
