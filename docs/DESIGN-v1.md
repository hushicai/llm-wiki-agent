# LLM Wiki Agent — 设计文档 (v1 实现版)

> 当前 MVP 已实现/计划实现的功能，基于 v1 Pattern

---

## 1. v1 核心操作

| 操作 | 说明 | 实现状态 |
|------|------|----------|
| Ingest | 摄入源 → 更新 wiki 页面 | ✅ 已设计 |
| Query | 搜索 wiki → 返回答案 | ✅ 已设计 |
| Lint | 健康检查 → 修复问题 | ✅ 已设计 |

---

## 2. 目录结构

```
wiki-root/
├── AGENTS.md               # Schema Workflow
├── .wikiconfig.yaml        # Wiki 本地配置
├── .wiki/
│   ├── log.md              # 操作日志
│   └── sessions/           # 对话 Session
├── raw/
│   ├── sources/            # 原始资料
│   └── assets/             # 附件
└── wiki/
    ├── index.md            # 页面目录（v1 导航）
    ├── entities/           # 实体页面
    ├── concepts/           # 概念页面
    ├── sources/            # 来源摘要页
    └── synthesis/          # 综合页
```

---

## 3. 工具设计

### 3.1 wiki_read

**用途**：读取 wiki 页面或 raw source

**参数**：
```typescript
{
  path: string;        // 页面路径
  offset?: number;     // 行号
  limit?: number;      // 最大行数
  mode?: "wiki" | "raw";
}
```

**实现**：fs.readFile + frontmatter 解析

---

### 3.2 wiki_write

**用途**：创建/更新页面

**参数**：
```typescript
{
  path: string;
  content: string;
  frontmatter?: object;
  mode?: "create" | "update";
}
```

**实现**：自动追加 `updated` 时间戳

---

### 3.3 wiki_search

**用途**：搜索 wiki 内容

**参数**：
```typescript
{
  query: string;
  scope?: "wiki" | "raw" | "all";
  limit?: number;
}
```

**v1 实现**：grep 扫描所有 `.md` 文件，关键词匹配 + 上下文片段

---

### 3.4 wiki_list

**用途**：列出目录结构

**参数**：
```typescript
{
  path?: string;
  format?: "tree" | "index";
  include_raw?: boolean;
}
```

---

### 3.5 wiki_ingest

**用途**：消化 raw source

**参数**：
```typescript
{
  source_path: string;
  options?: { force?: boolean; }
}
```

**v1 流程**（LLM 自主决定）：
1. 读取 source
2. 讨论要点
3. 写 summary 页面到 `wiki/sources/`
4. 更新 `index.md`
5. 更新相关 entity/concept 页面
6. 追加 `log.md`

---

### 3.6 wiki_lint

**用途**：健康检查

**参数**：
```typescript
{
  mode?: "quick" | "full";
  fix?: boolean;
}
```

**v1 检查项**：orphan pages、broken wikilinks、stale claims

---

## 4. Frontmatter (v1)

```yaml
---
title: React 状态管理
type: entity
tags: [frontend, architecture]
created: 2026-04-01
updated: 2026-04-10
sources: [1, 3]
---
```

---

## 5. 技术约束

| 决策 | 理由 |
|------|------|
| grep 搜索 | v1 够用 |
| 不用外部工具 | 简化依赖 |
| Session 用 JSONL | 简化优先 |
| 工具 sequential | wiki 操作有因果顺序 |

---

## 6. 待完成 (v1 MVP)

- [ ] 项目骨架 + TUI
- [ ] 6 个 wiki 工具实现
- [ ] Session 管理
- [ ] 默认 AGENTS.md 模板