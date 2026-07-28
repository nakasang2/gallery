'use client'
import { useT } from '@/components/I18nProvider'
// The one interactive bit of the otherwise-static catalog: trigger the browser's
// print dialog, from which the artist chooses "Save as PDF". Dependency-free —
// no PDF library, the browser does the rendering (and honours the print CSS).
export default function CatalogPrintButton() {
  const t = useT()
  return (
    <button className="catalog-print-btn" onClick={() => window.print()}>
      {t('catalog.download')}
    </button>
  )
}
