# Skill Invocation Benchmark Report

Date: 2026-05-02
Model: default

| # | Skill | Test Case | Tools Called | Result | Duration |
|---|-------|-----------|-------------|--------|----------|
| 1 | wiki-ingest | ingest: 处理 raw 文件 | read, subagent, bash, bash, read, read, read, write, edit, edit, read, read, read | ✅ PASS | 33.9s |
| 2 | wiki-query | query: 搜索已有知识 | bash, read, read | ✅ PASS | 12.2s |
| 3 | wiki-lint | lint: 健康检查 | bash, bash, read, read, read, read, bash, bash | ✅ PASS | 33.0s |

**Results: 3/3 passed — Accuracy: 100%**
