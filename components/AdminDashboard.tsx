'use client'
// Presentational layer for the admin console — renders over `data` (app/admin)
// or fixtures (verification). `onReload` (optional) lets the entitlement
// grant/revoke controls refresh after a change.
import { useMemo, useState } from 'react'
import { money } from '@/lib/pricing'
import { THEMES, LAYOUTS, FRAMES } from '@/lib/presets'
import { paidThemeIds, paidLayoutIds, paidFrameIds } from '@/lib/entitlements'
import {
  adminAddRoom,
  adminListGalleryArtworks,
  adminTakedownArtwork,
  grantEntitlement,
  revokeEntitlement,
  setExpoSlug,
  setReportStatus,
  setGalleryPublic,
  sumByCurrency,
  type AdminArtworkRow,
  type AdminOverview,
} from '@/lib/admin'
import { useT } from '@/components/I18nProvider'
import { expoSlugError } from '@/lib/expoHost'

/** Encode a product as "kind|itemKey" for the <select> value. */
function productKey(kind: string, itemKey: string): string {
  return `${kind}|${itemKey}`
}

/** The paid items an admin can grant — fixed capabilities plus every theme/layout/
 *  frame on sale. Reads the same paid catalog checkout sells from (lib/entitlements),
 *  so a future paid one shows up here automatically with no code change. */
function useGrantableProducts() {
  const t = useT()
  return useMemo(() => {
    const list: { kind: string; itemKey: string; label: string }[] = [
      // 商品名はテーマ名（Chic / Noir）と同じ扱いで、どの言語でも英語のまま出す
      { kind: 'design_tools', itemKey: '', label: 'Design Tools' }, // i18n-ok: 商品名
      { kind: 'video_pass', itemKey: '', label: 'Video Pass' }, // i18n-ok: 商品名
      // An extra exhibition room. Unlike every other entry here this one is
      // REPEATABLE — the allowance counts ledger rows — so the grant below gives it a
      // unique item_key instead of ''. Needed for comping a room, handling a refund,
      // and for exercising the multi-room flow without a real $25 charge.
      { kind: 'room', itemKey: '', label: t('adminUi.roomItem') },
    ]
    for (const id of paidThemeIds()) list.push({ kind: 'theme', itemKey: id, label: t('adminUi.themeItem', { name: THEMES[id].label }) })
    for (const id of paidLayoutIds()) list.push({ kind: 'layout', itemKey: id, label: t('adminUi.layoutItem', { name: LAYOUTS[id]?.label ?? id }) })
    for (const id of paidFrameIds()) list.push({ kind: 'frame', itemKey: id, label: t('adminUi.frameItem', { name: FRAMES[id]?.label ?? id }) })
    return list
  }, [t])
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return '—'
  }
}

const cell: React.CSSProperties = { padding: '0.5rem 0.7rem', borderBottom: '1px solid var(--hairline)', textAlign: 'left', verticalAlign: 'top' }
const th: React.CSSProperties = { ...cell, fontFamily: 'var(--mono)', fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)', whiteSpace: 'nowrap' }

function Table({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: '0.8rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead><tr>{head}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export default function AdminDashboard({ data, onReload }: { data: AdminOverview; onReload?: () => void | Promise<void> }) {
  const t = useT()
  const products = useGrantableProducts()
  // One figure per currency — a cross-currency sum would be a fiction (0031)
  const revenueLines = data.revenueByCurrency.map((r) => money(r.amount, r.currency))
  const [grantUser, setGrantUser] = useState('')
  const [subUser, setSubUser] = useState('')
  const [subValue, setSubValue] = useState('')
  const [grantProduct, setGrantProduct] = useState(() => (products[0] ? productKey(products[0].kind, products[0].itemKey) : ''))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Per-report artwork panel (リリース前監査 #10): 'loading' while fetching,
  // an array once loaded, or absent/collapsed. Keyed by galleryId since that is
  // what admin_list_gallery_artworks takes.
  const [artworkPanels, setArtworkPanels] = useState<Record<string, AdminArtworkRow[] | 'loading'>>({})
  const [artworkErr, setArtworkErr] = useState<Record<string, string>>({})

  // Purchases grouped by user, so each user's chips carry the exact kind/item_key to revoke
  const purchasesByUser = useMemo(() => {
    const m = new Map<string, AdminOverview['purchases']>()
    for (const p of data.purchases) {
      if (!p.userId) continue // anonymized (buyer's account was deleted, migration 0069) — no user to group it under
      const list = m.get(p.userId) ?? []
      list.push(p)
      m.set(p.userId, list)
    }
    return m
  }, [data.purchases])

  function labelFor(kind: string, itemKey: string): string {
    if (kind === 'theme') return t('adminUi.themeItem', { name: THEMES[itemKey]?.label ?? itemKey })
    if (kind === 'layout') return t('adminUi.layoutItem', { name: LAYOUTS[itemKey]?.label ?? itemKey })
    if (kind === 'frame') return t('adminUi.frameItem', { name: FRAMES[itemKey]?.label ?? itemKey })
    if (kind === 'design_tools') return 'Design Tools' // i18n-ok: 商品名
    if (kind === 'video_pass') return 'Video Pass' // i18n-ok: 商品名
    // Rooms are repeatable, so each one is its own row keyed by the Checkout session
    // (or `admin-…` when comped). The key is noise on screen — the chip just says which
    // product it is, and there is one chip per room the account holds.
    if (kind === 'room') return t('adminUi.roomItem')
    return itemKey ? `${kind}:${itemKey}` : kind
  }

  async function mutate(fn: () => Promise<void>) {
    setBusy(true)
    setErr('')
    try {
      await fn()
      await onReload?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function toggleArtworks(galleryId: string) {
    if (artworkPanels[galleryId]) {
      setArtworkPanels((prev) => {
        const { [galleryId]: _removed, ...rest } = prev
        return rest
      })
      return
    }
    setArtworkPanels((prev) => ({ ...prev, [galleryId]: 'loading' }))
    setArtworkErr((prev) => ({ ...prev, [galleryId]: '' }))
    try {
      const rows = await adminListGalleryArtworks(galleryId)
      setArtworkPanels((prev) => ({ ...prev, [galleryId]: rows }))
    } catch (e) {
      setArtworkPanels((prev) => {
        const { [galleryId]: _removed, ...rest } = prev
        return rest
      })
      setArtworkErr((prev) => ({ ...prev, [galleryId]: e instanceof Error ? e.message : String(e) }))
    }
  }

  async function takedownArtwork(galleryId: string, artworkId: string, title: string, copyright: boolean) {
    if (!window.confirm(t('admin.deleteFileConfirm'))) return
    setBusy(true)
    setErr('')
    try {
      await adminTakedownArtwork(artworkId, copyright, title)
      setArtworkPanels((prev) => {
        const list = prev[galleryId]
        return Array.isArray(list) ? { ...prev, [galleryId]: list.filter((a) => a.id !== artworkId) } : prev
      })
      await onReload?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* KPIs */}
      <div className="stat-row" style={{ marginTop: '1rem' }}>
        <div className="stat"><b>{data.totals.users}</b><span>{t('admin.users')}</span></div>
        <div className="stat"><b>{data.totals.galleries}</b><span>{t('admin.galleries')}</span></div>
        <div className="stat"><b>{data.totals.publicGalleries}</b><span>{t('admin.public')}</span></div>
        <div className="stat"><b>{data.totals.works}</b><span>{t('admin.works')}</span></div>
        {revenueLines.length <= 1 ? (
          <div className="stat"><b>{revenueLines[0] ?? money(0, 'usd')}</b><span>{t('admin.revenue')}</span></div>
        ) : (
          <div className="stat"><b style={{ fontSize: '0.9rem' }}>{revenueLines.join(' · ')}</b><span>{t('admin.revenue')}</span></div>
        )}
        <div className="stat">
          <b style={data.totals.openReports > 0 ? { color: 'var(--gold)' } : undefined}>
            {data.totals.openReports}
          </b>
          <span>{t('admin.openReports')}</span>
        </div>
      </div>

      {/* Reports — the operator queue. Admins have been able to READ these since
          0017; there was simply nowhere to see them and no way to act, so a
          takedown meant opening the SQL Editor. */}
      <section className="me-section">
        <h2>{t('admin.reports')}</h2>
        <div className="me-card">
          {data.reports.length === 0 ? (
            <p className="me-note" style={{ margin: 0 }}>{t('admin.noReports')}</p>
          ) : (
            <div className="report-list">
              {data.reports.map((r) => (
                <article key={r.id} className={`report-item${r.status === 'open' ? ' open' : ''}`}>
                  <div className="report-head">
                    <span className={`report-status is-${r.status}`}>{r.status}</span>
                    <span className="report-when">{fmtDate(r.createdAt)}</span>
                  </div>
                  <p className="report-about">
                    {r.match ? (
                      <a href={`/@${r.match.username}/${r.match.slug}`} target="_blank" rel="noreferrer">
                        @{r.match.username}/{r.match.slug}
                      </a>
                    ) : (
                      <span title={t('admin.unmatched')}>{r.about || t('admin.noTarget')}</span>
                    )}
                    {r.match && !r.match.isPublic && <span className="report-flag"> · {t('admin.alreadyPrivate')}</span>}
                  </p>
                  <p className="report-reason">{r.reason}</p>
                  {r.contact && <p className="report-contact">{t('admin.reporter', { contact: r.contact })}</p>}
                  {r.handledNote && <p className="report-contact">{t('admin.note', { note: r.handledNote })}</p>}
                  <div className="report-actions">
                    {r.match && r.match.isPublic && (
                      <button
                        className="btn-line danger"
                        disabled={busy}
                        onClick={() =>
                          void mutate(async () => {
                            const why = window.prompt(t('admin.takeDownWhy'))
                            if (why === null) return
                            await setGalleryPublic(r.match!.galleryId, false)
                            await setReportStatus(r.id, 'actioned', why)
                          })
                        }
                      >
                        {t('admin.takeDown')}
                      </button>
                    )}
                    {r.match && !r.match.isPublic && (
                      <button
                        className="btn-line"
                        disabled={busy}
                        onClick={() => void mutate(() => setGalleryPublic(r.match!.galleryId, true))}
                      >
                        {t('admin.restore')}
                      </button>
                    )}
                    {/* 部屋単位の非公開化だけでは、実ファイルは消えず合同展示の
                        無関係な参加作家も巻き添えになる（リリース前監査 #10）。
                        報告された1点だけをここから完全に削除できるようにする。 */}
                    {r.match && (
                      <button
                        className="btn-line"
                        disabled={busy}
                        onClick={() => void toggleArtworks(r.match!.galleryId)}
                      >
                        {artworkPanels[r.match.galleryId] ? t('admin.hideArtworks') : t('admin.viewArtworks')}
                      </button>
                    )}
                    {r.status === 'open' ? (
                      <>
                        <button
                          className="btn-line"
                          disabled={busy}
                          onClick={() => void mutate(() => setReportStatus(r.id, 'dismissed', t('admin.noActionNeeded')))}
                        >
                          {t('admin.dismiss')}
                        </button>
                        <button
                          className="btn-line"
                          disabled={busy}
                          onClick={() => void mutate(() => setReportStatus(r.id, 'actioned', t('admin.handledElsewhere')))}
                        >
                          {t('admin.markHandled')}
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn-line"
                        disabled={busy}
                        onClick={() => void mutate(() => setReportStatus(r.id, 'open', ''))}
                      >
                        {t('admin.reopen')}
                      </button>
                    )}
                  </div>
                  {r.match && artworkErr[r.match.galleryId] && (
                    <p className="me-error" style={{ marginTop: '0.4rem' }}>{artworkErr[r.match.galleryId]}</p>
                  )}
                  {r.match && artworkPanels[r.match.galleryId] === 'loading' && (
                    <p className="me-note" style={{ marginTop: '0.4rem' }}>{t('adminUi.loading')}</p>
                  )}
                  {r.match && Array.isArray(artworkPanels[r.match.galleryId]) && (
                    <ul className="artwork-takedown-list">
                      {(artworkPanels[r.match.galleryId] as AdminArtworkRow[]).length === 0 ? (
                        <li className="me-note">{t('admin.noArtworksInRoom')}</li>
                      ) : (
                        (artworkPanels[r.match.galleryId] as AdminArtworkRow[]).map((a) => (
                          <li key={a.id}>
                            <span>{a.title || t('admin.noTarget')}</span>
                            <button
                              className="btn-line danger"
                              disabled={busy}
                              onClick={() => void takedownArtwork(r.match!.galleryId, a.id, a.title, r.kind === 'copyright')}
                            >
                              {t('admin.deleteFile')}
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Revenue */}
      <section className="me-section">
        <h2>{t('admin.revenue')}</h2>
        <div className="me-card">
          <p className="me-note" style={{ marginTop: 0 }}>
            {t('admin.totalCharged', {
              amount: revenueLines.join(' · ') || money(0, 'usd'),
              count: data.purchases.length,
            })}
            {data.revenueByCurrency.length > 1 && t('admin.currenciesSeparate')}
          </p>
          {data.purchases.length === 0 ? (
            <p className="me-note">
              {t('admin.noPurchases')}
            </p>
          ) : (
            <Table
              head={
                <>
                  <th style={th}>{t('admin.skuKind')}</th>
                  <th style={th}>{t('admin.currency')}</th>
                  <th style={th}>{t('admin.count')}</th>
                  <th style={th}>{t('admin.amount')}</th>
                </>
              }
            >
              {data.revenueByKind.map((r) => (
                <tr key={`${r.key}|${r.currency}`}>
                  <td style={cell}>{r.key}</td>
                  <td style={cell}>{r.currency.toUpperCase()}</td>
                  <td style={cell}>{r.count}</td>
                  <td style={cell}>{money(r.amount, r.currency)}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </section>

      {/* Exhibitions */}
      <section className="me-section">
        <h2>{t('adminUi.exhibitionSpaces', { count: data.galleries.length })}</h2>
        <div className="me-card">
          {data.galleries.length === 0 ? (
            <p className="me-note" style={{ marginTop: 0 }}>{t('admin.noGalleries')}</p>
          ) : (
            <Table
              head={
                <>
                  <th style={th}>{t('admin.colTitle')}</th>
                  <th style={th}>{t('admin.colArtist')}</th>
                  <th style={th}>{t('admin.colState')}</th>
                  <th style={th}>{t('admin.works')}</th>
                  <th style={th}>{t('admin.colVisits')}</th>
                  <th style={th}>{t('admin.colTheme')}</th>
                  <th style={th}>{t('admin.colUpdated')}</th>
                </>
              }
            >
              {data.galleries.map((g) => (
                <tr key={g.id}>
                  <td style={cell}>
                    {g.isPublic && g.username ? (
                      <a href={`/@${g.username}/${g.slug}`} target="_blank" rel="noreferrer">
                        {g.title || t('common.untitled')}
                      </a>
                    ) : (
                      g.title || t('common.untitled')
                    )}
                  </td>
                  <td style={cell}>{g.ownerName}{g.username ? ` · @${g.username}` : ''}</td>
                  <td style={cell}>
                    <span className={`hako-state${g.isPublic ? ' open' : ''}`}>{g.isPublic ? t('adminUi.stateOpen') : t('adminUi.statePrivate')}</span>
                  </td>
                  <td style={cell}>{g.workCount}{g.workCap ? ` / ${g.workCap}` : ''}</td>
                  <td style={cell}>{g.visits}</td>
                  <td style={cell}>{g.theme}</td>
                  <td style={cell}>{fmtDate(g.updatedAt)}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </section>

      {/* Users + owned packages */}
      <section className="me-section">
        <h2>{t('adminUi.usersCount', { count: data.users.length })}</h2>
        <div className="me-card">
          {data.users.length === 0 ? (
            <p className="me-note" style={{ marginTop: 0 }}>{t('admin.noUsers')}</p>
          ) : (
            <Table
              head={
                <>
                  <th style={th}>{t('admin.colArtist')}</th>
                  <th style={th}>{t('admin.colUsername')}</th>
                  <th style={th}>{t('admin.galleries')}</th>
                  <th style={th}>{t('admin.works')}</th>
                  <th style={th}>{t('admin.colPaid')}</th>
                  <th style={th}>{t('admin.colPackages')}</th>
                </>
              }
            >
              {data.users.map((u) => {
                const purchases = purchasesByUser.get(u.id) ?? []
                const paid = sumByCurrency(purchases)
                return (
                  <tr key={u.id}>
                    <td style={cell}>{u.displayName}</td>
                    <td style={cell}>{u.username ? `@${u.username}` : '—'}</td>
                    <td style={cell}>{u.galleryCount}{u.publicCount ? ` ${t('adminUi.publicCount', { count: u.publicCount })}` : ''}</td>
                    <td style={cell}>{u.workCount}</td>
                    {/* One figure per currency, exactly like the house total above:
                        with a single currency (the usual case) it reads as one
                        number, and a buyer charged in two currencies gets both
                        side by side rather than a sum that was never charged. */}
                    <td style={cell}>
                      {paid.length === 0 ? (
                        <span style={{ color: 'var(--muted)' }}>—</span>
                      ) : (
                        paid.map((r) => money(r.amount, r.currency)).join(' · ')
                      )}
                    </td>
                    <td style={cell}>
                      {purchases.length === 0 ? (
                        <span style={{ color: 'var(--muted)' }}>{t('common.free')}</span>
                      ) : (
                        <span className="ent-chips">
                          {purchases.map((p) => (
                            <span className="ent-chip" key={`${p.kind}|${p.itemKey}`}>
                              {labelFor(p.kind, p.itemKey)}
                              <button
                                className="ent-chip-x"
                                aria-label={t('adminUi.revokeAria', { name: labelFor(p.kind, p.itemKey) })}
                                disabled={busy}
                                onClick={() => void mutate(() => revokeEntitlement(u.id, p.kind, p.itemKey))}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </Table>
          )}

          {/* Assign the exhibition's `/expo/{slug}` name (admin-only RPC, migration 0040).
              Admin-only on purpose: the row does nothing until the host exists in
              the slug decides the CANONICAL url, and a name handed out by mistake is on
              somebody's flyer before it can be taken back. Clearing the field frees the
              name for reuse. */}
          {(
            <div className="ent-grant">
              <span className="ent-grant-label">{t('adminUi.expoSlugFor')}</span>
              <select className="ent-select" value={subUser} onChange={(e) => setSubUser(e.target.value)}>
                <option value="">{t('admin.selectUser')}</option>
                {data.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}{u.username ? ` (@${u.username})` : ''}{u.expoSlug ? ` — ${u.expoSlug}` : ''}
                  </option>
                ))}
              </select>
              <input
                className="ent-select"
                type="text"
                spellCheck={false}
                aria-label={t('adminUi.expoSlugFor')}
                placeholder={t('adminUi.expoSlugPlaceholder')}
                value={subValue}
                onChange={(e) => setSubValue(e.target.value)}
              />
              <button
                className="btn-line btn-gold"
                disabled={busy || !subUser}
                onClick={() =>
                  void mutate(async () => {
                    const v = subValue.trim().toLowerCase()
                    // Empty clears the alias. Anything else has to be a name we would
                    // actually serve — the reserved list lives in lib/expoHost, so the
                    // check here and the host parser can never disagree.
                    const why = v ? expoSlugError(v) : null
                    if (why) throw new Error(t(why === 'reserved' ? 'adminUi.expoSlugReserved' : 'adminUi.expoSlugInvalid'))
                    await setExpoSlug(subUser, v)
                    setSubValue('')
                  })
                }
              >
                {busy ? t('adminUi.working') : t('admin.grant')}
              </button>
            </div>
          )}

          {/* Grant a paid item to a specific user (admin-only RPC, migration 0022) */}
          <div className="ent-grant">
            <span className="ent-grant-label">{t('admin.unlockFor')}</span>
            <select className="ent-select" value={grantUser} onChange={(e) => setGrantUser(e.target.value)}>
              <option value="">{t('admin.selectUser')}</option>
              {data.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}{u.username ? ` (@${u.username})` : ''}
                </option>
              ))}
            </select>
            <select className="ent-select" value={grantProduct} onChange={(e) => setGrantProduct(e.target.value)}>
              {products.map((p) => (
                <option key={productKey(p.kind, p.itemKey)} value={productKey(p.kind, p.itemKey)}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              className="btn-line btn-gold"
              disabled={busy || !grantUser || !grantProduct}
              onClick={() =>
                void mutate(async () => {
                  const [kind, itemKey = ''] = grantProduct.split('|')
                  // 部屋は**枠を開けるだけでは足りない**（ユーザー指示 2026-08-09
                  // 「部屋がちゃんと追加されるようにして欲しい」）。`admin_add_room`
                  // が台帳と `galleries` を1回で作る（migration 0043）。台帳の
                  // `item_key` もその中で毎回ちがう値になるので、2回目が
                  // `on conflict do nothing` で消えることもない。
                  // `mutate` は void を待つので、部屋idは捨てる（画面は一覧を
                  // 引き直して反映する）。
                  if (kind === 'room') await adminAddRoom(grantUser)
                  else await grantEntitlement(grantUser, kind, itemKey)
                })
              }
            >
              {busy ? t('adminUi.working') : t('admin.grant')}
            </button>
          </div>
          {err && <p className="me-error">{err}</p>}
          <p className="me-note">
            {t('adminUi.packagesNote')}
          </p>
        </div>
      </section>
    </>
  )
}
