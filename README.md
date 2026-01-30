# EbookToTextbook

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-19+-cyan.svg)](https://react.dev/)

---

## 项目简介

**EbookToTextbook** 是一个本地化部署的日语学习阅读器，专为日语基础较低但想阅读原版轻小说的用户设计。

### 核心特性

| 功能 | 描述 |
|------|------|
| **EPUB 解析** | 上传 EPUB 文件，自动提取插图并保持原书排版 |
| **智能分词** | 基于 SudachiPy 的高质量日语分词，自动生成振假名 |
| **即时词典** | 集成 Jamdict 日语词典，点击单词即可查看释义 |
| **生词本** | 收集生词，支持按书分类和间隔重复复习 |
| **划线高亮** | 多种样式划线，标记重要句子和语法点 |
| **AI 深度解析** | 可选调用 LLM 进行语法、翻译、语感分析 |
| **阅读进度** | 自动保存阅读位置，随时恢复 |
| **TTS 发音** | 使用浏览器内置引擎进行日语朗读 |

### 设计理念

- **混合架构**：传统 NLP（分词、注音）+ 大模型（深度解析）
- **渐进式学习**：从基础注音到 AI 语法分析，适应不同水平
- **本地化部署**：数据隐私可控，适合个人使用
- **沉浸式阅读**：保留原书排版，支持插图混排

---

## 快速开始

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
cp config/user.json.example config/user.json
```

主要配置项（可选，不使用 AI 功能可跳过）：

```json
{
  "llm": {
    "model": "deepseek/deepseek-chat",
    "api_key": "your-api-key-here",
    "base_url": "https://api.deepseek.com"
  }
}
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
EbookToTextbook/
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

点击首页的「上传书籍」按钮，选择 EPUB 文件。系统会自动解析并分词。

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

### LLM 配置（可选）

AI 分析功能需要配置 LLM，支持通过 litellm 接入多种模型：

```json
{
  "llm": {
    "model": "openai/gpt-4o-mini",           // OpenAI
    "model": "deepseek/deepseek-chat",       // DeepSeek
    "model": "ollama/llama3",                 // 本地 Ollama
    "api_key": "your-api-key",
    "base_url": "https://api.example.com"
  }
}
```

不配置 LLM 不影响基础阅读和词典功能。

### 其他配置

详见 `config/schema.json`，支持：
- 分词模式（A/B/C 粒度）
- 词典语言偏好
- 端口和路径配置
- 上传文件大小限制

---

## 开发

### 运行测试

```bash
cd backend
uv run pytest
```

### 代码风格

```bash
# 后端类型检查
uv run pyright app/

# 前端 lint
cd web
npm run lint
```

---

## 常见问题

**Q: 为什么上传 EPUB 后一直显示处理中？**

A: EPUB 解析是后台任务，刷新页面即可查看状态。大文件可能需要较长时间。

**Q: AI 解析报错怎么办？**

A: 检查 API 配置是否正确，确保 `api_key` 和 `base_url` 匹配。

**Q: 支持其他格式的电子书吗？**

A: 目前仅支持 EPUB，未来计划支持 TXT、PDF 等格式。

**Q: 数据存储在哪里？**

A: 所有数据存储在本地 `static_data/` 目录，包括数据库和书籍文件。

---

## 路线图

- [ ] Docker 容器化部署
- [ ] 支持更多电子书格式（TXT、PDF、MOBI）
- [ ] 生词本导出（Anki 格式）
- [ ] 阅读统计可视化
- [ ] 多用户支持
- [ ] 移动端适配优化

---

## 许可证

[MIT License](LICENSE)

---

## 致谢

- [SudachiPy](https://github.com/WorksApplications/SudachiPy) - 日语分词
- [Jamdict](https://github.com/neocl/jamdict) - 日语词典
- [FastAPI](https://fastapi.tiangolo.com/) - 后端框架
- [React](https://react.dev/) - 前端框架

---

## 反馈与贡献

欢迎提交 Issue 和 Pull Request！

如有问题或建议，请通过 GitHub Issues 联系。
