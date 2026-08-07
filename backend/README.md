# Lightnovel2Textbook - 日语轻小说阅读器

> 一个 LLM-empowered 的本地化日语学习平台，帮助低基础学习者阅读原版轻小说

## 目录

- [项目概述](#项目概述)
- [核心功能](#核心功能)
- [技术架构](#技术架构)
- [数据模型](#数据模型)
- [工作流程](#工作流程)
- [技术栈](#技术栈)

---

## 项目概述

**:Lightnovel2Textbook** 是一个基于 **FastAPI + 现代前端框架** 的 Web 应用，旨在帮助日语学习者（特别是初学者）阅读原版日语轻小说。

### 设计理念

- **混合架构**：传统 NLP（分词、注音）+ 大模型（深度解析）
- **渐进式学习**：从基础注音到 AI 语法分析，适应不同水平
- **本地化部署**：数据隐私可控，适合个人使用
- **沉浸式阅读**：保留原书排版，支持插图混排

### 目标用户

- 想要阅读原版轻小说但词汇量不足的爱好者
- 需要辅助工具积累地道表达的日语学习者
...

---

## 核心功能

#### 1. EPUB 解析与处理
- 支持上传 EPUB 格式轻小说
- 自动提取插图并保持排版
- 按段落智能切分文本
- 基于 UUID 生成唯一书籍 ID

#### 2. 日语分词与注音
- 使用 SudachiPy 进行高质量分词
- 汉字自动注音（振假名）
- 保留词性、原型等语言学信息
- 按段落切分，保留阅读节奏

#### 3. 词典集成
- 集成 Jamdict 日语词典
- 支持缓存提升查询性能
- 提供单词释义、词性、读音

#### 4. 阅读进度管理
- 自动记录书籍级恢复位置（章节索引、章节内段落索引和章节内滚动百分比）
- 书架进入书籍主页后可查看目录和最近阅读位置；进入阅读器后按需加载章节正文
- 书籍处理状态追踪（待处理/处理中/完成/失败）
- 刷新页面自动恢复上次阅读位置

#### 5. 划线与高亮功能
- 拖拽选择文本高亮（支持多种样式分类）
- 高亮样式：语法点（黄）/生词（绿）/收藏（粉）/默认（蓝）
- 自动保存划线到数据库
- 高亮状态持久化

#### 6. 词汇收藏
- 一键保存词汇（点击词 → 弹窗 → 加入词汇收藏）
- 词汇标记（红色文字 + 下划线）
- 按书存储词汇（同一本书的同一原型只记录一次）
- 刷新页面后词汇收藏状态持久化
- 跨书资料库查看词形、读音、已有释义、来源书籍和现有上下文信息

#### 7. 摘录与 AI 解析
- 点击已高亮文本内部 token → 显示“AI 解析”按钮
- LLM 语法解析与翻译
- 摘录资料：保存并展示与高亮关联的 AI 解析结果
- 当前不提供个人笔记编辑；已有 `user_note` 数据仅按兼容需要展示

#### 8. 后续能力（尚未实现）
- Spaced Repetition / SRS 和到期复习调度
- 词汇掌握状态的用户复习工作流
- 从词汇收藏或摘录批量导出 Anki 卡片（语境卡片的显式 Anki 写入已单独实现）

#### 9. TTS 发音
- VoiceVox
- 日语语音合成（词/句级别）
- 支持音调重音（Pitch Accent）
- token/高亮文本可朗读

---

## 产品边界：词汇与摘录

当前 `/study` 路由的用户可见名称是“词汇与摘录”。它是跨书保存和回看阅读素材的资料库，分为“词汇收藏”和“摘录与解析”两个内容域，不是学习中心或复习中心。

- 词汇收藏保存用户在阅读中主动加入的词形、读音、已有释义、来源书籍和现有上下文信息。收藏不等于长期学习决定，也不等于掌握。
- 摘录与解析保存用户高亮的原文及关联的 AI 解析。AI 解析当前是保存/展示的阅读辅助内容；个人笔记编辑尚未完成。
- `Vocabulary.status`、`next_review_at` 和 `ArchiveItem.in_review_queue` 是历史/预留字段，当前不实现 SRS、复习队列或到期复习，也不因字段存在而改变页面口径。
- 书籍学习地图继续负责单本书的词汇阅读负担、章节路线和阅读决策，不迁移到 `/study`。
- AnkiConnect 的个人词汇基线导入仅在用户显式请求时通过 AnkiConnect v6 的 `deckNames`、`modelNames`、`findCards`、`cardsInfo`、`cardsToNotes`、`notesInfo`（以及模板读取）读取外部数据；它只把可撤销的基线证据写入本地数据库，不会写回 Anki。导入先按 card 聚合到 note，再匹配唯一 canonical Lexeme；只有 interval >= 21 天且未被 Suspended 覆盖的 Mature 证据进入 `known`，New/Learning/Relearning/Young 默认进入 `learning`，Buried 保留标志但不覆盖底层成熟度。批次和 card 证据可撤销，手动状态优先。

语境卡片是不同的显式写入路径：`POST /api/context-cards/{draft_id}/anki` 在用户点击写入后调用 AnkiConnect `addNote`，仅写入当前已生成的文本卡片；`ContextCardAnkiLedger` 保存稳定 GUID、字段快照和重试状态，重复操作不会静默创建重复笔记。该路径不改变基线导入的只读外部边界。本应用仍不提供词汇收藏/摘录的批量 Anki 导出；批量导出需要另行定义稳定 GUID、例句/i+1、媒体和导出记录。

后续阶段的个人笔记归属、编辑/历史/导出语义，`ai_analysis` 的结构化 schema 与兼容迁移，以及 Anki 基线导入和本应用制卡/导出的边界，记录在 [`dev_docs/STUDY_MATERIALS_BOUNDARY.md`](dev_docs/STUDY_MATERIALS_BOUNDARY.md)。

---

## 技术架构

### 数据流

#### EPUB 处理流程

```
用户上传 EPUB
    ↓
生成书籍 ID (UUID)
    ↓
提取元数据 (标题、作者)
    ↓
创建 Book 记录 (状态: PENDING)
    ↓
【后台任务】解析 EPUB
    ├─ 保存私有原始副本 → static_data/sources/{id}/（不通过静态 URL 暴露）
    ├─ LightNovelParser 解析 HTML
    ├─ 提取图片 → static_data/books/{id}/images/
    ├─ 保存可重建的 source content version、作者 ruby 提示及 source-to-reader 投影
    ├─ 按段落切分文本 → TextSegment[]
    └─ SudachiPy 分词 → Token[]
    ↓
存储到数据库 (状态: COMPLETED)
    ↓
【派生分析】从 SourceContentVersion 构建 AnalysisRun
    ├─ 以受 Sudachi 输入长度保护的分块重建词元
    ├─ 记录 Lexeme、RunLexeme、LexemeOccurrence 与 ChapterLexemeStat
    └─ 仅在成功后发布为 active run；失败不影响已完成导入
    ↓
前端可访问阅读与书籍学习地图
```

`SourceContentVersion` 是私有的重建契约，不会扩展章节阅读 API 或 `Chapter.content_json`。它保存 source document 的 Unicode 字符 offset、ruby hint，以及该 document 到最终合并后 reader chapter/segment 的投影。source document 与 reader 文本使用同一规范化发射规则（移除 `U+200B`、将三个以上连续换行压缩为两个），并在每一个 reader flush 点独立发射；图片处会插入显式、不可投影的结构边界，避免把边界两侧的换行送入同一次压缩。parser 在该规则生效时显式重映射 ruby offset，绝不在投影阶段临时替换文本，从而避免重建时跨图片拼接出新词元。

删除书籍时，私有原始文件会先原子移动到 `static_data/sources/.cleanup/`，数据库提交后再删除。若文件系统暂时拒绝删除，后端启动时会重试该目录，避免无归属的原始文件永久遗留。

#### 划线与 AI 解析流程（当前流程）

```
用户选中文本 → 划线
    ↓
保存 UserHighlight (Snap-to-Token 定位)
    ↓
【可选】请求 AI 解析
    ↓
保存 ArchiveItem（保存文本/JSON 兼容的 AI 解析内容）
    ├─ translation: 翻译
    ├─ grammar: 语法点列表
    ├─ nuance: 语感说明
    └─ key_words: 重点词汇
    ↓
展示并保存 AI 解析，供“词汇与摘录”资料库回看
```

---

## 数据模型

### 核心实体

#### Book（书籍）
```python
- id: str                    # UUID 唯一标识
- title: str                 # 标题
- author: Optional[str]      # 作者
- cover_url: Optional[str]   # 封面图片
- status: ProcessingStatus   # 处理状态
- total_chapters: int        # 章节总数
- created_at: datetime       # 创建时间
```

#### Chapter（章节）
```python
- id: int
- book_id: str
- index: int                 # 章节顺序
- title: str
- content_json: JSON         # List[ContentSegment]
  ├─ TextSegment: { type: "text", tokens: TokenData[] }
  └─ ImageSegment: { type: "image", src: str, alt: str }
```

#### 派生分析实体（AnalysisRun / Lexeme）

`AnalysisRun`、`Lexeme`、`RunLexeme`、`LexemeOccurrence` 和
`ChapterLexemeStat` 组成可丢弃、可重建的分析层。每个 run 明确关联一个
`SourceContentVersion`，并记录 tokenizer、词典、切分模式、过滤条件与 source hash。
只有完成的 active run 才会驱动书籍学习地图；失败的 run 保留错误信息，但不会让已可读的书籍
回退为导入失败。

`UserLexemeKnowledge` 是与上述派生层分离的单用户 canonical Lexeme 状态层：
`known`、`learning`、`ignored` 和无记录（未声明）是学习地图的状态语义，其中只有有效
`known` 会进入明确掌握覆盖率。它不能因分析 run 重建而丢失。`ExternalKnowledgeImport` 和
`ExternalKnowledgeImportItem` 保存 AnkiConnect/JLPT 外部已知集的可撤销证据；手动状态优先于
外部证据，外部证据优先于旧 `Vocabulary.status == 3` 的兼容迁移。`Vocabulary.status`、
`next_review_at` 等字段属于历史/预留兼容字段；当前词汇收藏不会把它们呈现为掌握状态、
复习队列或到期时间，也不把它们作为学习地图的主真值来源。

详细的 source coordinate、身份和 API 契约见
[`dev_docs/SOURCE_CONTENT_CONTRACT.md`](dev_docs/SOURCE_CONTENT_CONTRACT.md) 与
[`dev_docs/LEARNING_MAP_CONTRACT.md`](dev_docs/LEARNING_MAP_CONTRACT.md)。后者同时是词汇基线、
推荐集合与外部已知集导入语义的权威说明。

#### ReaderLookupEvent（Reader 主动查词事实）

Reader 点击 token 并打开词典的行为通过
`POST /api/books/{book_id}/reader/lookup-events` 单独写入
`ReaderLookupEvent`。事件是不可变的用户行为历史，不是词汇状态；它保留
书籍/章节、当时的 `analysis_run_id`（若存在）、Reader segment/token 坐标、
查询文本、客户端幂等 ID 和时间，并在能够由一致坐标唯一证明时保存
Lexeme/RunLexeme 与 source offset。无法无歧义映射是合法的 unresolved 数据，
不得通过猜测补齐。相同客户端事件 ID 的重试只返回原事件，用户再次点击则
使用新的事件 ID。

`GET /api/dictionary/search` 仍是纯查询。Study、Vocabulary hydration、后台
字典请求以及 `TokenPopover`/`ReaderSidebar` 的展示查询不会写入事件；Reader
的 token click handler 是唯一的事件所有者。Learning Map 只在查询期将事件和
后续 occurrence 汇总为事实型 `lookup_observation`，并沿
`Lexeme.merged_into_id` 解析当前 canonical Lexeme，不改写历史事件。
这类观察不增加唯一的 `explicit-known coverage`，不创建
`acquired_in_context`，也不修改 `UserLexemeKnowledge`。
汇总只接受事件当时的 `AnalysisRun.source_content_version_id` 与当前 active
run 相同的记录；旧 source version 的事件仍保留为历史事实，但不混入当前
Learning Map 的坐标观察。同一 source version 的重新分析可以继续使用兼容
历史。旧分析结果若没有 `reader_token_index`，仍可阅读，但当前 Reader 只
提交 Reader 坐标，相关查词通常会保留为 unresolved；重新分析后才能稳定
获得词元级查词观察。

#### TokenData（分词单元）
```python
- s: str                     # 表层形（显示文本）
- r: Optional[str]           # 读音（假名）
- b: Optional[str]           # 原型（字典形式）
- p: Optional[str]           # 词性
- gap: Optional[bool]        # 是否为间隔符
- RUBY: Optional[List]       # 振假名分段（如"食べる" → "た/べる"）
- definition: Optional[str]  # 释义（来自词典）
- is_vocabulary: Optional[bool]  # 是否在词汇收藏中（动态添加）
- highlight_id: Optional[int]    # 所属高亮的 ID（动态添加）
- highlight_style: Optional[str] # 高亮样式（动态添加）
```

#### UserProgress（阅读进度）
```python
- book_id: str               # 书籍 ID（唯一）
- current_chapter_index: int # 当前章节索引
- current_segment_index: int # 当前章节内的段落索引
- progress_percentage: float # 当前章节内的滚动百分比（0-100）
- updated_at: datetime       # 更新时间
```

`UserProgress` 是书籍级的“继续阅读”恢复点，不是每个章节的进度表。书籍主页使用它展示最近阅读位置和估算的书籍推进位置；章节目录跳转使用 `chapter` query 参数进入阅读器。`ChapterProgress` 单独保存已经确认阅读过的章节检查点；不会因为加载目录而预先创建 `0%` 记录，也不会因为仅打开章节而移动 `UserProgress`。

章节检查点通过 `GET /api/books/{book_id}/progress/chapters` 读取，通过 `PUT /api/books/{book_id}/progress/chapters/{chapter_index}` 独立写入。兼容的 `PUT /api/books/{book_id}/progress` 仍表示一次确认阅读事件，并在同一事务中更新书籍级恢复点和当前章节检查点。

升级旧数据库时，如果旧版本的 `user_progress` 已保存了非零的章节位置，迁移会幂等地将该当前章节恢复点补入 `chapter_progress`，因此书籍主页目录能够显示对应章节的进度；没有实际阅读痕迹的 `0%` 记录不会被批量生成检查点。

#### UserHighlight（高亮）
```python
- book_id: str
- chapter_index: int
- segment_index: int         # 段落索引
- start_token_idx: int       # 起始 token
- end_token_idx: int         # 结束 token
- style_category: str        # 样式类别（default/vocab/grammar/favorite）
- selected_text: str         # 选中文本快照
- created_at: datetime
- updated_at: datetime
```

#### ArchiveItem（摘录资料）
```python
- highlight_id: int          # 关联高亮（可选）
- user_note: Optional[str]   # 兼容字段；当前不提供个人笔记编辑
- ai_analysis: Text          # 已保存的 AI 解析（JSON 或纯文本）
- in_review_queue: bool      # 历史/预留字段，不表示当前有可用复习队列
- created_at: datetime
- updated_at: datetime
```

#### Vocabulary（词汇收藏）
```python
- book_id: str               # 书籍 ID
- word: str                  # 单词
- reading: Optional[str]     # 读音
- base_form: str             # 原型
- part_of_speech: Optional[str]  # 词性
- definition: Optional[str]  # 释义
- status: int                # 历史/预留状态字段，不表示当前复习能力
- next_review_at: Optional[datetime]   # 历史/预留时间字段，不用于当前到期复习
- context_sentences: Optional[JSON]  # 例句列表
- created_at: datetime
- updated_at: datetime
- UniqueConstraint: (book_id, base_form)  # 同一书同一原型只记录一次
```

未来批量 Anki 导出必须由只增的 `AnkiExportLedger` 持有稳定 GUID，不能直接由
数据库自增 `lexeme_id` 派生。本阶段不实现 Sentence、i+1、例句缓存、批量
Anki 导出、TTS 或媒体文件导出；语境卡片的用户显式 Anki 写入是独立的文本卡片路径，也不引入新的覆盖率定义。

---

## 工作流程

### 典型使用场景

#### 场景 1：上传新书并阅读

```
1. 用户上传 EPUB 文件
2. 后台自动解析、分词
3. 解析完成后，用户从书架进入书籍主页
4. 用户从书籍主页点击“继续阅读”或选择章节后进入阅读器
5. 逐段阅读：
   - 点击汉字 → 显示假名注音
   - 点击单词 → 显示词典释义弹窗（Glassmorphism Lite 风格）
   - 遇到需要保存的词 → 点击“加入词汇收藏”按钮
   - 已收藏词汇标记为红色文字+下划线
6. 自动保存书籍级阅读位置（章节索引、段落索引和章节内百分比）
7. 刷新页面或点击“继续阅读” → 自动恢复到最近保存的位置
```

#### 场景 2：高亮重要句子

```
1. 用户遇到想要标记的长句
2. 按住鼠标左键 → 拖动选择文本 → 松开鼠标
3. 弹出样式选择器（Glassmorphism Lite 风格）：
   - 语法点（黄色）
   - 生词句（绿色）
   - 收藏（粉色）
   - 默认（蓝色）
4. 选择样式后自动保存
5. 文本背景显示对应颜色
6. 刷新页面 → 高亮状态持久化
```

---

## 技术栈

### 后端

| 组件 | 技术 | 说明 |
|------|------|------|
| **框架** | FastAPI |  |
| **数据库** | SQLite + SQLAlchemy |  |
| **EPUB 解析** | ebooklib + BeautifulSoup4 | 解析 EPUB 结构和 HTML 内容 |
| **分词** | SudachiPy | 高质量日语分词器，支持多种分词模式 |
| **词典** | Jamdict | 日语词典库，基于 JMDict |
| **数据验证** | Pydantic | 请求/响应模型验证 |

### 前端

| 组件 | 技术 | 版本 | 说明 |
|------|------|------|------|
| **框架** | React | 19.2.0 | 现代化 React 框架，支持 Compiler |
| **语言** | TypeScript | 5.9.3 | 类型安全，提升开发效率 |
| **构建工具** | Vite | 7.2.4 | 快速的开发服务器和构建工具 |
| **编译器** | SWC | - | 通过 @vitejs/plugin-react-swc，比 Babel 快 20-70x |
| **路由** | React Router DOM | 7.12.0 | 单页应用路由管理 |
| **CSS 框架** | Tailwind CSS | 4.1.18 | 原子化 CSS，快速构建 UI |
| **图标** | Lucide React | 0.562.0 | 轻量级图标库 |
| **浮层定位** | @floating-ui/react | latest | 智能定位弹窗和高亮选择器 |
| **HTTP 客户端** | Axios | 1.13.2 | RESTful API 请求 |
| **工具库** | clsx + tailwind-merge | - | 条件类名和样式合并 |
| **代码质量** | ESLint + TypeScript ESLint | - | 代码检查和规范 |
