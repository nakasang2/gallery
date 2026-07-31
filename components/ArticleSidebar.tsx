// Guides (/articles と /articles/[slug]) の脇に立てる案内。
//
// 役目は SEO 流入の受け止め: 検索から本文にいきなり降りてきた人は、そこが何の
// サービスのブログなのか分からないまま読み始める。ヘッダのロゴだけでは弱いので、
// 「これは何か」「試す導線」「ほかのガイド」を本文の隣に常時置く。
// PC ではスクロールに追従（sticky）、狭い幅では本文の下に積む。
import Link from 'next/link'
import { LocaleLink } from '@/components/I18nProvider'
import { getServerT } from '@/lib/i18n/server'
import type { ArticleCard } from '@/lib/blog'

export default async function ArticleSidebar({ more = [] }: { more?: ArticleCard[] }) {
  const { t } = await getServerT()

  return (
    <aside className="article-side">
      <div className="article-side-inner">
        {/* 見出しがどの言語でもブランド名を含むので、ロゴの重ね置きはしない */}
        <section className="article-side-card article-side-about">
          <h2 className="article-side-title">{t('articles.sideWhat')}</h2>
          <p className="article-side-body">{t('articles.sideBody')}</p>
          <div className="article-side-actions">
            <Link href="/signup" className="btn btn-gold">
              {t('common.startFree')}
            </Link>
            <LocaleLink href="/demo" className="btn-line">
              {t('lp.heroCta')}
            </LocaleLink>
          </div>
        </section>

        {more.length > 0 && (
          <section className="article-side-card">
            <h2 className="article-side-title">{t('articles.sideMore')}</h2>
            <ul className="article-side-list">
              {more.map((a) => (
                <li key={a.slug}>
                  <LocaleLink href={`/articles/${a.slug}`}>{a.title}</LocaleLink>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="article-side-explore">
          <LocaleLink href="/explore">{t('articles.sideExplore')}</LocaleLink>
        </p>
      </div>
    </aside>
  )
}
