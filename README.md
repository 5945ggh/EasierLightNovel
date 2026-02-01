# EasierLightNovel

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
| **生词本** + **划线高亮** | 收集生词，支持按书分类和间隔重复复习; 多种样式划线，标记重要句子和语法点 |
| **AI 深度解析** | 可选调用 LLM 进行语法、翻译、语感分析 |
| **阅读进度** | 自动保存阅读位置，随时恢复 |
| **TTS 发音** | 可使用浏览器内置引擎进行日语朗读 |

### 设计理念

- **混合架构**：传统 NLP（分词、注音）+ 大模型（深度解析）
- **渐进式学习**：从基础注音到 AI 语法分析，适应不同水平
- **本地化部署**：数据隐私可控，适合个人使用
- **沉浸式阅读**：保留原书排版，支持插图混排

---

## 快速开始

> **提示**：Windows 用户可下载 `release` 中的打包文件直接使用，更快捷轻量。

### 环境要求

- **Python**: 3.11+
- **Node.js**: 18+
- **操作系统**: Windows / macOS / Linux

### 一、安装依赖

```bash
# 后端依赖（推荐使用 uv）
cd backend
pip install uv
uv sync

# 前端依赖
cd ../web
npm install
```

### 二、配置文件

复制配置模板并修改：

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
└── static_data/          # 运行时生成（书籍、数据库）
```

---

## 使用指南

### 1. 上传书籍

点击首页的「导入书籍」按钮，选择 EPUB 或 PDF 文件。系统会自动解析并分词。

> **注意**：PDF 解析需要配置 MinerU API Token（见下方配置说明）。

### 2. 阅读与学习

- **点击汉字**：显示振假名注音
- **点击单词**：弹出词典释义窗口
- **添加生词**：在词典窗口点击「加入生词本」
- **划线高亮**：拖拽选择文本，选择高亮样式
- **AI 解析**：点击已高亮区域，请求 AI 深度分析

### 3. 学习中心

在「学习中心」页面可以：
- 查看和管理生词本
- 查看高亮划线和 AI 解析结果
- 进行间隔重复复习

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

AI 分析功能需要配置 LLM，支持通过 litellm 接入多种模型：

```json
{
  "llm": {
    "model": "openai/gpt-4o-mini",    // OpenAI
    // "model": "deepseek/deepseek-chat",  // DeepSeek
    // "model": "ollama/llama3",            // 本地 Ollama
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

A: 所有数据**完全本地化**存储在 `static_data/` 目录，包括书籍信息数据库和提取出的图片。

---

## 路线图

- [ ] 支持更多电子书格式（TXT、MOBI）
- [ ] 生词本导出（Anki 格式）
- [ ] 阅读统计可视化
- [ ] 移动端适配优化 

###  欢迎提交代码!

---

## 许可证

[MIT License](LICENSE)

---

## 致谢

- [SudachiPy](https://github.com/WorksApplications/SudachiPy) - 日语分词
- [Jamdict](https://github.com/neocl/jamdict) - 日语词典
- [FastAPI](https://fastapi.tiangolo.com/) - 后端框架
- [React](https://react.dev/) - 前端框架
- [薛老师]() - 动力来源

## 其他可能有用的项目
- [Jamdict中文翻译版本](https://github.com/5945ggh/jamdict-cn) - 可用以替换 jamdict_data 中的 .db 文件

---

## 反馈与贡献

如果感觉本项目有帮助到你, 请点一个 Star 支持一下吧~

欢迎提交 Issue 和 Pull Request, 作者正持续维护中
