# AGENTS.md — llm-wiki-agent

Project: llm-wiki-agent
Version: 0.1.0

---

## Tech Stack

- Runtime: bun
- SDK: `@mariozechner/pi-coding-agent`
- LLM API: `@mariozechner/pi-ai`
- Config dir: `~/.llm-wiki-agent/`

---

## Development

### Commands

```bash
bun run src/cli.ts --wiki <path>        # Auto-init + interactive
echo "query" | bun run src/cli.ts --wiki <path>   # Pipeline query
bun test                                 # Run tests
bun build                                # Build dist/
```

### Testing

- Test files: `tests/*.test.ts`
- Framework: `bun:test`
- Run: `bun test` (from project root)
- Every tool must have unit tests covering: success path, error path, edge cases

---

## Coding Conventions

### Imports

- Use top-level imports only — no `await import()`, no inline dynamic imports
- Import types with `import type` syntax
- Prefer named exports over default exports

### Types

- Use TypeBox schemas for tool parameters (`src/types.ts`)
- Export tool parameter types as `Static<typeof Schema>`
- No `any` types unless absolutely necessary

### Tools (ToolDefinition)

Tools follow this pattern:

```typescript
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export function createXxxTool(wikiRoot: string): ToolDefinition {
  return {
    name: "wiki_xxx",
    label: "Xxx",
    description: "Description of what this tool does.",
    parameters: { /* JSON Schema or TypeBox */ },
    execute: async (toolCallId, params) => {
      // 1. Validate params
      // 2. Perform operation
      // 3. Return { content: [{ type: "text", text: result }] }
    },
  };
}
```

- Tool names: `wiki_` prefix + verb (read, write, search, list, ingest, lint)
- Tool descriptions: describe WHEN to use, not just WHAT it does
- Parameters: include `description` field for each param (LLM reads these)
- Return: always `{ content: [{ type: "text", text: "..." }] }`

### Runtime (createWikiSession)

```typescript
const runtime = await createWikiSession({ wikiRoot });
const session = runtime.session;

// PrintMode
await session.prompt(query);

// InteractiveMode
const mode = new InteractiveMode(runtime);
await mode.run();
```

- Session is bound to one wiki root — no runtime switching
- Tools passed via `tools` (allowlist) + `customTools` (definitions)
- Config loaded from `~/.llm-wiki-agent/` automatically

### Config

- `models.json`: camelCase (`baseUrl`, `apiKey`, not `base_url`, `api_key`)
- API types: `openai-completions`, `openai-responses`, `anthropic-messages`
- Settings: `settings.json` with `defaultProvider`, `defaultModel`, `defaultThinkingLevel`

---

## Design Documents

- Architecture design: `docs/superpowers/specs/2026-04-29-llm-wiki-agent-design.md`
- Tech stack: `docs/superpowers/specs/2026-04-29-llm-wiki-agent-tech-stack.md`
- v1 implementation plan: `docs/superpowers/specs/2026-04-29-llm-wiki-agent-v1-plan.md`
- v2 implementation plan: `docs/superpowers/specs/2026-04-29-llm-wiki-agent-v2-plan.md`
- Reference docs: `references/llm-wiki.md`, `references/llm-wiki-v2.md`
