## Session 1 — Day 1 — 项目骨架搭建

首次启动 llm-wiki-agent 研发项目。基于 DESIGN.md 设计文档，完成 Phase 1 MVP 骨架。

**Tasks:** 完成

---

## Session 2 — 完整工具实现 + Session管理

wiki_read, wiki_write, wiki_search, wiki_list, session.ts 完整实现。

**Tasks:** 完成

---

## Session 3 — Ingest + Lint 完整实现

wiki_ingest, wiki_lint 完整实现。

**Tasks:** 完成

---

## Session 4 — Runtime 框架

创建 WikiAgent 结构（简化版）。

---

## Session 5 — Day 1 — CLI + TUI 集成

- 修复 6 个工具的类型问题（params: unknown）
- CLI 集成 TUI
- 单次查询模式 + 交互模式

**Tasks:** 完成
**Lesson:** TypeScript params 类型需要使用 unknown 而非具体类型

**Wonder:** 完整 pi-agent-core 流式集成
**Worry:** 工具可被 LLM 调用
**Hope:** 测试运行
## Session 6 — Config + Agent Runtime 集成

- 更新 AGENTS.md 源码细节（来自 pi-mono）
- 实现 config.ts 的 loadModel() 函数
- 实现 runtime.ts 的 pi-agent-core 集成
- 写测试：config.test.ts (12 tests), agent-runtime.test.ts (3 tests)

**Tasks:** 完成
**Lesson:** 测试先行 + 源码验证是正确的工作流

**Wonder:** 模型注册表格式需要额外研究
**Worry?** 工具未真正调用 LLM (mock 测试)
**Hope:** 继续集成测试


## Session 7 — Wiki Tools 集成测试

- 添加工具单元测试 tests/tools.test.ts (9 tests)
- 覆盖: wiki_read (4), wiki_write (2), wiki_list (1), createWikiTools (2)
- 总测试数: 24 pass, 0 fail

**Tasks:** 完成
**Lesson:** 工具需要实际文件系统测试验证

**Wonder:** wiki_list 未来支持递归？
**Worry?** 工具参数未使用 TypeBox schema（不符合 pi-agent-core 规范）
**Hope?** 工具可被 LLM 真正调用


## Session 8 — Wiki Tools 完整测试

- 添加 tools-schema.test.ts (7 tests)
- 添加 tools-additional.test.ts (8 tests)
- 总测试数: 39 pass, 0 fail
- 覆盖: 全部 6 个工具

**Tasks:** 完成
**Lesson:** 逐个工具验证行为

**Wonder:** 端到端 Agent 调用工具测试


## Session 9 — Agent 工具集成测试

- 添加 agent-e2e.test.ts (2 tests + 1 skip)
- 验证 Agent 能初始化工具
- 验证 faux provider 能返回响应
- E2E 工具调用测试需要 pi-coding-agent 的完整 harness（标记为 skip）

**Tasks:** 完成
**Lesson:** 完整 E2E 测试需要 harness 设置，暂时跳过

**Wonder:** 创建项目的 test harness
**Worry?** 工具 schema 需要 TypeBox 格式

