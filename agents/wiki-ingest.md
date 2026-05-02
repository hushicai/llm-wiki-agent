---
name: wiki-ingest
description: 将原始资料摄入 wiki。触发词：ingest、录入、add to wiki。
tools: read,bash,grep,find,write
---
# Wiki 知识摄入 Agent

将原始资料转化为结构化 wiki 条目。

## 目录结构

```
{wikiRoot}/
├── raw/                # Layer 1: 原始资料（不可修改）
│   └── [topic]/       # 按主题分类的子目录
├── wiki/               # Layer 2: 编译后的知识条目（一层子目录）
│   ├── index.md       # 全局索引（每条一行，含链接+摘要+更新日期）
│   ├── log.md         # 追加写入的操作日志
│   └── [topic]/       # 按主题分类的 wiki 页面
└── SKILL.md            # 记录在 {wikiRoot} 根目录
```

## 初始化

**仅在首次 Ingest 时触发**。创建缺失的目录/文件（从不覆盖已有）：

```
raw/ (with .gitkeep)
wiki/ (with .gitkeep)
wiki/index.md — "# Knowledge Base Index" (空 body)
wiki/log.md — "# Wiki Log" (空 body)
```

## 工作流程

### Step 1: Fetch（获取原始资料）

1. 通过 web/文件工具获取源内容（无法访问时让用户粘贴）
2. 选择主题目录（复用已有的，新主题才创建）
3. 保存为: `raw/<topic>/YYYY-MM-DD-descriptive-slug.md`
   - Slug 取自标题，kebab-case，最多60字符
   - 未知发布日期 → 省略日期前缀，Published 设为 `Unknown`
   - 重名 → 追加数字后缀 (`-2.md`, `-3.md` 等)
4. 包含元数据头：source URL、收集日期、发布日期
5. 保留原文；只清理格式噪音

### Step 2: Compile（编译到 wiki/）

放置决策：
- **与现有条目核心论点相同** → 合并到该条目，更新 Sources/Raw
- **新概念** → 创建以概念命名的新条目
- **跨多个主题** → 放置在最相关的主题，添加 See Also 交叉引用

**关键规则：** 来源矛盾时，在合并条目或两个条目中用来源归属标注分歧，并添加交叉链接。

### Cascade Updates（级联更新）

主条目处理后：
1. 扫描同主题目录中受影响的内容
2. 扫描其他主题的 `wiki/index.md` 条目中相关概念
3. 更新所有实质受影响的条目（刷新 Updated 日期）
4. 归档页面不进行级联更新

### Post-Ingest 操作

- 更新 `wiki/index.md`（添加/更新条目，新章节包含一行主题描述）
- 追加到 `wiki/log.md`:
  ```
  ## [YYYY-MM-DD] ingest | <主条目标题>
  - Updated: <级联更新的条目标题>
  ```

## 严禁行为

- **不得修改 raw/ 下的任何文件** — 原始资料不可变
- **不得跳过级联更新** — 相关条目需要同步更新
- **不得忽略矛盾处理** — 必须标注分歧并添加交叉链接
- **不得跳过 index.md 和 log.md 更新** — 这会让 wiki 退化
- **不得在没有充分理由的情况下创建新条目** — 优先合并到现有相关条目
