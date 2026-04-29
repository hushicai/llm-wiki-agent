# AGENTS.md — LLM Wiki Agent

Project: llm-wiki-agent
Version: 0.1.0

---

## 源码查阅

**源码根目录**: `/Users/hushicai/data/github/pi-mono`

| Package | 源码位置 |
|---------|---------|
| `pi-agent-core` | `pi-mono/packages/agent/` |
| `pi-ai` | `pi-mono/packages/ai/` |
| `pi-coding-agent` | `pi-mono/packages/coding-agent/` |

查源码直接在这里找，不需要猜测 API。

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Agent Runtime | `@mariozechner/pi-agent-core` | Agent loop + tool execution |
| LLM API | `@mariozechner/pi-ai` | 多 provider 支持 |
| CLI | `@mariozechner/pi-coding-agent` | 参考架构 |
| Runtime | bun | 直接跑 TS |
| Auth Storage | `AuthStorage` | `packages/coding-agent/src/core/auth-storage.ts` |
| Model Registry | `ModelRegistry` | `packages/coding-agent/src/core/model-registry.ts` |

Source: `~/data/github/pi-mono/`

---

## Architecture

```
llm-wiki-agent/
├── src/
│   ├── cli.ts           # CLI 入口（参考 pi-coding-agent/src/main.ts）
│   ├── config.ts        # Config + loadModel() — 核心
│   ├── runtime.ts       # WikiAgent — Agent 包装
│   ├── types.ts         # TypeBox schemas
│   └── tools/
│       ├── index.ts     # createWikiTools()
│       ├── wiki-read.ts
│       ├── wiki-write.ts
│       ├── wiki-search.ts
│       ├── wiki-list.ts
│       ├── wiki-ingest.ts
│       └── wiki-lint.ts
├── skills/              # wiki-ingest, wiki-query workflows
└── tests/               # 必须是 .test.ts，使用 bun test
```

---

## pi-agent-core Integration

### Agent 核心模式（来源：packages/agent/src/agent.ts）

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import type { AgentTool, AgentMessage } from "@mariozechner/pi-agent-core";

// 1. 创建 Agent
const agent = new Agent({
  initialState: {
    systemPrompt: "You are a wiki agent",
    model: loadedModel,        // pi-ai Model
    thinkingLevel: "medium",   // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
    tools: wikiTools,         // AgentTool[]
  },
  // 默认转换：只保留 user/assistant/toolResult
  // convertToLlm: (messages) => messages.filter(...),
  // transformContext: 可选，上下文转换（如压缩）
  // getApiKey: 可选，动态获取 API key
  // beforeToolCall / afterToolCall: 钩子
});

// 2. 订阅事件
agent.subscribe((event, signal) => {
  switch (event.type) {
    case "agent_start":
    case "agent_end":
    case "turn_start":
    case "turn_end":
    case "message_start":
    case "message_update":
    case "message_end":
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
  }
});

// 3. 发送 prompt
await agent.prompt("What is React?");

// 4. 继续（当最后一个消息是 assistant 时）
await agent.continue();

// 5. 状态
console.log(agent.state.messages);  // 完整对话历史
console.log(agent.state.isStreaming);
```

### AgentLoopConfig 关键字段（来源：packages/agent/src/types.ts）

```typescript
interface AgentLoopConfig {
  model: Model<any>;              // pi-ai Model
  convertToLlm: (messages) => Message[];  // AgentMessage[] → LLM Message[]
  transformContext?: (messages, signal) => Promise<AgentMessage[]>;
  getApiKey?: (provider: string) => string | undefined;
  reasoning?: ThinkingLevel;
  sessionId?: string;
  transport?: "sse" | "websocket" | "auto";
  toolExecution?: "sequential" | "parallel";  // 工具执行模式
  beforeToolCall?: (context, signal) => BeforeToolCallResult | undefined;
  afterToolCall?: (context, signal) => AfterToolCallResult | undefined;
}
```

### AgentTool 签名（来源：packages/agent/src/types.ts）

```typescript
interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
  label: string;                    // UI 显示名
  description: string;
  parameters: TParameters;          // TypeBox schema
  prepareArguments?: (args: unknown) => Static<TParameters>;  // 参数预处理
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: (partialResult: AgentToolResult<TDetails>) => void
  ) => Promise<AgentToolResult<TDetails>>;
  executionMode?: "sequential" | "parallel";
}
```

---

## pi-ai Integration

### Model 加载（来源：packages/ai/src/models.ts）

```typescript
import { getModel, getModels, getProviders, type KnownProvider } from "@mariozechner/pi-ai";

// 列出所有 provider
getProviders();  // ["openai", "anthropic", "google", ...]

// 列出 provider 下的所有模型
getModels("openai");  // Model[]

// 加载特定模型（从 MODELS registry）
const model = getModel("openai", "gpt-4o");
const model = getModel("anthropic", "claude-sonnet-4-20250514");
```

### Model 结构（来源：packages/ai/src/types.ts）

```typescript
interface Model<TApi extends Api> {
  id: string;           // "gpt-4o", "claude-sonnet-4-20250514"
  name: string;         // "GPT-4o"
  api: TApi;            // "openai-responses", "anthropic-messages"
  provider: string;     // "openai", "anthropic"
  baseUrl: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input, output, cacheRead, cacheWrite };
  contextWindow: number;
  maxTokens: number;
}
```

### API Key 检测（来源：packages/ai/src/env-api-keys.ts）

```typescript
import { getEnvApiKey, findEnvKeys } from "@mariozechner/pi-ai";

getEnvApiKey("openai");      // OPENAI_API_KEY
getEnvApiKey("anthropic");   // ANTHROPIC_API_KEY
findEnvKeys("openai");       // ["OPENAI_API_KEY"]
```

### Stream API（来源：packages/ai/src/stream.ts）

```typescript
import { complete, stream, type Context } from "@mariozechner/pi-ai";

// 完整调用
const response = await complete(model, {
  systemPrompt: "You are helpful",
  messages: [{ role: "user", content: "Hi", timestamp: Date.now() }],
  tools: [/* tool definitions */],
}, { apiKey: "..." });

// 流式调用
for await (const event of stream(model, { messages, tools }, { apiKey })) {
  if (event.type === "text") {
    process.stdout.write(event.text);
  } else if (event.type === "tool_call") {
    // handle tool call
  } else if (event.type === "done") {
    // final message
  }
}
```

---

## WikiTool 实现模式

```typescript
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Static } from "typebox";

const WikiReadParams = Type.Object({
  path: Type.String({ description: "页面路径" }),
  offset: Type.Optional(Type.Number()),
  limit: Type.Optional(Type.Number()),
});

export function createWikiReadTool(wikiRoot: string): AgentTool<typeof WikiReadParams> {
  return {
    name: "wiki_read",
    label: "Read Wiki Page",
    description: "读取 wiki 页面内容",
    parameters: WikiReadParams,
    execute: async (
      toolCallId: string,
      params: Static<typeof WikiReadParams>,
      signal?: AbortSignal
    ): Promise<AgentToolResult<WikiReadResult>> => {
      const content = await readWikiPage(wikiRoot, params.path);
      return {
        content: [{ type: "text", text: content }],
        details: { path: params.path, length: content.length },
      };
    },
  };
}
```

---

## 配置管理

### Config 文件格式（~/.llm-wiki-agent/models.json）

```json
{
  "providers": {
    "custom": {
      "base_url": "https://opencode.ai/zen/v1",
      "api": "openai-completions",
      "api_key": "public",
      "models": [
        {
          "id": "big-pickle",
          "input": ["text"]
        }
      ]
    }
  }
}
```

配置说明：
- `base_url`：API 端点
- `api`：API 类型（`openai-completions` | `openai-chat` | `anthropic-messages`）
- `api_key`：API 密钥
- `models`：模型列表，默认使用第一个

### loadDefaultModel 实现

```typescript
import { AgentConfig } from "./types.js";

interface ConfiguredModel {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  apiKey?: string;
  // ... 标准 Model 字段
}

export async function loadDefaultModel(
  configPath: string = DEFAULT_CONFIG_PATH
): Promise<ConfiguredModel> {
  const config = await loadConfig(configPath);
  const providerName = Object.keys(config.providers)[0];  // 默认第一个 provider
  const provider = config.providers[providerName];
  const modelConfig = provider.models[0];  // 默认第一个模型

  return {
    id: modelConfig.id,
    name: modelConfig.id,
    api: provider.api,
    provider: providerName,
    baseUrl: provider.base_url,
    apiKey: provider.api_key,
    // ...
  };
}
```

### Agent 创建时传递 API Key

```typescript
const agent = new Agent({
  initialState: {
    model,
    systemPrompt,
    thinkingLevel,
    tools,
  },
  getApiKey: async (provider: string) => {
    if (model.apiKey) return model.apiKey;
    return process.env[`${provider.toUpperCase()}_API_KEY`];
  },
});
```

---

## 测试要求

- 测试文件：`tests/*.test.ts`
- 运行：`bun test`
- 框架：`bun:test`
- **测试先行**：先写失败的测试，再实现功能

---

## 工具列表

| Tool | Description | Status |
|------|-------------|--------|
| wiki_read | 读取 wiki 页面 | ✓ |
| wiki_write | 创建/更新 wiki 页面 | ✓ |
| wiki_search | 搜索 wiki 内容 | ✓ |
| wiki_list | 列出 wiki 结构 | ✓ |
| wiki_ingest | 从 raw 导入 wiki | ✓ |
| wiki_lint | 检查 wiki 健康 | ✓ |

---

## 缺失功能（优先级排序）

1. **Streaming** — TUI 需要显示流式响应
2. **测试覆盖** — Agent 执行测试、端到端测试
