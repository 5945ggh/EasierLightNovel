# 用户配置说明

## 配置文件

项目根目录下的 `config/user.json` 文件用于自定义应用配置。

```json
{
  "$schema": "./schema.json",
  "backend": {
    "host": "127.0.0.1",
    "port": 8010
  },
  "frontend": {
    "port": 5173
  },
  "cors": {
    "allowed_origins": [
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ]
  }
}
```

## 配置项

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `backend.host` | 后端监听地址 | `127.0.0.1` |
| `backend.port` | 后端端口 | `8010` |
| `frontend.port` | 前端端口 | `5173` |
| `cors.allowed_origins` | CORS 允许的前端地址 | `["http://localhost:5173", "http://127.0.0.1:5173"]` |

## 端口冲突解决

### 修改后端端口

如果 8010 端口被占用，修改 `backend.port` 为其他可用端口（如 8011、8000 等）。

### 修改前端端口

如果 5173 端口被占用，修改 `frontend.port` 为其他可用端口（如 5174、3000 等）。

### 同步更新 CORS

**修改端口时必须同步更新** `cors.allowed_origins`，否则会出现跨域错误。

例如，将前端端口改为 5174：

```json
{
  "backend": {"host": "127.0.0.1", "port": 8010},
  "frontend": {"port": 5174},
  "cors": {
    "allowed_origins": [
      "http://localhost:5174",
      "http://127.0.0.1:5174"
    ]
  }
}
```

**注意**：修改配置后需要重启后端和前端服务。

## 配置优先级

```
环境变量 > config/user.json > 代码默认值
```

如需通过环境变量覆盖配置，可以使用：

```bash
# Linux/Mac
export PORT=8011

# Windows CMD
set PORT=8011

# Windows PowerShell
$env:PORT=8011
```
