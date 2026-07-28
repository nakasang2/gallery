'use client'
// Presentational layer for the admin console — renders over `data` (app/admin)
// or fixtures (verification). `onReload` (optional) lets the entitlement
// grant/revoke controls refresh after a change.
import { useMemo, useState } from 'react'
import { money } from '@/lib/pricing'
import { THEMES, LAYOUTS } from '@/lib/presets'
import { getEntitlements, isThemeUnlocked, isLayoutUnlocked } from '@/lib/entitlements'
import {
  grantEntitlement,
  revokeEntitlement,
  setReportStatus,
  setGalleryPublic,
  type AdminOverview,
} from '@/lib/admin'
import { useT } from '@/components/I18nProvider'

/** Encode a product as "kind|itemKey" for the <select> value. */
function productKey(kind: string, itemKey: string): string {
  return `${kind}|${itemKey}`
}

/** The paid items an admin can grant — fixed capabilities plus every theme/layout
 *  that isn't free by default. Reads the live presets, so a future paid theme or
 *  layout shows up here automatically with no code change. */
function useGrantableProducts() {
  return useMemo(() => {
    const free = getEntitlements(null)
    const list: { kind: string; itemKey: string; label: string }[] = [
      { kind: 'design_tools', itemKey: '', label: 'Design Tools' },
      { kind: 'video_pass', itemKey: '', label: 'Video Pass' },
    ]
    for (const id of Object.keys(THEMES)) {
      if (!isThemeUnlocked(id, free)) list.push({ kind: 'theme', itemKey: id, label: `Theme · ${THEMES[id].label}` })
    }
    for (const id of [...Object.keys(LAYOUTS), 'custom']) {
      if (!isLayoutUnlocked(id, free)) list.push({ kind: 'layout', itemKey: id, label: `Layout · ${LAYOUTS[id]?.label ?? id}` })
    }
    return list
  }, [])
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
  const [grantProduct, setGrantProduct] = useState(() => (products[0] ? productKey(products[0].kind, products[0].itemKey) : ''))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Purchases grouped by user, so each user's chips carry the exact kind/item_key to revoke
  const purchasesByUser = useMemo(() => {
    const m = new Map<string, AdminOverview['purchases']>()
    for (const p of data.purchases) {
      const list = m.get(p.userId) ?? []
      list.push(p)
      m.set(p.userId, list)
    }
    return m
  }, [data.purchases])

  function labelFor(kind: string, itemKey: string): string {
    if (kind === 'theme') return `Theme · ${THEMES[itemKey]?.label ?? itemKey}`
    if (kind === 'layout') return `Layout · ${LAYOUTS[itemKey]?.label ?? itemKey}`
    if (kind === 'design_tools') return 'Design Tools'
    if (kind === 'video_pass') return 'Video Pass'
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
                        {g.title || '(untitled)'}
                      </a>
                    ) : (
                      g.title || '(untitled)'
                    )}
                  </td>
                  <td style={cell}>{g.ownerName}{g.username ? ` · @${g.username}` : ''}</td>
                  <td style={cell}>
                    <span className={`hako-state${g.isPublic ? ' open' : ''}`}>{g.isPublic ? 'OPEN' : 'PRIVATE'}</span>
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
        <h2>Users ({data.users.length})</h2>
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
                  <th style={th}>{t('admin.colPackages')}</th>
                </>
              }
            >
              {data.users.map((u) => {
                const purchases = purchasesByUser.get(u.id) ?? []
                return (
                  <tr key={u.id}>
                    <td style={cell}>{u.displayName}</td>
                    <td style={cell}>{u.username ? `@${u.username}` : '—'}</td>
                    <td style={cell}>{u.galleryCount}{u.publicCount ? ` (${u.publicCount} public)` : ''}</td>
                    <td style={cell}>{u.workCount}</td>
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
                                aria-label={`Revoke ${labelFor(p.kind, p.itemKey)}`}
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
                void mutate(() => {
                  const [kind, itemKey = ''] = grantProduct.split('|')
                  return grantEntitlement(grantUser, kind, itemKey)
                })
              }
            >
              {busy ? 'Working…' : 'Grant'}
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
