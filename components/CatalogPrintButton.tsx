'use client'
// The one interactive bit of the otherwise-static catalog: trigger the browser's
// print dialog, from which the artist chooses "Save as PDF". Dependency-free —
// no PDF library, the browser does the rendering (and honours the print CSS).
export default function CatalogPrintButton() {
  return (
    <button className="catalog-print-btn" onClick={() => window.print()}>
      Download PDF
    </button>
  )
}
