"""
AI 分析相关路由
"""
from fastapi import APIRouter, HTTPException

from app.schemas import AIAnalysisRequest, AIAnalysisResult
from app.services.llm_service import analyze_japanese_content

router = APIRouter(prefix="/api/ai", tags=["AI Integration"])


@router.post("/analyze", response_model=AIAnalysisResult)
async def analyze_text(req: AIAnalysisRequest):
    """
    接收前端处理好的文本和上下文，调用 LLM 进行日语文本分析

    - **target_text**: 用户选中的目标文本（最大 200 字符）
    - **context_text**: 包含上下文的完整文本片段（最大 1000 字符）
    - **user_prompt**: 可选的用户自定义提示
    - **model_preference**: 可选的模型偏好（留空使用默认配置）
    """
    try:
        result = await analyze_japanese_content(
            target_text=req.target_text,
            context_text=req.context_text,
            user_prompt=req.user_prompt,
            model_preference=req.model_preference
        )
        return result

    except ValueError as e:
        # 捕获解析错误或业务逻辑错误
        raise HTTPException(status_code=422, detail=str(e))

    except Exception as e:
        # 捕获网络错误或未知错误
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="AI 服务暂时不可用，请稍后重试")
