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
- 基于文件哈希生成唯一书籍 ID

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
- 自动记录阅读位置（章节索引）
- 书籍处理状态追踪（待处理/处理中/完成/失败）
- 刷新页面自动恢复上次阅读位置

#### 5. 划线与高亮功能
- 拖拽选择文本高亮（支持多种样式分类）
- 高亮样式：语法点（黄）/生词（绿）/收藏（粉）/默认（蓝）
- 自动保存划线到数据库
- 高亮状态持久化

#### 6. 生词本功能
- 一键添加生词（点击词 → 弹窗 → 加入生词本）
- 生词标记（红色文字 + 下划线）
- 按书存储生词（同一本书的同一原型只记录一次）
- 刷新页面后生词状态持久化
- 生词本统计（总数、按状态分组）

#### 7. 划线与 AI 深度解析
- 点击已高亮文本内部token → 显示"AI 分析(高亮句)"按钮
- LLM 语法解析与翻译
- 积累本：结构化保存 AI 解析结果
- 支持添加个人笔记

#### 8. 生词本增强功能
- Spaced Repetition 算法（Anki 风格）
- 学习状态追踪（新学/学习中/复习/已掌握）
- 生词本列表页面
- 从生词本移除功能

#### 9. TTS 发音
- VoiceVox
- 日语语音合成（词/句级别）
- 支持音调重音（Pitch Accent）
- token/高亮文本可朗读

---

## 技术架构

### 数据流

#### EPUB 处理流程

```
用户上传 EPUB
    ↓
生成书籍 ID (MD5 哈希)
    ↓
提取元数据 (标题、作者)
    ↓
创建 Book 记录 (状态: PENDING)
    ↓
【后台任务】解析 EPUB
    ├─ LightNovelParser 解析 HTML
    ├─ 提取图片 → static_data/books/{id}/images/
    ├─ 按段落切分文本 → TextSegment[]
    └─ SudachiPy 分词 → Token[]
    ↓
存储到数据库 (状态: COMPLETED)
    ↓
前端可访问阅读
```

#### 划线与 AI 解析流程（计划中）

```
用户选中文本 → 划线
    ↓
保存 UserHighlight (Snap-to-Token 定位)
    ↓
【可选】请求 AI 解析
    ↓
保存 ArchiveItem (结构化 JSON)
    ├─ translation: 翻译
    ├─ grammar: 语法点列表
    ├─ nuance: 语感说明
    └─ key_words: 重点词汇
    ↓
展示解析结果 + 可加入生词本/复习队列
```

---

## 数据模型

### 核心实体

#### Book（书籍）
```python
- id: str                    # 唯一标识（文件哈希）
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

#### TokenData（分词单元）
```python
- s: str                     # 表层形（显示文本）
- r: Optional[str]           # 读音（假名）
- b: Optional[str]           # 原型（字典形式）
- p: Optional[str]           # 词性
- gap: Optional[bool]        # 是否为间隔符
- RUBY: Optional[List]       # 振假名分段（如"食べる" → "た/べる"）
- definition: Optional[str]  # 释义（来自词典）
- is_vocabulary: Optional[bool]  # 是否在生词本中（动态添加）
- highlight_id: Optional[int]    # 所属高亮的 ID（动态添加）
- highlight_style: Optional[str] # 高亮样式（动态添加）
```

#### UserProgress（阅读进度）
```python
- book_id: str               # 书籍 ID（唯一）
- current_chapter_index: int # 当前章节索引
- current_segment_index: int # 当前段落索引（预留）
- updated_at: datetime       # 更新时间
```

#### UserHighlight（高亮）
```python
- book_id: str
- chapter_index: int
- segment_index: int         # 段落索引
- start_token_idx: int       # 起始 token
- end_token_idx: int         # 结束 token
- style_category: str        # 样式类别（grammar/vocab/favorite/default）
- selected_text: str         # 选中文本快照
- created_at: datetime
- updated_at: datetime
```

#### ArchiveItem（积累本）
```python
- highlight_id: int          # 关联高亮（可选）
- user_note: Optional[str]   # 用户笔记
- ai_analysis: Text          # AI 解析结果（JSON 或纯文本）
- in_review_queue: bool      # 是否加入复习队列
- created_at: datetime
- updated_at: datetime
```

#### Vocabulary（生词本）
```python
- book_id: str               # 书籍 ID
- word: str                  # 单词
- reading: Optional[str]     # 读音
- base_form: str             # 原型
- part_of_speech: Optional[str]  # 词性
- definition: Optional[str]  # 释义
- status: int                # 复习状态（0:新学 1:学习中 2:复习 3:已掌握）
- next_review_at: Optional[datetime]   # 下次复习时间
- context_sentences: Optional[JSON]  # 例句列表
- created_at: datetime
- updated_at: datetime
- UniqueConstraint: (book_id, base_form)  # 同一书同一原型只记录一次
```

---

## 工作流程

### 典型使用场景

#### 场景 1：上传新书并阅读

```
1. 用户上传 EPUB 文件
2. 后台自动解析、分词
3. 解析完成后，用户打开书籍
4. 逐段阅读：
   - 点击汉字 → 显示假名注音
   - 点击单词 → 显示词典释义弹窗（Glassmorphism Lite 风格）
   - 遇到生词 → 点击"加入生词本"按钮
   - 生词标记为红色文字+下划线
5. 自动保存阅读进度（章节索引）
6. 刷新页面 → 自动恢复到上次阅读位置
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