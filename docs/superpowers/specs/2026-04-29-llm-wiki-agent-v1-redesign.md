# llm-wiki-agent v1 工具精简设计

## 背景

当前有 6 个自定义工具（read/write/search/list/ingest/lint），但很多是 LLM 内部步骤而非用户直接操作。回归 Karpathy LLM Wiki 原始理念：LLM 应有 bash 能力，自定义工具只做 bash 做不到的事。

## 架构变更

### 放开 pi 原生工具

移除 `tools: wikiToolNames` 白名单限制，允许 pi 原生工具：

| 原生工具 | 替代的自定义工具 | 用途 |
|---------|----------------|------|
| `bash` | — | 文件操作、脚本执行 |
| `read_file` | wiki_read | 读 wiki 页面 |
| `write_file` / `edit_file` | wiki_write | 写/编辑 wiki 页面 |
| `search` / `list_files` | wiki_search / wiki_list | 搜索、列目录 |

### 保留/新增的自定义工具

| 工具 | 原因 | v1 实现 | v2 升级 |
|------|------|---------|---------|
| **wiki_search** | grep 做不到语义搜索，v2 需要混合检索 | grep + 返回全文 | BM25 + vector + graph 三路融合 |
| **wiki_write** | LLM 分析后需要写页面，原生 write_file 无 bookkeeping | 保留现有实现（自动管理 frontmatter/index/log） | 不变 |
| **wiki_lint** | orphan page / broken wikilink 检测 bash 写起来太痛苦 | 保留现有实现 | 增加 stale claim、矛盾检测 |

### 移除的工具

| 工具 | 原因 |
|------|------|
| wiki_read | 被原生 read_file 替代 |
| wiki_list | 被原生 list_files / bash ls 替代 |
| wiki_ingest | 被 bash cat + 原生 read_file 替代 |

### wiki_write 保留原因

ingest 流程：`bash cat raw/article.md` → LLM 分析内容 → **wiki_write** 保存为 wiki 页面

LLM 分析步骤发生在工具调用之间，不能被合并。wiki_write 的自动 bookkeeping（frontmatter 时间戳、index.md、log.md）是原生 write_file 没有的。

## 工作流

### 录入
```
用户: "帮我处理这个文件"
  → LLM: cat raw/article.md（或 read_file）
  → LLM: 分析内容
  → LLM: wiki_write({ path: "entities/react.md", content: "..." })
  → 自动: frontmatter 时间戳、index.md 追加、log.md 记录
```

### 查询
```
用户: "React 是什么？"
  → LLM: wiki_search({ query: "React" })
  → 返回匹配页面完整内容
  → LLM: 综合回答
```

### 检查
```
用户: "检查 wiki 健康"
  → LLM: wiki_lint({ fix: true })
  → 返回检查报告 + 修复结果
```

## 实施步骤

1. 修改 `src/runtime.ts`：移除 `tools: wikiToolNames` 白名单，放开原生工具
2. 删除 `src/tools/wiki-read.ts`、`wiki-list.ts`、`wiki-ingest.ts`
3. 更新 `src/tools/index.ts`：只注册 wiki_search、wiki_write、wiki_lint
4. 重写 `wiki_search`：基于 grep 搜索，返回匹配文件完整内容
5. 更新 AGENTS.md 模板（`src/init.ts`）：反映新工作流
6. 更新测试：删除旧工具测试，更新 search/write/lint 测试
