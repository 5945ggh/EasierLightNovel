# app/routers/config.py
"""
公共配置 API
提供前端需要的配置信息，实现前后端配置同步
"""
from fastapi import APIRouter

from app.schemas import (
    PublicConfigResponse,
    ConfigLimits,
    FeatureFlags,
    HighlightStyleInfo
)
from app.config import (
    LLMConfig,
    UPLOAD_MAX_FILE_SIZE,
    QUERY_DEFAULT_LIMIT,
    QUERY_MAX_LIMIT,
    HIGHLIGHT_STYLE_CATEGORIES
)

router = APIRouter(prefix="/api/config", tags=["Config"])


@router.get("", response_model=PublicConfigResponse)
def get_public_config():
    """
    获取公共配置（供前端使用）

    **用途**：
    - 前端启动时调用此接口获取后端配置
    - 确保前后端配置同步，无需硬编码

    **返回内容**：
    - `version`: API 版本号
    - `limits`: 各种长度和大小限制
    - `features`: 功能开关
    - `highlight_styles`: 划线样式配置（颜色、名称）

    **建议调用时机**：
    - 前端应用启动时调用一次
    - 将配置存入全局状态或常量

    **示例响应**：
    ```json
    {
      "version": "0.1.0",
      "limits": {
        "max_target_length": 512,
        "max_context_length": 2048,
        "max_upload_size": 52428800,
        "query_default_limit": 100,
        "query_max_limit": 500
      },
      "features": {
        "ai_analysis": true,
        "dictionary": true
      },
      "highlight_styles": {
        "default": {"color": "#3b82f6", "name": "默认"},
        "vocab": {"color": "#eab308", "name": "生词"},
        "grammar": {"color": "#ef4444", "name": "语法"},
        "favorite": {"color": "#ec4899", "name": "收藏"}
      }
    }
    ```
    """
    # 构建划线样式响应（转换 dict 的内部结构为 API 响应格式）
    highlight_styles = {
        key: HighlightStyleInfo(**value)
        for key, value in HIGHLIGHT_STYLE_CATEGORIES.items()
    }

    return PublicConfigResponse(
        version="0.1.0",
        limits=ConfigLimits(
            max_target_length=LLMConfig.AI_MAX_TARGET_LENGTH,
            max_context_length=LLMConfig.AI_MAX_CONTEXT_LENGTH,
            max_upload_size=UPLOAD_MAX_FILE_SIZE,
            query_default_limit=QUERY_DEFAULT_LIMIT,
            query_max_limit=QUERY_MAX_LIMIT,
        ),
        features=FeatureFlags(
            ai_analysis=True,
            dictionary=True,
        ),
        highlight_styles=highlight_styles,
    )
