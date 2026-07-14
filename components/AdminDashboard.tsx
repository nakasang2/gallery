'use client'
// Presentational layer for the admin console — pure over `data`, so it renders
// with real data (app/admin) or fixtures (verification) identically.
import { yen } from '@/lib/pricing'
import type { AdminOverview } from '@/lib/admin'

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

export default function AdminDashboard({ data }: { data: AdminOverview }) {
  return (
    <>
      {/* KPIs */}
      <div className="stat-row" style={{ marginTop: '1rem' }}>
        <div className="stat"><b>{data.totals.users}</b><span>Users</span></div>
        <div className="stat"><b>{data.totals.galleries}</b><span>Galleries</span></div>
        <div className="stat"><b>{data.totals.publicGalleries}</b><span>Public</span></div>
        <div className="stat"><b>{data.totals.works}</b><span>Works</span></div>
        <div className="stat"><b>{yen(data.totals.revenueJpy)}</b><span>Revenue</span></div>
        <div className="stat"><b>{data.totals.reports}</b><span>Reports</span></div>
      </div>

      {/* Revenue */}
      <section className="me-section">
        <h2>Revenue</h2>
        <div className="me-card">
          <p className="me-note" style={{ marginTop: 0 }}>
            Total charged: <b style={{ color: 'var(--ink)' }}>{yen(data.totals.revenueJpy)}</b>{' '}
            across {data.purchases.length} purchase{data.purchases.length === 1 ? '' : 's'}.
          </p>
          {data.purchases.length === 0 ? (
            <p className="me-note">
              No purchases recorded yet. Checkout isn&apos;t connected, so this stays ¥0 until a
              payment integration writes to the <code>purchases</code> ledger (0017 added
              <code> amount_jpy</code> so totals add up the moment it does).
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
                  <td style={cell}>{yen(r.sumJpy)}</td>
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
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td style={cell}>{u.displayName}</td>
                  <td style={cell}>{u.username ? `@${u.username}` : '—'}</td>
                  <td style={cell}>{u.galleryCount}{u.publicCount ? ` (${u.publicCount} public)` : ''}</td>
                  <td style={cell}>{u.workCount}</td>
                  <td style={cell}>
                    {u.packages.length ? u.packages.join(', ') : <span style={{ color: 'var(--muted)' }}>free</span>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <p className="me-note">
            Everyone currently has full access to every feature (entitlements return
            full-access until billing exists), so “Packages” only fills in once real
            purchases are recorded. Email addresses live in Supabase Auth and aren&apos;t
            exposed to the anon key — look them up there if needed.
          </p>
        </div>
      </section>
    </>
  )
}
