// Emits a schema.org graph as a <script type="application/ld+json">.
//
// Next.js does not model structured data in `metadata`, so the recommended way is a
// script tag rendered by the page itself. React escapes text children, which would
// corrupt the JSON, so this goes through dangerouslySetInnerHTML — the content is
// `JSON.stringify` output, never a raw string from the database.
//
// `</script>` inside a value would end the tag early, so the one sequence that can
// break out is escaped. JSON.stringify already escapes quotes and backslashes.
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  )
}
