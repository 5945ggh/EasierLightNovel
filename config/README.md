# 配置指南

**EasierLightNovel** 所有的个性化设置均通过 `config/user.json` 文件进行管理。

## 快速设置

首次使用时，请复制示例文件：

```bash
# Windows
copy config\user.json.example config\user.json

# macOS / Linux / Git Bash
cp config/user.json.example config/user.json
```

修改 `config/user.json` 后，**必须重启** 后端服务才能生效。

---

## 1. LLM 与 AI 配置 (核心功能)

为了使用“AI 深度解析”功能，你需要配置大语言模型。项目底层使用 `LiteLLM`，支持 OpenAI、DeepSeek、Claude、Ollama 等多种后端。

**配置位置**: `"llm": { ... }`

| 字段              | 说明                                   | 默认值 / 示例                                           |
| :--------------- | :----------------------------------- | :----------------------------------------------------- |
| `model`          | **模型名称**<br>格式必须为 `供应商/模型名`        | `deepseek/deepseek-chat`<br>`openai/gpt-4o`<br>`ollama/llama3` |
| `api_key`        | API 密钥                               | `"sk-..."`                                             |
| `base_url`       | API 基础地址 (可选)                        | `"https://api.deepseek.com"`                             |
| `max_text_length` | 允许用户选中的最大文本长度 (AI 解析时使用)           | `512` (字符)                                            |

**常见配置示例：**

```json
// 使用 DeepSeek
"llm": {
  "model": "deepseek/deepseek-chat",
  "api_key": "sk-your-key",
  "base_url": "https://api.deepseek.com"
}

// 使用本地 Ollama
"llm": {
  "model": "ollama/llama3",
  "api_key": "ollama", 
  "base_url": "http://localhost:11434"
}
```

---

## 2. PDF 解析配置 (使用 PDF 功能时必需)

PDF 文件通过 MinerU 云端 API 解析，需要配置 API Token。

**配置位置**: `"pdf"`

| 字段                      | 说明                                          | 默认值     |
| :---------------------- | :------------------------------------------- | :------- |
| `mineru_api_token`     | **MinerU API Token**（必需）<br>从 [mineru.net](https://mineru.net/) 获取 | `null`    |
| `mineru_model_version` | MinerU 模型版本<br>`vlm` 或 `pipeline`                 | `"vlm"`  |
| `mineru_language`      | 文档语言<br>`ch`=中英, `japan`=日语                      | `"japan"` |
| `poll_interval_seconds` | 轮询间隔（秒）                                    | `5`       |
| `max_poll_retries`      | 最大轮询次数                                      | `720`     |

**配置示例**：

```json
{
  "pdf": {
    "mineru_api_token": "your-mineru-api-token",
    "mineru_model_version": "vlm",
    "mineru_language": "japan"
  }
}
```

> **注意**：CDN 下载会自动绕过系统代理（`trust_env=False`），避免 SSL 握手问题。

---

## 3. 阅读与词典设置

调整日语分词精度和字典行为，优化阅读体验。

**配置位置**: `"tokenizer"` / `"dictionary"` / `"epub"`

| 模块       | 字段                | 说明                                                           | 推荐值        |
| :------- | :---------------- | :----------------------------------------------------------- | :--------- |
| **分词**   | `mode`            | **分词粒度**<br>`A`: 短单位 (最细)<br>`B`: 中单位 (标准)<br>`C`: 长单位 (复合词) | `"B"` (推荐) |
| **词典**   | `memory_mode`     | **内存模式**<br>`true`: 加载全字典进内存 (非常不建议, 可能加载很多份词典进入内存)<br>`false`: 磁盘查询 (省内存) | `false`    |
| **词典**   | `load_kanji_dict` | 是否加载汉字详情字典                                                   | `false`    |
| **词典**   | `db_path` | 词典文件路径, 不填则为jamdict默认路径             | `null`    |
| **EPUB** | `max_chunk_size`  | 单个文本切片长度，一般不需要修改   | `1024`     |

---

## 4. 网络与端口配置

用于解决端口冲突或进行局域网/公网部署。

**配置位置**: `"backend"` / `"frontend"` / `"cors"`

| 字段                     | 说明                                 | 默认值                         |
| :--------------------- | :--------------------------------- | :-------------------------- |
| `backend.host`         | 后端监听地址 (`0.0.0.0` 可用于局域网访问)        | `"127.0.0.1"`               |
| `backend.port`         | 后端服务端口                             | `8010`                      |
| `frontend.port`        | 前端开发服务器端口                          | `5173`                      |
| `cors.allowed_origins` | **CORS 跨域白名单**<br>⚠️ 修改端口后必须同步更新此处 | `["http://localhost:5173"]` |

> **注意**：如果使用**生产模式**（`npm run build` 后启动后端）或**打包后的可执行文件**，前端已集成在后端中，无需配置前端端口与跨域设置。

**端口冲突解决示例：**

如果你想将前端改为 `5174`，后端改为 `8011`，请修改：

```json
{
  "backend": { "host": "127.0.0.1", "port": 8011 },
  "frontend": { "port": 5174 },
  "cors": {
    "allowed_origins": [
      "http://localhost:5174",
      "http://127.0.0.1:5174"
    ]
  }
}
```

---

## 5. 存储与路径

自定义数据存储位置，适合需要将数据存放在外接硬盘或特定目录的用户。

**配置位置**: `"paths"`

| 字段                | 说明                              | 默认值                      |
| :---------------- | :------------------------------ | :----------------------- |
| `data_dir`        | **核心数据目录**<br>存放数据库、解压后的图片、书籍文件 | `"static_data"`          |
| `temp_upload_dir` | 上传文件临时缓存目录                      | `"backend/temp_uploads"` |

---

## 6. 高级设置

通常情况下无需修改。

| 模块          | 字段              | 说明                              | 默认值               |
| :---------- | :-------------- | :------------------------------ | :---------------- |
| **Upload**  | `max_file_size` | 最大上传文件大小 (Bytes)                | `52428800` (50MB) |
| **Query**   | `default_limit` | API 默认分页数量                      | `100`             |
| **Logging** | `level`         | 日志级别 (`DEBUG`, `INFO`, `ERROR`) | `"INFO"`          |

---
