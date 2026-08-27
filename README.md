# EasierLightNovel

[English](README.en-US.md) | 简体中文

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-19+-cyan.svg)](https://react.dev/)

---

## 项目简介

**EasierLightNovel** 是一个本地化部署的日语学习阅读器，为想阅读原版轻小说而受日语基础限制的用户设计。

### 核心特性

| 功能 | 描述 |
|------|------|
| **EPUB/PDF 解析** | 支持上传 EPUB/PDF 文件，自动提取插图并保持原书排版. 目前对PDF的处理效果不佳, 正在优化中 |
| **智能分词** + **离线即时词典** | 基于 SudachiPy 的日语分词，自动生成注音; 集成 Jamdict 日语词典，点击单词即可查看释义 |
| **词汇收藏** + **摘录与解析** | 保存阅读中主动加入的词汇、原文摘录和关联的 AI 解析资料，支持按书查看；当前不提供间隔重复复习 |
| **AI 解析** | 可选调用 LLM 生成语法、翻译、语感等阅读辅助内容，并保存到摘录资料 |
| **阅读进度** | 自动保存阅读位置，随时恢复 |
| **书籍学习地图** | 基于整本书的分析结果查看章节词汇负担、书内高频覆盖曲线，以及可选的明确掌握覆盖率 |
| **TTS 发音** | 可使用浏览器内置引擎进行日语朗读 |

### 设计理念

- **混合架构**：传统 NLP（分词、注音）+ 大模型（深度解析）
- **渐进式学习**：从基础注音到 AI 语法分析，适应不同水平
- **本地化部署**：数据隐私可控，适合个人使用
- **沉浸式阅读**：保留原书排版，支持插图混排

---

## 快速开始

> **提示**：如果仓库已发布打包版本，Windows 用户可从 Release 页面下载后直接使用，更快捷轻量。

### 环境要求

- **Python**: 3.11+
- **Node.js**: 20.19+ or 22.12+（Vite 7 要求）
- **操作系统**: Windows / macOS / Linux

### 一、安装依赖

```bash
# 后端依赖（推荐使用 uv）
cd backend
pip install uv
uv sync
cd ..

# 前端依赖
cd web
npm install
cd ..
```

### 二、配置文件

在仓库根目录复制配置模板并修改：

```bash
# Windows
copy config\user.json.example config\user.json

# macOS / Linux / Git Bash
cp config/user.json.example config/user.json
```

### 三、启动服务

**方式一：开发模式（推荐新手）**

```bash
# 终端 1 - 启动后端
cd backend
uv run python main.py

# 终端 2 - 启动前端
cd web
npm run dev
```

访问 http://localhost:5173

**方式二：生产模式**

```bash
# 构建前端
cd web
npm run build

# 启动后端（会自动托管前端静态文件）
cd ../backend
uv run python main.py
```

访问 http://localhost:8010


---

## 项目结构

```
EasierLightNovel/
├── backend/              # FastAPI 后端
│   ├── app/
│   │   ├── routers/      # API 路由
│   │   ├── services/     # 业务逻辑
│   │   ├── models.py     # 数据模型
│   │   └── schemas.py    # Pydantic 模型
│   ├── main.py           # 应用入口
│   └── pyproject.toml    # Python 依赖
├── web/                  # React 前端
│   ├── src/
│   │   ├── components/   # 组件
│   │   ├── pages/        # 页面
│   │   ├── stores/       # 状态管理
│   │   └── services/     # API 服务
│   └── package.json      # Node 依赖
├── config/               # 配置文件
│   ├── schema.json       # 配置 schema
│   └── user.json.example # 配置模板
└── static_data/          # 运行时生成（数据库、阅读图片、私有原始书籍副本）
```

---

## 使用指南

### 1. 上传书籍

点击首页的「导入书籍」按钮，选择 EPUB 或 PDF 文件。系统会自动解析并分词。

> **注意**：PDF 解析需要配置 MinerU API Token（见下方配置说明）。
>
> 新导入的书籍会保留一份仅本地可访问的原始 EPUB/PDF 副本，用于未来重建解析数据；这不会改变阅读器中的章节内容或阅读方式。

### 2. 阅读与学习

#### 2.0 书籍主页 / 阅读工作台

在书架中点击一本已经解析完成的书籍，会先进入该书的书籍主页，而不是直接打开正文。书籍主页集中展示书籍信息、章节目录和阅读进度，并提供以下入口：

- **继续阅读 / 开始阅读**：回到全书最近一次保存的阅读位置；尚未开始的书籍从第一章开始。
- **章节目录**：查看全部章节。点击章节会打开指定章节；如果该章节没有独立的检查点，则从章节顶部开始。
- **书籍学习地图**：查看本书的章节词汇负担、书内高频覆盖曲线，以及可选的个人覆盖率。
- **词汇与摘录**：跨书查看阅读中收藏的词汇、原文摘录和 AI 解析结果。

书籍主页只读取章节目录和阅读进度，不提前加载章节正文。正文、词典、生词和高亮数据在进入阅读器后按阅读需要加载。

- 当前书籍级阅读进度表示“继续阅读”应恢复的最近位置，包括章节索引、段落索引和当前章节内的滚动百分比。
- 书籍主页本身不会因为加载目录而写入进度；从目录进入阅读器后，只有确认发生滚动、段落位置变化或明确章节导航时才会保存进度。
- 每个章节还维护独立的阅读检查点。目录进入已有检查点的章节时恢复该章位置；没有检查点的章节从顶部开始。打开章节本身不会移动书籍级“继续阅读”位置。

- **点击汉字**：显示振假名注音
- **点击单词**：弹出词典释义窗口
- **收藏词汇**：在词典窗口点击「加入词汇收藏」
- **划线高亮**：拖拽选择文本，选择高亮样式
- **AI 解析**：点击已高亮区域，请求并保存阅读辅助解析

### 2.1 书籍学习地图

从书籍主页、书架中某本书的更多菜单，或阅读器中的「书籍学习地图」入口打开。学习地图是单本书的“词汇阅读准备度与章节路线视图”，展示可选的明确掌握覆盖率、带有未明确掌握出现率与首次出现词元提示的章节路线，以及书内高频词元的覆盖收益曲线。

- 新导入、且拥有可重建源材料的书籍会在导入后自动建立分析结果。
- 旧书没有 active analysis run 时会显示“需要重新分析”，不会从旧章节 JSON 临时计算数据。
- 尚未建立个人词汇基线时，覆盖率会显示为未建立，而不是误导性的 `0%`。
- “未明确掌握”表示当前没有明确掌握证据，不等同于系统认定用户“不认识”。
- 学习地图不提供单词标注、复习或 Anki 操作；个人词汇导入与语境卡片属于独立能力。
- Reader 中主动点击 token 查看词典会记录不可变的查词事实，供后续的阅读资料与个人词汇能力使用；它不改变掌握状态，也不进入当前学习地图的覆盖率计算。

### 2.2 移动端使用说明

本项目已适配移动端浏览器，支持手机和平板设备阅读。

**移动端交互差异：**

| 功能 | 桌面端 | 移动端 |
|------|--------|--------|
| 导航栏 | 左侧固定栏 | 底部 Tab 栏 |
| 侧边栏 | 右侧滑出面板（320px） | 底部抽屉（可拖拽调整高度） |
| 返回/设置 | 左侧导航栏 | 顶部导航栏 |

**底部抽屉操作：**

- 点击底部 Tab 栏图标打开对应功能的抽屉面板
- 抽屉打开后，底部 Tab 栏自动隐藏，Tab 切换按钮整合在抽屉顶部
- 拖拽抽屉顶部的横条可调整高度（30%-90vh）
- 点击抽屉顶部的关闭按钮（×）或切换到其他功能关闭抽屉

**文本高亮（移动端特殊交互）：**

在移动设备上选择文本后，会显示系统原生的复制/分享菜单。若要添加高亮标记，请**再次点击已选中的文本**，即可唤起高亮菜单。

首次在移动端访问时会显示引导说明，可随时跳过。

### 3. 词汇与摘录

「词汇与摘录」是跨书保存和回看阅读素材的资料库，不是学习中心或复习中心：

- **词汇收藏**：保存用户在阅读中主动加入的词形、读音、已有释义、来源书籍和现有上下文信息。收藏不表示用户已经决定长期学习，也不表示已经掌握。
- **摘录与解析**：保存用户高亮的原文，以及与其关联的 AI 解析；这些内容是阅读资料，不是复习队列。个人笔记编辑尚未完成，当前不提供笔记编辑入口。

当前未实现间隔重复、到期复习或 SRS。书籍学习地图继续负责单本书的词汇阅读负担、章节路线和阅读决策，不是「词汇与摘录」的子模块。

AnkiConnect 的个人词汇基线导入是用户显式请求的外部读取操作（使用 AnkiConnect v6 的 `deckNames`、`modelNames`、`findCards`、`cardsInfo`、`cardsToNotes`、`notesInfo` 及模板读取），导入只把可撤销的证据写入本地数据库，不会写回 Anki。语境卡片则是独立的用户显式操作：在摘录解析完成后，`写入 Anki` 会通过 `addNote` 创建或复用对应的 Anki 笔记，并由本地 ledger 保证重试幂等。本应用仍不提供批量 Anki 导出；稳定 GUID、例句/i+1、媒体和导出记录等批量导出方案需要另行定义。导入按 card 聚合到 note 后匹配唯一 canonical Lexeme；Mature 才能进入 `known`，New/Learning/Relearning/Young 默认进入 `learning`，Suspended 单独保留，Buried 不覆盖底层成熟度。

### 4. 系统设置

在书架页面点击「系统设置」可以：
- 通过 Web UI 修改所有配置项
- 配置分词模式、EPUB 解析选项、词典设置
- 配置 LLM 和 MinerU API
- 修改后需要重启后端才能生效（会有弹窗提示）

---

## API 文档

启动后端后访问 http://localhost:8010/docs 查看 Swagger API 文档。

---

## 技术栈

### 后端

| 组件 | 技术 |
|------|------|
| 框架 | FastAPI |
| 数据库 | SQLite + SQLAlchemy |
| EPUB 解析 | ebooklib + BeautifulSoup4 |
| PDF 解析 | MinerU API + MarkdownParser |
| 分词 | SudachiPy |
| 词典 | Jamdict |
| LLM 集成 | litellm |

### 前端

| 组件 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript |
| 构建 | Vite |
| 路由 | React Router DOM |
| 样式 | Tailwind CSS |
| 状态 | Zustand |
| 请求 | Axios + React Query |

---

## 配置说明

### PDF 解析配置（使用 PDF 功能时必需）

PDF 解析使用 MinerU 云端 API，需要配置 API Token：

```json
{
  "pdf": {
    "mineru_api_token": "your-mineru-token",
    "mineru_model_version": "vlm",
    "mineru_language": "japan"
  }
}
```

获取 Token 请访问 [MinerU 官网](https://mineru.net/) 注册账号。

### LLM 配置（可选）

AI 解析功能需要配置 LLM，支持通过 litellm 接入多种模型：

```json
{
  "llm": {
    "model": "openai/gpt-4o-mini",
    "api_key": "your-api-key",
    "base_url": "https://api.example.com"
  }
}
```

不配置 LLM 不影响基础阅读和词典功能。

### 其他配置

项目包含完整的**系统设置页面**，可在 Web UI 中直接修改所有配置。

配置文件 `config/user.json` 支持：
- 分词模式（A/B/C 粒度）
- 词典语言偏好
- 端口和路径配置
- 上传文件大小限制
- EPUB 章节合并策略

详见 `config/schema.json` 查看所有可用配置项。

---

## 常见问题

**Q: AI 解析报错怎么办？**

A: 检查 API 配置是否正确，确保 `api_key` 和 `base_url` 匹配；模型名称请参考 [litellm 文档](https://docs.litellm.ai/docs/providers)，确保按照 `provider/model_name` 的格式填入。

**Q: 支持其他格式的电子书吗？**

A: 目前支持 EPUB 和 PDF 格式。EPUB 本地解析，PDF 通过 MinerU API 解析。

**Q: PDF 解析失败怎么办？**

A: 确保已配置 MinerU API Token。如果遇到网络错误，尝试关闭代理或检查网络连接。

**Q: 数据存储在哪里？**

A: 书籍数据库、阅读进度、词汇、摘录、提取图片和私有原始 EPUB/PDF 副本都存储在本地 `static_data/` 目录；原始副本位于 `static_data/sources/`，不会通过静态 URL 暴露。请注意，使用 PDF 导入时会将 PDF 上传到 MinerU 云端 API；使用 AI 解析时会将所选文本发送到你配置的 LLM 提供商。

**Q: 更新应用后，之前导入的书需要重新开始阅读吗？**

A: 不需要。既有书籍的章节、阅读进度、高亮和生词记录会继续可用。早期版本没有保留原始 EPUB/PDF，因此旧书不会自动补齐可重建的源材料；这只会影响未来依赖源材料的重建分析能力，不影响当前阅读。新导入的书籍会自动保留私有原始副本。请不要为了升级这一能力而删除并重新导入旧书，否则现有学习记录不会自动迁移。

**Q: 为什么书籍学习地图显示“需要重新分析”？**

A: 学习地图只读取完成且 active 的分析结果，避免将新旧分词口径混在一起。早期导入且没有可重建源材料的书籍会保持可读，但无法自动生成学习地图；新导入的书籍会在导入后自动分析。

---

## 路线图

- [ ] 支持更多电子书格式（TXT、MOBI）
- [x] 从摘录与解析显式写入语境 Anki 卡片
- [ ] 从词汇收藏或摘录批量创建/导出 Anki 卡片
- [x] 书籍学习地图（明确掌握覆盖率、章节难度与书内频率曲线）
- [x] 章节级阅读检查点（阅读覆盖度统计仍待定义）
- [ ] 更广泛的阅读统计可视化

批量 Anki 导出仍未实现。未来稳定 GUID 必须由只增的 `AnkiExportLedger` 持有，不能直接由数据库自增 `lexeme_id` 派生；Sentence、i+1、例句缓存和媒体导出也继续延期。

### 欢迎提交代码!

---

## 许可证

[MIT License](LICENSE)

---

## 致谢

- [SudachiPy](https://github.com/WorksApplications/SudachiPy) - 日语分词
- [Jamdict](https://github.com/neocl/jamdict) - 日语词典
- [FastAPI](https://fastapi.tiangolo.com/) - 后端框架
- [React](https://react.dev/) - 前端框架
- 薛老师 - 动力来源

## 其他可能有用的项目
- [Jamdict中文翻译版本](https://github.com/5945ggh/jamdict-cn) - 可用以替换 jamdict_data 中的 .db 文件

---

## 反馈与贡献

如果感觉本项目有帮助到你, 请点一个 Star 支持一下吧~

欢迎提交 Issue 和 Pull Request, 作者正持续维护中
