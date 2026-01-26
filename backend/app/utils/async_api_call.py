import os
import asyncio
import traceback
import litellm
from typing import List, Dict, Any, Optional, AsyncGenerator
from enum import Enum, auto

# 显式导入用于类型检查
from litellm import ModelResponse

# 复用之前的配置类与枚举
class ThinkingConfig:
    def __init__(self, enabled: bool = False, budget: Optional[int] = None):
        self.enabled = enabled
        self.budget = budget

class StreamEventType(Enum):
    REASONING = auto()          # 思考过程
    CONTENT = auto()            # 正文内容
    TOOL_CALLING_START = auto() # 信号：开始工具调用
    TOOL_CALLING = auto()       # 完整工具参数
    USAGE = auto()              # Token 用量
    ERROR = auto()              # 错误信息

def _prepare_common_args(
    model: str,
    messages: List[Dict[str, Any]],
    api_key: Optional[str],
    base_url: Optional[str],
    temperature: float,
    tools: Optional[List[Dict[str, Any]]],
    parallel_tool_calls: bool,
    thinking_config: Optional[ThinkingConfig],
    **kwargs
) -> Dict[str, Any]:
    """
    通用参数构建逻辑（同步/异步通用）
    """
    api_kwargs: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "api_key": api_key or os.environ.get("LLM_API_KEY"),
        "base_url": base_url or os.environ.get("LLM_BASE_URL"),
        "drop_params": True,  # 自动丢弃不支持的参数
    }

    if tools:
        api_kwargs["tools"] = tools
        api_kwargs["parallel_tool_calls"] = parallel_tool_calls

    if thinking_config and thinking_config.enabled:
        # 针对 Claude 3.7+ 的 thinking 适配
        if "claude" in model.lower():
            thinking_kwarg: Dict[str, Any] = {"type": "enabled"}
            if thinking_config.budget:
                thinking_kwarg["budget_tokens"] = thinking_config.budget
            api_kwargs["thinking"] = thinking_kwarg
        else:
            # DeepSeek R1 等通常通过 reasoning_content 返回，无需特定请求体
            api_kwargs["temperature"] = temperature
    else:
        api_kwargs["temperature"] = temperature

    api_kwargs.update(kwargs)
    return api_kwargs

async def get_async_litellm_response(
    messages: List[Dict[str, Any]], 
    model: str, 
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    temperature: float = 1.0, 
    tools: Optional[List[Dict[str, Any]]] = None,
    parallel_tool_calls: bool = True,
    thinking_config: Optional[ThinkingConfig] = None,
    **kwargs
) -> ModelResponse:
    """
    LiteLLM 异步非流式调用 (Async Non-Streaming)
    """
    api_kwargs = _prepare_common_args(
        model, messages, api_key, base_url, temperature, 
        tools, parallel_tool_calls, thinking_config, **kwargs
    )
    api_kwargs["stream"] = False

    try:
        # 核心变化：使用 acompletion
        response = await litellm.acompletion(**api_kwargs)
        return response # type: ignore
    except Exception:
        # 异步环境下的 Traceback 有时较难追踪，建议在此记录日志
        raise

async def get_async_stream_litellm_response(
    messages: List[Dict[str, Any]], 
    model: str, 
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    temperature: float = 1.0, 
    tools: Optional[List[Dict[str, Any]]] = None,
    parallel_tool_calls: bool = True,
    thinking_config: Optional[ThinkingConfig] = None,
    **kwargs
) -> AsyncGenerator[tuple[StreamEventType, Any], None]:
    """
    LiteLLM 异步流式调用 (Async Streaming)
    """
    api_kwargs = _prepare_common_args(
        model, messages, api_key, base_url, temperature, 
        tools, parallel_tool_calls, thinking_config, **kwargs
    )
    api_kwargs["stream"] = True
    api_kwargs["stream_options"] = {"include_usage": True}

    tool_calls_buffer = {} 
    has_emitted_tool_start = False 

    try:
        # 核心变化：await acompletion
        stream = await litellm.acompletion(**api_kwargs)
        # 核心变化：async for 迭代
        async for chunk in stream: # type: ignore
            
            # 1. Usage 处理
            if hasattr(chunk, 'usage') and chunk.usage: # type: ignore
                 if chunk.usage.completion_tokens or chunk.usage.prompt_tokens: # type: ignore
                    yield (StreamEventType.USAGE, chunk.usage) # type: ignore
            
            if not chunk.choices:
                continue
                
            delta = chunk.choices[0].delta
            
            # 2. Reasoning (R1 / Claude)
            reasoning = (
                getattr(delta, 'reasoning_content', None) or 
                getattr(delta, 'reasoning', None)
            )
            if reasoning:
                yield (StreamEventType.REASONING, reasoning)

            # 3. Content
            if delta.content:
                yield (StreamEventType.CONTENT, delta.content)
            
            # 4. Tool Calls
            if delta.tool_calls:
                if not has_emitted_tool_start:
                    yield (StreamEventType.TOOL_CALLING_START, None)
                    has_emitted_tool_start = True

                for tool_part in delta.tool_calls:
                    idx = tool_part.index
                    if idx not in tool_calls_buffer:
                        tool_calls_buffer[idx] = {"id": "", "name": "", "args": ""}
                    
                    if tool_part.id:
                        tool_calls_buffer[idx]["id"] = tool_part.id
                    if tool_part.function:
                        if tool_part.function.name:
                            tool_calls_buffer[idx]["name"] = tool_part.function.name
                        if tool_part.function.arguments:
                            tool_calls_buffer[idx]["args"] += tool_part.function.arguments
        
        # 5. Flush Tool Calls
        for idx in sorted(tool_calls_buffer.keys()):
            tool_data = tool_calls_buffer[idx]
            if tool_data["name"]: 
                full_tool_call = {
                    "id": tool_data["id"],
                    "type": "function",
                    "function": {
                        "name": tool_data["name"],
                        "arguments": tool_data["args"]
                    }
                }
                yield (StreamEventType.TOOL_CALLING, full_tool_call)

    except Exception as e:
        traceback.print_exc()
        yield (StreamEventType.ERROR, str(e))


if __name__ == "__main__":
    import dotenv
    from openai import pydantic_function_tool
    from pydantic import BaseModel, Field

    dotenv.load_dotenv(override=True)
    
    API_KEY = os.environ.get("LLM_API_KEY")
    BASE_URL = os.environ.get("LLM_BASE_URL")

    # 定义工具
    class GetWeather(BaseModel):
        """获取指定城市的天气"""
        location: str = Field(description="城市名称，例如：北京")

    tool_schemas = [pydantic_function_tool(GetWeather)]

    # 异步入口函数
    async def main():
        print(f"🚀 开始异步测试 (PID: {os.getpid()})...")
        
        messages = [{"role":"user", "content":"请思考一下并告诉我，北京现在的天气适合出门跑步吗？"}]
        
        # 调用异步流式函数
        generator = get_async_stream_litellm_response(
            messages=messages,
            model="deepseek/deepseek-reasoner", # 验证 R1 + Tools
            api_key=API_KEY,
            base_url=BASE_URL, 
            tools=tool_schemas # type: ignore
        )
        
        print("\n--- Stream Start ---")
        async for event_type, data in generator:
            if event_type == StreamEventType.REASONING:
                # 打印思考过程 (淡色或特定标记)
                print(f"\033[90m{data}\033[0m", end="", flush=True)
                
            elif event_type == StreamEventType.CONTENT:
                # 打印正文
                print(f"\033[92m{data}\033[0m", end="", flush=True)
                
            elif event_type == StreamEventType.TOOL_CALLING_START:
                print("\n\n🛠️  [System] 检测到工具调用意图...", flush=True)
                
            elif event_type == StreamEventType.TOOL_CALLING:
                print(f"\n🔧 [Tool] Call: {data['function']['name']} Args: {data['function']['arguments']}")
                
            elif event_type == StreamEventType.USAGE:
                print(f"\n\n📊 Usage: Prompt({data.prompt_tokens}) + Compl({data.completion_tokens})")
                
        print("\n--- Stream End ---")

    # 运行 Event Loop
    asyncio.run(main())
