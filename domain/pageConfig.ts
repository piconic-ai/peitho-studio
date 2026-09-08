// A slide's PageComment — the JSON-shaped HTML comment slides.ts's
// extractPageComment/updatePageComment locate and rewrite. Mirrors
// peitho-core's own `PageComment` struct (deny_unknown_fields; see
// crates/peitho-core/src/parser.rs) field-for-field: `section` and `time`
// are independent optional fields there (not a nested pair) — this app's
// own UI always sets/clears them together (see updateSlideConfig's
// toggleSlideSection call sites), but that's an application-level
// convention, not something peitho-core's own shape encodes.
export interface PageConfig {
  key?: string
  layout?: string
  section?: string
  time?: string
  draft?: boolean
  skip?: boolean
  page_number?: boolean
}

/** The result of parsing a PageComment's JSON body (the text already
 * extracted from its `<!-- ... -->` wrapper by the caller). `absent` means
 * no such comment was found at all; `malformed` preserves the raw text
 * that failed to parse rather than silently discarding it, so a caller
 * that cares can surface *why* a slide's config looks empty instead of
 * just seeing `{}`. */
export type ParsedPageComment =
  | { kind: 'absent' }
  | { kind: 'ok'; config: PageConfig }
  | { kind: 'malformed'; raw: string }

/** Parses a PageComment's JSON body. `body` is `null` when no
 * PageComment-shaped comment was found in the slide at all (distinct from
 * a comment that failed to parse, which is `malformed`). */
export function parsePageComment(body: string | null): ParsedPageComment {
  if (body === null) return { kind: 'absent' }
  try {
    const config = JSON.parse(body) as PageConfig
    return { kind: 'ok', config }
  } catch {
    return { kind: 'malformed', raw: body }
  }
}

/** The usable `PageConfig` from a parse result — `{}` for `absent` or
 * `malformed`, matching extractPageComment's long-standing "never throws,
 * silently falls back to empty" contract for callers that don't need to
 * distinguish those two cases from each other. */
export function configOf(parsed: ParsedPageComment): PageConfig {
  return parsed.kind === 'ok' ? parsed.config : {}
}

export function serializePageConfig(config: PageConfig): string {
  return JSON.stringify(config)
}
