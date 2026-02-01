# app/routers/user_config.py
"""
用户配置管理 API
提供配置读取、更新接口
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any

from app.schemas import (
    UserConfigResponse,
    UserConfigUpdate,
    ConfigUpdateResponse,
)
from app.services.user_config_service import (
    UserConfigService,
    SENSITIVE_FIELDS,
)


router = APIRouter(prefix="/api/user-config", tags=["UserConfig"])


def get_config_service() -> UserConfigService:
    """依赖注入：获取配置服务实例"""
    return UserConfigService()


@router.get("", response_model=UserConfigResponse)
def get_user_config(
    service: UserConfigService = Depends(get_config_service),
):
    """
    获取用户配置（用于设置页面）

    **返回内容**：
    - `config`: 当前配置值（敏感字段已掩码显示为 ****）
    - `schema_info`: 配置字段的元信息（类型、默认值、描述等）
    - `restart_required`: 当前是否有未应用的配置（需要重启）

    **示例响应**：
    ```json
    {
      "config": {
        "backend": { "host": "127.0.0.1", "port": 8010 },
        "llm": { "api_key": "sk-****", "model": "deepseek/deepseek-chat" }
      },
      "schema_info": [
        {
          "group": "backend",
          "label": "后端服务配置",
          "fields": [
            { "key": "backend.host", "type": "string", "description": "..." }
          ]
        }
      ],
      "restart_required": false
    }
    ```
    """
    config, schema_info = service.get_config_with_schema()
    return UserConfigResponse(
        config=config,
        schema_info=schema_info,
        restart_required=False,
    )


@router.post("", response_model=ConfigUpdateResponse)
def update_user_config(
    update_data: UserConfigUpdate,
    service: UserConfigService = Depends(get_config_service),
):
    """
    更新用户配置

    **请求体**：
    ```json
    {
      "config": {
        "backend.port": 8011,
        "llm.api_key": "new-api-key"
      }
    }
    ```

    **注意**：
    - 支持部分更新，只需提交修改的字段
    - 字段路径使用点分隔（如 "backend.port"）
    - API Key 等敏感字段如果值为 "****" 或空，则保持原值不变
    - 修改某些配置后需要重启后端才能生效

    **响应**：
    - `restart_required`: 是否需要重启后端
    - `updated_fields`: 已更新的字段列表
    """
    # 过滤掉未修改的敏感字段
    filtered_config = {}
    for key, value in update_data.config.items():
        if key in SENSITIVE_FIELDS:
            # 如果敏感字段值以 **** 开头或为空，则不更新
            if value and not str(value).startswith("****") and str(value) != "****":
                filtered_config[key] = value
        else:
            filtered_config[key] = value

    success, message, updated_fields, restart_required = service.update_config(
        filtered_config
    )

    if not success:
        raise HTTPException(status_code=400, detail=message)

    return ConfigUpdateResponse(
        success=success,
        message=message,
        restart_required=restart_required,
        updated_fields=updated_fields,
    )
