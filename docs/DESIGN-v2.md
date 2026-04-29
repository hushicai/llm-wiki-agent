# LLM Wiki Agent — 设计文档 (v2 扩展)

> 基于 v2 Pattern 的扩展功能，待实现

---

## 1. v2 核心增强

| 增强 | v1 状态 | v2 目标 |
|------|----------|---------|
| hybrid search | grep 扫描 | BM25 + 向量 + 图 |
| 图谱导航 | index.md | 知识图 |
| Confidence | 无 | frontmatter 字段 |
| Typed Relationships | wikilink | typed edges |
| Entity Extraction | 无 | 结构化提取 |
| Consolidation Tiers | 无 | 分层存储 |
| Event-driven | 手动 | 自动触发 |

---

## 2. wiki_search (v2)

### 2.1 参数扩展

```typescript
{
  query: string;
  scope?: "wiki" | "raw" | "all";
  limit?: number;
  channels?: ("grep" | "vector" | "graph")[];  // 新增
  include_graph?: boolean;                   // 新增
}
```

### 2.2 Hybrid Search 实现

```
Query
  │
  ├─→ Grep 通道 ──→ FMM 分词 + IDF+Coverage 评分
  ├─→ 向量通道 ──→ embedding 相似度
  └─→ 图通道 ──→ 种子节点 + 邻居遍历
       │
       └─→ RRF 融合 (k=60, Grep:Vector = 7:3)
```

### 2.3 FMM 分词器

**模块**：`src/search/tokenizer.ts`

**配置**：
- 词典：`~/.llm-wiki-agent/dict/`
- 同义词：`~/.llm-wiki-agent/synonyms.json`
- 默认关闭（按需启用）

---

## 3. 知识图谱

### 3.1 图谱构建

```typescript
// 边类型
type EdgeType = "wikilink" | "shared_tag" | "shared_source";

// 节点
interface GraphNode {
  id: string;
  title: string;
  tags: string[];
  inbound: number;
  outbound: number;
  community: number;  // Louvain 社区
}
```

### 3.2 图工具

| 工具 | 说明 |
|------|------|
| wiki_build_graph | 重建图谱 |
| wiki_graph_query | 查询节点信息 |
| wiki_graph_neighbors | 获取扩展邻居 |

### 3.3 图搜索通道

1. 搜索结果 top-3 为种子节点
2. 遍历 wikilink + shared_tag 邻居
3. 按入度排序取 top-2
4. 标记 source=graph 注入结果

---

## 4. Frontmatter (v2)

```yaml
---
title: React 状态管理
type: entity
tags: [frontend, architecture]
confidence: 0.85           # v2 新增
created: 2026-04-01
updated: 2026-04-10
last_accessed: 2026-04-15  # v2 新增
access_count: 5              # v2 新增
sources: [1, 3]
supersedes: null           # v2 新增
relationships:            # v2 新增
  - { target: "Redux", type: "uses", confidence: 0.9 }
---
```

---

## 5. wiki_ingest (v2)

### 5.1 参数扩展

```typescript
{
  source_path: string;
  options?: {
    force?: boolean;
    tier?: "working" | "episodic" | "semantic" | "procedural";  // 新增
  }
}
```

### 5.2 流程扩展

1. 读取 source
2. **提取实体 + 关系**（新增）
3. 讨论要点
4. 写 summary 页面 + **confidence 字段**
5. 更新 index.md
6. 更新相关 entity/concept 页面
7. **更新图谱关系**（新增）
8. 追加 log.md

---

## 6. wiki_lint (v2)

### 6.1 检查项扩展

| v1 | v2 新增 |
|----|----------|
| orphan pages | confidence decay |
| broken wikilinks | contradiction detection |
| stale claims | retention check |

### 6.2 遗忘曲线

```typescript
// decay_score 计算
decay_score = access_count / (1 + days_since_last_access × decay_rate)

// Lint 时检查 decay_score < 0.1 的页面，标记警告
```

---

## 7. Consolidation Tiers

| Tier | 说明 | 存储 |
|------|------|------|
| working | 临时观察 | raw/sources/ |
| episodic | Session 摘要 | .wiki/sessions/ |
| semantic | 跨 Session 事实 | wiki/ |
| procedural | 提取的工作流 | skills/ |

---

## 8. Event-driven Automation

**Hooks**（v2 目标）：

| Event | Action |
|-------|--------|
| On new source | auto-ingest + extract entities |
| On session start | 加载相关上下文 |
| On session end | 压缩 session 到 episodic |
| On query | 检查是否值得写回 |
| On memory write | 检查矛盾，触发 supersession |
| On schedule | periodic lint + decay |

---

## 9. 与 v1 的关系

- v1 工具参数向下兼容
- v1 检查项是 v2 子集
- v2 新增工具通过 version 判断
- 默认行为保持 v1（不破坏现有）

---

## 10. 实现优先级

| 阶段 | 功能 | 依赖 |
|------|------|------|
| P1 | wiki_search 扩展 | v1 wiki_search |
| P2 | 图谱构建 + 工具 | - |
| P3 | FMM 分词器 | P1 |
| v2.1 | Confidence frontmatter | v1 wiki_ingest |
| v2.2 | 遗忘曲线 | P2 |
| v2.3 | Entity Extraction | P2 |
| v2.4 | Automation Hooks | 以上 |