// Report a problem: stored in the reports table (migration 0010) for operator review
import type { Metadata } from 'next'
import ReportForm from './ReportForm'

export const metadata: Metadata = { title: 'Report a problem — HAKONIWA' }

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ about?: string }>
}) {
  const { about } = await searchParams
  return <ReportForm about={typeof about === 'string' ? about.slice(0, 200) : ''} />
}
