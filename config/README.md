# 用户配置说明

## 配置文件

项目根目录下的 `config/user.json` 文件用于自定义应用配置。

```json
{
  "$schema": "./schema.json",
  "backend": {
    "host": "127.0.0.1",
    "port": 8010
  }
}
```

## 配置项

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `backend.host` | 后端监听地址 | `127.0.0.1` |
| `backend.port` | 后端端口 | `8010` |

## 端口冲突解决

如果 8010 端口被占用，修改 `port` 为其他可用端口（如 8011、8000 等）。

**注意**：修改端口后需要重启后端服务。

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

## 前端配置

前端当前使用 Vite 代理（`web/vite.config.ts`），硬编码了 8010 端口。

如果修改了后端端口，需要同步修改 `vite.config.ts` 中的 proxy target。

**TODO**: 前端动态配置支持见 `web/src/services/config.service.ts`。
