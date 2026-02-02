"""
LLM 服务层 - 提供日语文本分析功能
"""
import json
import re
from typing import Optional

from app.config import LLMConfig
from app.schemas import AIAnalysisResult
from app.utils.async_api_call import get_async_litellm_response, ThinkingConfig


# ==================== Helper Functions ====================

def _clean_json_string(content: str) -> str:
    """
    清洗 LLM 返回的字符串，移除 Markdown 代码块标记，
    防止 json.loads 失败。

    使用 re.search 在文本任意位置查找代码块，
    以防 LLM 在 JSON 前添加废话（如 "Sure! Here's..."）。
    """
    content = content.strip()

    # 尝试匹配带语言标记的代码块 ```json ... ```
    match = re.search(r"```json\s*(.*?)\s*```", content, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()

    # 尝试匹配不带语言标记的代码块 ``` ... ```
    match = re.search(r"```\s*(.*?)\s*```", content, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()

    # 没有匹配到代码块，直接返回原始内容
    return content


def _generate_system_prompt() -> str:
    """
    动态生成 System Prompt，包含最新的 JSON Schema 定义。
    修改 Schema 后 Prompt 会自动更新。
    """
    schema_definition = json.dumps(
        AIAnalysisResult.model_json_schema(),
        indent=2,
        ensure_ascii=False
    )

    return f"""你是一位精通日文轻小说、语言学和中日翻译的专家助手。

你的任务是根据用户提供的【上下文】和【目标文本】，对目标文本进行深度分析。

## 任务要求

1. **翻译**：提供流畅、符合语境的**中文**翻译。
2. **语法分析**：识别关键句型或语法点，解释其在当前语境下的作用。
3. **语感/活用分析**：针对动词/形容词的活用变形（如使役受身、口语省略等）进行解释，指出其隐含的语吻或潜台词。
4. **文化背景**：如果有 ACG 梗、双关语或特定文化指涉，请指出。

## 输出格式

必须严格输出合法的 JSON 格式，且符合以下 JSON Schema 定义：

```json
{schema_definition}
```

直接返回 JSON 数据，不要包含任何 Markdown 格式标记或额外的解释文字。"""


# ==================== Main Service ====================

async def analyze_japanese_content(
    target_text: str,
    context_text: str,
    user_prompt: Optional[str] = None,
    model_preference: Optional[str] = None
) -> AIAnalysisResult:
    """
    调用 LLM 进行日语文本分析

    Args:
        target_text: 用户选中的目标文本
        context_text: 包含上下文的完整文本片段
        user_prompt: 用户自定义提示（可选）
        model_preference: 模型偏好（可选，留空使用默认配置）

    Returns:
        AIAnalysisResult: 结构化的分析结果

    Raises:
        ValueError: 当 LLM 返回的数据无法解析时
    """
    # 1. 确定使用的模型
    model_name = model_preference or LLMConfig.MODEL

    # 2. 构建用户消息
    user_content = f"""### 上下文:
{context_text}

### 目标文本:
{target_text}"""

    if user_prompt:
        user_content += f"\n\n### 用户特别指令:\n{user_prompt}"

    messages = [
        {"role": "system", "content": _generate_system_prompt()},
        {"role": "user", "content": user_content}
    ]

    # 3. 确定 Thinking 配置
    thinking_config = None
    if LLMConfig.supports_thinking():
        thinking_config = ThinkingConfig(enabled=True, budget=2048)

    # 4. 构建 API 调用参数
    kwargs = {
        "messages": messages,
        "model": model_name,
        "temperature": LLMConfig.TEMPERATURE,
        "api_key": LLMConfig.API_KEY,
        "base_url": LLMConfig.BASE_URL,
    }

    # 5. 仅 OpenAI 系列支持 JSON Mode
    if LLMConfig.supports_json_mode():
        kwargs["response_format"] = {"type": "json_object"}

    # 6. 添加 thinking 配置
    if thinking_config:
        kwargs["thinking_config"] = thinking_config

    # 7. 调用 LLM
    try:
        response = await get_async_litellm_response(**kwargs)
    except Exception as e:
        raise ValueError(f"LLM 调用失败: {e}") from e

    # 8. 提取并解析响应
    if not response.choices or not getattr(response.choices[0], "message"):
        raise ValueError("LLM 返回了空响应")

    content_str = response.choices[0].message.content #type: ignore
    if not content_str:
        raise ValueError("content str 为空")
    # 9. 清洗 JSON 字符串
    cleaned_json_str = _clean_json_string(content_str)

    # 10. 解析 JSON
    try:
        data = json.loads(cleaned_json_str)
    except json.JSONDecodeError as e:
        # 记录原始内容便于调试
        print(f"JSON Parse Error. Raw content:\n{content_str}")
        raise ValueError("AI 返回的数据格式不正确，无法解析。") from e

    # 11. Pydantic 校验与转换
    try:
        return AIAnalysisResult(**data)
    except Exception as e:
        print(f"Pydantic validation error. Data:\n{data}")
        raise ValueError(f"AI 返回的数据结构不符合预期: {e}") from e
