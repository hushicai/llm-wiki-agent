# llm-wiki-agent v2 Implementation Plan

**Goal:** 在 v1 基础上增加高级能力：置信度/遗忘机制、知识图谱、混合搜索、自动化 hooks、多 Agent 协作。

**Architecture:** v1 工具接口保持稳定，v2 只改内部实现。通过 frontmatter 扩展字段、新增工具、替换内部实现、Extension 系统等方式实现。

**前置条件:** v1 核心链路完整可用（6 个工具、自动 bookkeeping、110+ 测试通过）。

---

### Phase 1: 置信度与遗忘机制

**复杂度:** 中

**设计：**
- 在 frontmatter 中扩展 `confidence` 字段（0.0-1.0）
- 新增 `wiki_decay` 工具：定期扫描所有页面，根据最后更新时间衰减 confidence
- 新增 `wiki_crystallize` 工具：将高 confidence 的"working"层级内容合并到"semantic"层级
- wiki_lint 增加 stale claim 检测（低 confidence + 长时间未更新）

**文件：**
- Modify: `src/types.ts` — 扩展 `WikiPageFrontmatter` 增加 confidence 字段
- Create: `src/tools/wiki-decay.ts`
- Create: `src/tools/wiki-crystallize.ts`
- Modify: `src/tools/wiki-lint.ts` — 增加 stale claim 检测
- Modify: `src/tools/index.ts` — 注册新工具

**依赖：**
- 需要引入定时调度机制（cron 或 Extension hook）

---

### Phase 2: 知识图谱

**复杂度:** 高

**设计：**
- 新增 `wiki_graph` 工具：遍历实体关系
- 存储方式：在 wiki 根目录维护 `.wiki/graph.json`（邻接表）
- wiki_write 写入时自动提取 `[[Page Name]]` 关系写入 graph
- wiki_lint 增加图一致性检查

**文件：**
- Create: `src/tools/wiki-graph.ts`
- Modify: `src/tools/wiki-write.ts` — 写入时同步更新 graph
- Modify: `src/tools/wiki-lint.ts` — 图一致性检查
- Create: `src/graph.ts` — 图数据结构和遍历算法

**依赖：**
- 需要引入图存储格式设计
- 需要处理图更新与页面删除的一致性

---

### Phase 3: 混合搜索

**复杂度:** 中

**设计：**
- 替换 `wiki_search` 内部实现：BM25 + 向量检索融合
- 向量存储：使用 SQLite + sqlite-vec 或独立向量数据库
- 索引构建：写入时自动更新索引
- 搜索时：BM25 召回 + 向量召回 + 融合排序

**文件：**
- Modify: `src/tools/wiki-search.ts` — 内部实现替换
- Create: `src/search.ts` — 搜索索引管理
- Create: `src/embeddings.ts` — 向量生成（调用 LLM embedding API）

**依赖：**
- 需要 LLM Provider 支持 embedding API
- 需要引入向量存储依赖

---

### Phase 4: 自动化 Hooks

**复杂度:** 低

**设计：**
- 利用 pi-coding-agent 的 Extension 系统
- 注册 `tool_call` 事件处理器，在 wiki_write 后自动触发 decay/crystallize
- 注册 `turn_end` 事件处理器，在对话结束后自动 lint

**文件：**
- Create: `~/.llm-wiki-agent/extensions/auto-maintain.ts`
- 无需修改核心代码

**依赖：**
- 依赖 Extension 运行时（v1 已支持）

---

### Phase 5: 多 Agent 协作

**复杂度:** 高

**设计：**
- 共享存储层：多个 Agent 实例操作同一个 wiki 目录
- 冲突检测：wiki_write 时检测文件是否被其他 Agent 修改
- 协作协议：通过 log.md 广播操作事件

**文件：**
- Modify: `src/tools/wiki-write.ts` — 冲突检测
- Create: `src/collaboration.ts` — 协作协议

**依赖：**
- 需要设计锁机制或乐观并发控制

---

## 实施顺序

| 优先级 | Phase | 预估工作量 | 前置依赖 |
|--------|-------|-----------|----------|
| 1 | Phase 4: 自动化 Hooks | 1-2 天 | v1 完成 |
| 2 | Phase 1: 置信度/遗忘 | 3-5 天 | Phase 4 |
| 3 | Phase 3: 混合搜索 | 5-7 天 | 无 |
| 4 | Phase 2: 知识图谱 | 7-10 天 | Phase 1, 3 |
| 5 | Phase 5: 多 Agent 协作 | 5-7 天 | Phase 2 |
