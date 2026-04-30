---
name: wiki-ingest
description: "Ingest a source document into the wiki. Triggers: 'ingest', '录入', 'add to wiki', 'add source', user drops a file path or URL, 'process this source'."
---

# Wiki Ingest

Fetch a source into `raw/`, then compile it into `wiki/`. Always both steps, no exceptions.

## Fetch (raw/)

1. Get the source content. If the user provides a file path, copy it. If a URL, fetch it. If neither works, ask the user to paste the content directly.

2. Save as `raw/YYYY-MM-DD-descriptive-slug.md`.
   - Slug from source title, kebab-case, max 60 characters.
   - Published date unknown → omit the date prefix from the file name (e.g., `descriptive-slug.md`). The metadata Published field still appears; set it to `Unknown`.
   - If a file with the same name already exists, append a numeric suffix (e.g., `descriptive-slug-2.md`).
   - Include metadata header: source URL, collected date, published date.
   - Preserve original text. Clean formatting noise. Do not rewrite opinions.

   See `references/raw-template.md` for the exact format.

## Compile (wiki/)

Determine where the new content belongs:

- **Same core thesis as existing wiki page** → Merge into that page. Add the new source to `sources` in frontmatter. Update affected sections.
- **New concept** → Create a new page in `wiki/`. Name the file after the concept, not the raw file.
- **Spans multiple topics** → Create multiple pages, each covering one concept.

These are not mutually exclusive. A single source may warrant merging into one page while also creating a separate page for a distinct concept it introduces. In all cases, check for factual conflicts: if the new source contradicts existing content, annotate the disagreement with source attribution.

See `references/article-template.md` for page format. Key points:
- `sources` field: list of raw/ files this page draws from.
- Cross-reference other wiki pages with `[[Page Name]]` wikilinks.

## Cascade Updates

After the primary page, check for ripple effects:

1. Scan existing wiki pages for content affected by the new source.
2. Update every page whose content is materially affected.
3. Each updated file gets its `updated` date refreshed.

## Post-Ingest

Update `wiki/index.md`: add or update entries for every touched page. Each entry: `- [[Page Title]] — One-line summary (Updated: YYYY-MM-DD)`.

Append to `wiki/log.md`:

```
## [YYYY-MM-DD] ingest | <primary page title>
- Created: <new page title>
- Updated: <cascade-updated page title>
```

Omit `- Updated:` lines when no cascade updates occur.
