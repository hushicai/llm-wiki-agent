# Wiki Agent — {{WIKI_NAME}}

## 结构

```
{{STRUCTURE}}
```

- **raw/**：只读，用户放原始材料
- **wiki/**：你创建和维护的知识页面
- **index.md**、**log.md**：自动维护

## 技能

| 技能 | 用途 |
|------|------|
| wiki-ingest | 录入源文件到 wiki |
| wiki-query | 搜索 wiki 并回答 |
| wiki-lint | 健康检查与自动修复 |

每次操作后追加记录到 log.md。

## 页面格式

```markdown
---
title: 页面标题
type: concept | entity | note   # 概念、实体、笔记
tags: [标签1, 标签2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources:
  - raw/源文件名.md
---

# 页面标题

正文内容...
```

用 `[[Page Name]]` 交叉引用其他页面。

## 规范

- **引用来源** — 每个事实注明来自哪个页面或源文件
- **wikilink** — 用 `[[Page Name]]` 连接相关页面
- **单一主题** — 一页只讲一个主题
- **不修改 raw/** — 源文件只读
- **文件名** — kebab-case，用核心概念名称
