# Wiki Skills (v1 — Skills-based)

Skills-based implementation of the three core wiki operations.

## Structure

```
skills/
├── wiki-ingest/       # Ingest source documents into the wiki
│   ├── SKILL.md
│   └── references/
│       ├── raw-template.md
│       └── article-template.md
├── wiki-query/        # Query the wiki for knowledge
│   ├── SKILL.md
│   └── references/
│       └── archive-template.md
└── wiki-lint/         # Health-check the wiki
    └── SKILL.md
```

## Install

```bash
cp -r skills ~/.llm-wiki-agent/skills
```

The runtime at `~/.llm-wiki-agent/skills/` is loaded at session start via `additionalSkillPaths`.
