'use client'
// 何かが根っこで壊れたときの画面（ユーザー報告 2026-08-13:
// 「Application error: a client-side exception has occurred while loading www.xibit360.art」）。
//
// **なぜ要るか**: これまで境界が1つも無かったので、クライアント側で例外が出ると Next.js の
// 素の英文（上の1行）が白地に出るだけだった。読んだ人は何が起きたのか分からず、直し方も
// 分からない。実際に一番多い原因は「**開いていたタブが古い版のままで、その版の JS が
// 新しいデプロイに差し替わった**」で、これは**再読み込みで直る** ── なのに「再読み込み
// すれば直る」とどこにも書いていなかった。
//
// **この画面はアプリが壊れている前提で描く**: i18n の Provider も store も当てにせず、
// URL の先頭（`/ja/...`）だけを見て言葉を選ぶ。依存を増やすほど「エラー画面自体が
// エラーになる」に近づく。
import { useEffect } from 'react'

/** 文言はこの画面だけで持つ（i18n-ok: 辞書を読む仕組み自体が壊れている場面で使う画面。
 *  Provider を通すと、壊れた原因がそれだったときに何も出せない）。 */
const TEXT: Record<string, { title: string; body: string; retry: string }> = {
  ja: {
    title: '読み込みに失敗しました',
    body: '再読み込みすると直ることがあります。新しい版に更新された直後は、開いていたページが古いままになることがあります。',
    retry: '再読み込み',
  },
  en: {
    title: 'Something went wrong while loading',
    body: 'Reloading usually fixes it. A page left open can go stale right after the site is updated.',
    retry: 'Reload',
  },
  de: { title: 'Beim Laden ist etwas schiefgelaufen', body: 'Ein Neuladen behebt es meist. Eine offene Seite kann direkt nach einem Update veralten.', retry: 'Neu laden' },
  es: { title: 'Algo falló al cargar', body: 'Recargar suele solucionarlo. Una página abierta puede quedar obsoleta justo después de una actualización.', retry: 'Recargar' },
  fr: { title: 'Le chargement a échoué', body: 'Recharger suffit généralement. Une page laissée ouverte peut être périmée juste après une mise à jour.', retry: 'Recharger' },
  it: { title: 'Qualcosa è andato storto durante il caricamento', body: 'Ricaricare di solito risolve. Una pagina lasciata aperta può risultare obsoleta subito dopo un aggiornamento.', retry: 'Ricarica' },
  'pt-br': { title: 'Algo deu errado ao carregar', body: 'Recarregar costuma resolver. Uma página aberta pode ficar desatualizada logo após uma atualização.', retry: 'Recarregar' },
  id: { title: 'Terjadi kesalahan saat memuat', body: 'Memuat ulang biasanya memperbaikinya. Halaman yang dibiarkan terbuka bisa kedaluwarsa setelah pembaruan.', retry: 'Muat ulang' },
  ko: { title: '불러오는 중 문제가 발생했습니다', body: '새로 고치면 대부분 해결됩니다. 업데이트 직후에는 열어 둔 페이지가 오래된 상태일 수 있습니다.', retry: '새로 고침' },
  'zh-hans': { title: '加载时出错', body: '重新加载通常可以解决。刚更新后，一直开着的页面可能已经过期。', retry: '重新加载' },
  'zh-hant': { title: '載入時發生錯誤', body: '重新載入通常可以解決。剛更新後，一直開著的頁面可能已經過期。', retry: '重新載入' },
}

function pickText() {
  const seg = typeof window !== 'undefined' ? window.location.pathname.split('/')[1] : ''
  return TEXT[seg] ?? TEXT.en
}

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 何が落ちたのかは残す（本人が console を開かなくても、こちらが digest で追える）
    console.error('[global-error]', error?.message, error?.digest)
  }, [error])
  const tx = pickText()
  return (
    // `global-error` はルートのレイアウトごと差し替わるので、`<html>`/`<body>` を自分で書く。
    // CSS も当たらない前提なので、体裁はインラインで持つ（ブランドの色だけ揃える）。
    <html lang="en">
      <body style={{ margin: 0, background: '#0b0a09', color: '#ece7de', fontFamily: 'system-ui, sans-serif' }}>
        <main
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1.1rem',
            padding: '2rem 1.4rem',
            textAlign: 'center',
          }}
        >
          {/* i18n-ok: ブランド名 */}
          <div style={{ letterSpacing: '0.5em', fontSize: '0.8rem', color: '#9a938a' }}>XIBIT360</div>
          <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 400 }}>{tx.title}</h1>
          <p style={{ margin: 0, maxWidth: '34rem', fontSize: '0.92rem', lineHeight: 1.9, color: '#cdc7bd' }}>
            {tx.body}
          </p>
          <button
            type="button"
            // `reset()` ではなく**本当に読み直す**。古い版のJSが原因のときは、同じ版で
            // 再描画しても直らない（実際に一番多い原因がこれ）。
            onClick={() => window.location.reload()}
            style={{
              minHeight: '44px',
              padding: '0 1.4rem',
              fontSize: '0.85rem',
              letterSpacing: '0.08em',
              color: '#1a1611',
              background: '#d4a24e',
              border: 0,
              borderRadius: '10px',
              cursor: 'pointer',
            }}
          >
            {tx.retry}
          </button>
        </main>
      </body>
    </html>
  )
}
