# llm-wiki-agent Wiki Root 结构设计

## 背景

原有设计文档中 wiki 根目录采用 entities/concepts/pages 三层分类结构。实际使用中发现 LLM 在 ingest 时需要做分类决策（"这个放 entities 还是 concepts？"），导致不一致。回归 Karpathy LLM Wiki 原始理念：**LLM 不需要做分类决策，分类靠 frontmatter 元数据。**

## Wiki 根目录结构

```
<wiki-root>/
├── AGENTS.md          # Schema — LLM 操作指南
├── index.md           # 页面索引（wiki_write 自动维护）
├── log.md             # 操作日志（wiki_write 自动维护）
├── raw/               # 源文件（用户放置，只读）
└── wiki/              # 结构化文档（LLM 创建和维护，平铺）
```

### 设计原则

1. **两层对应**：`raw/` 和 `wiki/` 对应输入和输出两个层，根目录只放元文件
2. **全平铺**：`wiki/` 下不分 entity/concept 子目录，LLM 不需要做分类决策
3. **元数据驱动**：分类靠 frontmatter 的 `type` 和 `tags` 字段，不靠目录结构
4. **搜索驱动发现**：不依赖目录浏览，`wiki_search` 找内容
5. **自动 bookkeeping**：index.md、log.md、frontmatter 时间戳由工具自动维护

### 和原设计的区别

| 维度 | 原设计 | 新设计 |
|------|--------|--------|
| 目录层级 | entities/concepts/pages 三层 | wiki/ 平铺 |
| 分类方式 | 目录结构 | frontmatter type/tags |
| LLM 决策成本 | 高（选哪个目录） | 低（直接写 wiki/） |
| 扩展性 | 加分类要改目录 | 加分类加 tag 即可 |

## AGENTS.md Schema

AGENTS.md 是 wiki 根目录的核心配置文件，定义 LLM 如何操作这个 wiki。由 `init.ts` 在初始化时生成。

### 内容框架

```
## Wiki 结构         — 目录说明
## 可用工具           — wiki_search / wiki_write / wiki_lint
## 页面格式           — frontmatter 规范、命名规则、wikilink
## 操作流程
### Ingest（录入）   — 读源文件 → 提取 → 写 wiki 页面 → 更新相关页面
### Query（查询）     — 搜索 → 精读 → 综合回答 → 可选归档
### Lint（健康检查）  — 运行 → 修复 → 记录
## 规范               — 引用来源、wikilink、单一主题
```

### Ingest 流程

```
用户指定源文件路径（任意路径，不限于 raw/ 下）
  → LLM: read_file / cat 读取源文件
  → LLM: 提取关键信息
  → LLM: wiki_write({ path: "xxx.md", content: "..." })
  → 自动: frontmatter 时间戳、index.md 追加、log.md 记录
  → LLM: 更新相关页面
  → LLM: 回复用户
```

### Query 流程

```
用户提问
  → LLM: wiki_search({ query: "..." })
  → 返回匹配页面完整内容
  → LLM: read_file 精读最相关页面
  → LLM: 综合回答，注明来源
  → 可选: 有价值回答归档为新 wiki 页面
```

### Lint 流程

```
用户要求检查
  → LLM: wiki_lint({ fix: true })
  → 返回检查报告 + 修复结果
  → LLM: 写入 log.md
```

## 页面格式规范

```markdown
---
title: React Server Components
type: concept          # entity | concept | note
tags: [react, frontend]
created: 2026-04-29
updated: 2026-04-29
---
```

- `type`：`entity`（人物/项目/工具）、`concept`（想法/模式）、`note`（通用笔记）
- `tags`：可选，用于分类
- 文件名：小写 + 连字符（`react-server-components.md`）
- 交叉引用：`[[Page Name]]`

## 当前代码不一致项

以下问题需要在后续实施中修复：

| 问题 | 文件 | 现状 | 应改为 |
|------|------|------|--------|
| wiki_write 路径不限制 | `src/tools/wiki-write.ts` | 路径相对于 wikiRoot，可写到根目录或 raw/ | 自动重定向到 `wiki/` 下 |
| wiki_lint stub 路径错误 | `src/tools/wiki-lint.ts` | 硬编码 `join(wikiRoot, "pages")` | 改为 `join(wikiRoot, "wiki")` |
| init.ts 生成旧版 AGENTS.md | `src/init.ts` | entities/concepts/pages 结构 | 改为 raw/ + wiki/ 结构 |
| init.ts systemDirs 过时 | `src/init.ts` | 包含 entities/concepts/pages | 只保留 raw、wiki |

## 和 v1-redesign 的关系

本设计建立在 v1 工具精简设计（3 自定义工具：search/write/lint）之上，不改变工具集，只改变：
1. Wiki 根目录结构
2. AGENTS.md 内容
3. 工具路径约束

v2 增强（置信度、知识图谱、混合搜索等）不受影响，继续按原计划推进。
