# app/routers/dictionary.py
from fastapi import APIRouter, Depends, Query

from app.schemas import DictResult
from app.services.dictionary_service import DictionaryService, get_dictionary_service

router = APIRouter(prefix="/api/dictionary", tags=["Dictionary"])


@router.get("/search", response_model=DictResult)
def search_dictionary(
    query: str = Query(..., min_length=1, max_length=100, description="查询词"),
    dictionary_service: DictionaryService = Depends(get_dictionary_service)
):
    """
    查询日语词典

    **查询参数**:
    - query: 要查询的日语单词（汉字或假名均可）

    **返回结果**:
    - found: 是否找到匹配
    - is_exact_match: 是否有精确匹配
    - entries: 词条列表，包含汉字、读音、释义
    - pitch_accent: 音调信息（预留，暂时为空）

    **示例**:
    - GET /api/dictionary/search?query=食べる
    - GET /api/dictionary/search?query=雨
    """
    return dictionary_service.search_word(query)
