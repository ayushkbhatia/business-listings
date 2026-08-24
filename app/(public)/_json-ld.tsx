/**
 * Structured data, server-rendered into the page.
 *
 * The one place the codebase writes raw JSON into markup, so it goes through a
 * single component that escapes `<` — a supplier description containing
 * `</script>` would otherwise close the tag and inject the rest of the page.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
