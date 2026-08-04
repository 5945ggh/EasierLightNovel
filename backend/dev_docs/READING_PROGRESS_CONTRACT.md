# Reading Progress Contract

本文档定义书籍级恢复位置与章节级阅读检查点的语义、持久化边界、同步规则、迁移要求和测试契约。
它是阅读器、书籍主页和后端进度服务之间的实现约束，不是 UI 设计稿。

## Scope

阅读进度分为两层：

1. **书籍级恢复点（resume cursor）**：用户点击“继续阅读”时应恢复的位置。
2. **章节级检查点（chapter checkpoint）**：用户从书籍主页目录进入某一章时，该章应恢复的位置。

两层状态互相相关，但不是同一条记录，也不能互相无条件覆盖。

当前已有的 `UserProgress` 表和 `/api/books/{book_id}/progress` API 必须保持向后兼容。
章节级检查点是增量能力；旧书籍只有书籍级恢复点时仍然可读。

## Terminology

### Book-level resume cursor

书籍级恢复点表示“下一次继续阅读时回到哪里”，不是整本书已经阅读了多少。

它包含：

- `current_chapter_index`：章节索引，兼容现有 API。
- `current_segment_index`：当前章节内的段落索引。
- `progress_percentage`：当前章节内的滚动百分比，范围 `0..100`。
- `updated_at`：服务端最后一次确认保存的时间。

该记录最多一条/本书。它是阅读器默认恢复目标，也是书籍主页“继续阅读”按钮的唯一来源。

### Chapter checkpoint

章节检查点表示“上一次在这个章节留下的阅读位置”。

没有检查点的章节表示尚未留下可恢复位置，而不是一个显式的 `0%` 记录。
未读章节进入阅读器时从顶部开始。

章节检查点至少包含：

- `book_id`：所属书籍。
- `chapter_id`：推荐引用 `chapters.id`，作为稳定的数据库身份。
- `chapter_index`：当前章节索引，作为响应和兼容字段；不能单独作为唯一身份。
- `current_segment_index`：当前章节内的段落索引。
- `progress_percentage`：当前章节内的滚动百分比，范围 `0..100`。
- `state`：`in_progress` 或 `completed`。
- `updated_at`：该章节检查点最后一次保存的时间。

章节检查点必须有唯一约束：

```text
UNIQUE(book_id, chapter_id)
```

如果使用数据库外键，应让删除书籍时级联删除检查点；删除或替换章节时不得留下悬空检查点。

## Invariants

以下规则是实现必须保持的产品契约：

1. 打开书籍主页、读取目录或读取进度不会写入阅读进度。
2. 仅通过 URL 打开某一章节不会自动移动书籍级恢复点。
3. 章节检查点缺失时，指定章节从顶部开始。
4. 章节检查点存在时，指定章节恢复该章节自己的百分比和段落位置。
5. 书籍级恢复点只能在确认发生阅读行为后移动，不能因为误触章节目录而移动。
6. 保存章节检查点不能删除或重置其他章节的检查点。
7. 用户点击“继续阅读”时只读取书籍级恢复点，不根据章节列表中最后一次渲染的章节猜测位置。
8. 进度百分比必须在 API、数据库和前端状态之间保持同一单位：后端为 `0..100`，前端滚动工具内部可使用 `0..1`。
9. 章节索引必须在当前目录中验证；无效或不存在的索引不能写入进度。
10. 章节正文不足以产生滚动距离时，不能仅依赖百分比判断是否完成；应允许通过明确的章节结束行为写入 `completed`。

## Persistence Model

### Existing `user_progress`

保留现有表和字段，继续作为书籍级恢复点：

```text
user_progress
- book_id                     UNIQUE
- current_chapter_index       NOT NULL/兼容现有默认值
- current_segment_index       NOT NULL/兼容现有默认值
- progress_percentage         NOT NULL, 0..100
- updated_at
```

不把章节检查点 JSON 塞入 `user_progress`。现有的 GET/PUT API 仍然代表书籍级恢复点。

### New `chapter_progress`

实现时新增独立表，名称可以保持为 `chapter_progress`，字段语义不得改变：

```text
chapter_progress
- id
- book_id
- chapter_id
- chapter_index
- current_segment_index
- progress_percentage
- state
- updated_at
```

建议增加以下约束：

- `progress_percentage >= 0 AND progress_percentage <= 100`
- `current_segment_index >= 0`
- `state IN ('in_progress', 'completed')`
- `UNIQUE(book_id, chapter_id)`
- `chapter_id` 引用 `chapters.id`

是否增加 `content_fingerprint` 或 `source_content_version_id` 由实现 Agent 根据当前重解析流程决定；如果不增加，必须在文档和代码中明确“章节内容变化时检查点会被清理或失效”。

## Write Semantics

### Read-only navigation

以下操作只改变前端路由或运行时章节，不写入书籍级恢复点：

- 从书籍主页点击某个章节。
- 使用 `/read/{book_id}?chapter={chapter_index}` 打开章节。
- 打开 TOC 并查看章节标题。
- 书籍主页加载目录和进度。

### Confirmed reading

章节首次加载后不能立刻写入检查点。阅读器应在下列行为之一发生后才保存章节检查点：

- 用户滚动导致百分比发生有效变化。
- 当前可见段落索引发生有效变化。
- 用户明确点击上一章或下一章。
- 对不可滚动或极短章节，用户执行明确的“读完/下一章”行为。

保存章节检查点应使用防抖，避免每次滚动事件写入数据库。写入应是幂等 upsert。

### Moving the book-level cursor

当确认发生阅读行为时，服务端应在同一事务中：

1. upsert 当前章节的 `chapter_progress`；
2. 更新 `user_progress` 为当前章节位置。

如果只是加载章节、误触后立即返回，两个步骤都不应发生。

当前 API 的兼容实现可以继续由 `PUT /api/books/{book_id}/progress` 同时更新书籍级恢复点；新增章节检查点接口或服务方法必须明确区分“只保存章节检查点”和“同时移动书籍级恢复点”。

推荐的接口边界是：

```text
GET /api/books/{book_id}/progress
PUT /api/books/{book_id}/progress
GET /api/books/{book_id}/progress/chapters
PUT /api/books/{book_id}/progress/chapters/{chapter_index}
```

其中：

- `GET /progress` 返回现有书籍级恢复点。
- `PUT /progress` 保持现有语义，更新书籍级恢复点，并可在服务层同步写入当前章节检查点。
- `GET /progress/chapters` 返回已存在的章节检查点，不返回正文。
- `PUT /progress/chapters/{chapter_index}` 只更新指定章节检查点；是否移动书籍级恢复点必须由明确的服务调用决定，不能隐式发生。

具体路由命名可以遵循现有项目风格，但不能把两个语义重新混成一个“最后请求覆盖全部状态”的接口。

当前实现的具体语义是：旧格式的 `PUT /progress` 请求仍然只需要原有三个字段；它被视为一次确认阅读事件，在同一事务中更新 `user_progress` 和对应章节的 `chapter_progress`。请求可选地携带 `state`，值为 `in_progress` 或 `completed`，缺省为 `in_progress`。章节专用 PUT 始终只写章节检查点。

## Read Semantics

### Book home

书籍主页加载：

- 书籍详情。
- 章节目录。
- 书籍级恢复点。
- 已存在的章节检查点集合。

书籍主页不得加载章节正文，也不得因为显示目录而创建每章 `0%` 记录。

“继续阅读”使用书籍级恢复点。

章节目录中：

- 有检查点的章节显示该章节进度。
- 无检查点的章节显示未开始或不显示进度。
- 点击章节后，优先恢复该章节检查点；没有则从顶部开始。

### Reader

阅读器初始章节选择优先级应为：

1. 合法的 URL `chapter` 参数；
2. 当前阅读器内明确的章节切换请求；
3. 书籍级恢复点；
4. 目录第一章。

当 URL 明确指定章节时，只能对该章节读取其章节检查点。不能因为书籍级恢复点属于另一章就恢复另一章的滚动百分比。

章节切换到新章节时，上一章的滚动百分比不能泄漏到新章节。

## Local Snapshot Contract

现有 localStorage 快照是一条/本书的结构。章节级进度实现后应升级为版本化结构，例如：

```json
{
  "version": 2,
  "resume": {
    "chapterIndex": 3,
    "segmentIndex": 12,
    "percentage": 0.456,
    "timestamp": 1730000000000
  },
  "chapters": {
    "chapter-id-123": {
      "chapterIndex": 3,
      "segmentIndex": 12,
      "percentage": 0.456,
      "state": "in_progress",
      "timestamp": 1730000000000
    }
  }
}
```

实现要求：

- 读取旧版单条快照时必须兼容，不得丢失已有恢复位置。
- 读取旧版单条快照时升级为 `version: 2`；旧位置同时成为书籍恢复点和其对应章节的本地检查点。
- 同一章节比较本地和服务端时间戳，较新者优先。
- 本地快照写入失败时，服务端仍应尝试保存；服务端失败时保留本地快照作为降级。
- 不能用一个章节的本地快照覆盖其他章节。
- 书籍删除后应清理该书的本地快照，或至少确保不会被另一 ID 复用。

## Progress and Completion Metrics

书籍级恢复点不是“全书阅读完成度”。当前产品可以继续显示一个基于目录位置的估算推进值，但必须标注为估算，且不能把它当作章节检查点的汇总真值。

如果未来增加“阅读覆盖度”，应单独定义：

- 按章节是否存在检查点统计，或
- 按章节 segment/token 数加权统计。

不能简单平均每章百分比，因为章节长度可能差异很大。

`state = completed` 的判定必须有明确来源，例如：

- 用户点击“下一章”时确认当前章节已读完；
- 用户到达章节末尾且内容可滚动；
- 不可滚动章节执行明确的下一章或完成操作。

不要仅因打开章节或请求到章节正文就标记完成。

## Reparse and Identity

`chapter_index` 是阅读排序字段，不是永久身份。章节检查点应优先关联 `Chapter.id`。

如果同一本书未来重新解析、删除并重建章节，必须在服务层处理旧检查点：

- 能证明章节身份和内容仍然匹配时才保留。
- 章节边界、正文或索引变化且无法匹配时清理或标记失效。
- 不能静默将旧索引套到新章节。

如果当前导入流程始终创建新的 `book_id`，旧书检查点可以随书籍级联删除；实现 Agent 仍需添加测试，确保书籍删除不会留下检查点。

## Migration

迁移必须是 SQLite 可执行的增量迁移，遵循 `backend/app/database.py` 现有的 additive migration 机制。

要求：

1. 新数据库由 `Base.metadata.create_all` 创建完整表结构。
2. 旧数据库通过 `CREATE TABLE IF NOT EXISTS chapter_progress` 增量升级。
3. 迁移可重复执行，不删除或重写现有 `user_progress`。
4. 现有书籍的书籍级恢复点继续有效。
5. 不为所有历史章节批量生成 `0%` 检查点。
6. 对旧版本仅有 `user_progress` 的书籍，迁移应将有实际阅读痕迹的当前章节恢复点幂等回填为一个章节检查点；没有实际阅读痕迹的 `0%` 恢复点不得生成检查点。
7. 删除书籍时检查点随外键或服务层级联清理。
8. 迁移测试覆盖旧 schema、重复迁移、唯一约束、删除级联以及旧书籍恢复点回填。

## Compatibility

以下行为必须保持：

- 现有 `GET /api/books/{book_id}/progress` 响应字段不删除、不改单位。
- 现有 `PUT /api/books/{book_id}/progress` 请求仍可用。
- 没有章节检查点的书籍仍能进入阅读器并恢复书籍级位置。
- 现有 localStorage 单条快照仍可恢复。
- 学习地图读取书籍级阅读章节锚点的行为不被章节检查点表的空记录改变。
- 高亮、查词、生词、AI 分析和阅读器主题不依赖章节检查点接口。

## Required Tests

### Backend

- 新数据库创建 `chapter_progress` 表。
- 旧数据库增量迁移后可读写检查点。
- 重复迁移不报错、不丢数据。
- 同一 `book_id + chapter_id` upsert 不产生重复行。
- 百分比、段落索引和 state 约束生效。
- 章节检查点读取按章节顺序返回。
- 删除书籍会删除检查点。
- 书籍级进度 API 的旧响应和请求保持兼容。
- 只写章节检查点不会移动书籍级恢复点。
- 确认阅读的事务同时更新章节检查点和书籍级恢复点。

### Frontend

- 旧版单条 localStorage 快照可迁移。
- 多章节快照可独立读写。
- 章节无检查点时从顶部开始。
- 章节有检查点时恢复本章位置，而不是书籍级另一章的位置。
- 点击目录章节后，误触返回不会覆盖书籍级恢复点。
- 合法 `chapter` query 只允许当前目录存在的非负整数。
- 章节切换时不会沿用上一章百分比。
- 书籍主页能区分“继续阅读位置”和章节列表中的各章检查点。
- 桌面端、移动端和长目录布局无明显溢出。

## Non-goals

本契约不包含：

- 多用户或云端同步。
- 阅读时间统计、连续阅读天数或社交排行榜。
- 页面级精确像素锚点。
- 内容重排后的自动语义段落匹配。
- 自动推断用户是否真正理解章节。
- 用查词、生词或高亮行为替代阅读进度。
