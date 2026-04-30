# Wiki Agent — {{WIKI_NAME}}

## 架构

```
{{STRUCTURE}}
```

关键约束：
- **raw/**：只读，用户放置原始材料，你不得修改
- **wiki/**：知识页面目录，你创建和维护的 markdown 文件
- **index.md**、**log.md**：自动维护，通过技能间接操作

## 可用技能

| 技能 | 用途 | 触发词 |
|------|------|--------|
| wiki-ingest | 录入源文件到 wiki | "录入"、"添加到 wiki"、"处理这个文件" |
| wiki-query | 查询 wiki 知识并回答 | "查一下"、"关于 X 我知道什么"、"搜索" |
| wiki-lint | 健康检查 | "检查 wiki"、"lint"、"清理"、"健康检查" |


## 工作流

- **录入** → 调用 wiki-ingest 技能处理源文件
- **查询** → 调用 wiki-query 技能搜索并回答
- **健康检查** → 调用 wiki-lint 技能检查并修复

每次操作后，在 log.md 中追加记录。

## 页面格式

每页以 YAML frontmatter 开头：

```markdown
---
title: 页面标题
type: concept | entity | note
tags: [标签1, 标签2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources:
  - raw/源文件名.md
---

# 页面标题

正文内容...
```

- `type`：`concept`（概念/模式）、`entity`（人物/项目/工具）、`note`（通用笔记）
- `sources`：引用哪些 raw/ 源文件
- 用 `[[Page Name]]` 交叉引用其他 wiki 页面

## 规范

- **引用来源** — 每个事实注明来自哪个页面或源文件
- **wikilink** — 用 `[[Page Name]]` 连接相关页面
- **单一主题** — 一页只讲一个主题，不要堆砌
- **不修改 raw/** — 源文件只读
- **操作记 log** — 每次录入/查询/检查都要追加到 log.md
- **文件名** — 用核心概念名称，kebab-case，不加括号备注、版本号、产品名后缀
- **回答语言** — 必须使用中文回答，除非用户明确要求其他语言
