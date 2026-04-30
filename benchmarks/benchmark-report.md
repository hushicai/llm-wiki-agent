# Skill Invocation Benchmark Report

Date: 2026-04-30
Model: default

| # | Skill | Test Case | Tools Called | Result | Duration |
|---|-------|-----------|-------------|--------|----------|
| 1 | wiki-ingest | ingest: 处理 raw 文件 | read, read, read, read, bash, bash, read, write, edit, read, edit | ✅ PASS | 57.1s |
| 2 | wiki-query | query: 搜索已有知识 | read, read, bash, bash, read | ✅ PASS | 11.6s |
| 3 | wiki-lint | lint: 健康检查 | read, bash, bash, read, bash, edit, edit, read | ✅ PASS | 26.1s |

**Results: 3/3 passed — Accuracy: 100%**
