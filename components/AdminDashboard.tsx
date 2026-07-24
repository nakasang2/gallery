'use client'
// Presentational layer for the admin console — renders over `data` (app/admin)
// or fixtures (verification). `onReload` (optional) lets the entitlement
// grant/revoke controls refresh after a change.
import { useMemo, useState } from 'react'
import { usd } from '@/lib/pricing'
import { THEMES, LAYOUTS } from '@/lib/presets'
import { getEntitlements, isThemeUnlocked, isLayoutUnlocked } from '@/lib/entitlements'
import { grantEntitlement, revokeEntitlement, type AdminOverview } from '@/lib/admin'

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
  const products = useGrantableProducts()
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
        <div className="stat"><b>{data.totals.users}</b><span>Users</span></div>
        <div className="stat"><b>{data.totals.galleries}</b><span>Galleries</span></div>
        <div className="stat"><b>{data.totals.publicGalleries}</b><span>Public</span></div>
        <div className="stat"><b>{data.totals.works}</b><span>Works</span></div>
        <div className="stat"><b>{usd(data.totals.revenueJpy)}</b><span>Revenue</span></div>
        <div className="stat"><b>{data.totals.reports}</b><span>Reports</span></div>
      </div>

      {/* Revenue */}
      <section className="me-section">
        <h2>Revenue</h2>
        <div className="me-card">
          <p className="me-note" style={{ marginTop: 0 }}>
            Total charged: <b style={{ color: 'var(--ink)' }}>{usd(data.totals.revenueJpy)}</b>{' '}
            across {data.purchases.length} purchase{data.purchases.length === 1 ? '' : 's'}.
          </p>
          {data.purchases.length === 0 ? (
            <p className="me-note">
              No purchases recorded yet. Amounts are stored in USD cents in the
              <code> amount_jpy</code> column (legacy name) and summed here.
            </p>
          ) : (
            <Table
              head={
                <>
                  <th style={th}>SKU / kind</th>
                  <th style={th}>Count</th>
                  <th style={th}>Amount</th>
                </>
              }
            >
              {data.revenueByKind.map((r) => (
                <tr key={r.key}>
                  <td style={cell}>{r.key}</td>
                  <td style={cell}>{r.count}</td>
                  <td style={cell}>{usd(r.sumJpy)}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </section>

      {/* Exhibitions */}
      <section className="me-section">
        <h2>Exhibition spaces ({data.galleries.length})</h2>
        <div className="me-card">
          {data.galleries.length === 0 ? (
            <p className="me-note" style={{ marginTop: 0 }}>No galleries yet.</p>
          ) : (
            <Table
              head={
                <>
                  <th style={th}>Title</th>
                  <th style={th}>Artist</th>
                  <th style={th}>State</th>
                  <th style={th}>Works</th>
                  <th style={th}>Visits</th>
                  <th style={th}>Theme</th>
                  <th style={th}>Updated</th>
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
            <p className="me-note" style={{ marginTop: 0 }}>No users yet.</p>
          ) : (
            <Table
              head={
                <>
                  <th style={th}>Artist</th>
                  <th style={th}>Username</th>
                  <th style={th}>Galleries</th>
                  <th style={th}>Works</th>
                  <th style={th}>Packages</th>
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
                        <span style={{ color: 'var(--muted)' }}>free</span>
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
            <span className="ent-grant-label">Unlock for a user:</span>
            <select className="ent-select" value={grantUser} onChange={(e) => setGrantUser(e.target.value)}>
              <option value="">Select user…</option>
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
            “Packages” shows what each user owns — bought via checkout or granted here. Use the × to
            revoke. Grants write the <code>purchases</code> ledger (as <code>admin_grant</code>, $0, so
            they don&apos;t count as revenue) and unlock instantly. New paid themes/layouts appear in the
            list automatically. Email addresses live in Supabase Auth (not exposed to the anon key).
          </p>
        </div>
      </section>
    </>
  )
}
