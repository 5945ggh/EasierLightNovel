# app/services/dictionary_service.py
import logging
from functools import lru_cache
from typing import List, Optional

from jamdict import Jamdict

from app.schemas import DictResult, DictEntry, SenseEntry

logger = logging.getLogger(__name__)


class DictionaryService:
    """
    日语词典服务

    使用 Jamdict (JMDict) 提供日语词汇查询功能。
    音调功能已预留，待后续集成数据源。
    """

    _instance: Optional["DictionaryService"] = None
    _jmd: Optional[Jamdict] = None
    _initialized: bool = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        # 防止重复初始化
        if self._initialized:
            return

        self._initialize()
        self._initialized = True

    def _initialize(self):
        """初始化 Jamdict"""
        try:
            # memory_mode=False: 不加载到内存，节省资源
            # kd2=False: 不加载汉字字典，节省资源
            self._jmd = Jamdict(memory_mode=False, kd2=False)
            logger.info("Jamdict (JMDict) initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Jamdict: {e}")
            # 不 raise，允许服务降级启动

    def _get_pitch_accent(self, word: str, reading: str) -> List[int]:
        """
        获取音调（未实现）

        TODO: 后续集成音调数据源（如 OJAD、NHK Accent Dictionary）
        返回格式: [0] (平板), [1] (头高), [2] (中高), 等
        同一个词可能有多个音调（不同方言），用列表存储

        Args:
            word: 汉字或假名写法
            reading: 假名读音

        Returns:
            音调核位置列表，暂时返回空列表
        """
        return []

    @lru_cache(maxsize=4096)
    def search_word(self, query: str) -> DictResult:
        """
        查询单词释义

        Args:
            query: 查询词（可以是汉字或假名）

        Returns:
            DictResult: 查询结果
        """
        if not query or not query.strip():
            return DictResult(query=query, found=False, error=None)

        if not self._jmd:
            return DictResult(
                query=query,
                found=False,
                error="Dictionary service not initialized"
            )

        try:
            result = self._jmd.lookup(query)

            if not result.entries:
                return DictResult(query=query, found=False, error=None)

            entries_list: List[DictEntry] = []
            exact_match_found = False

            for entry in result.entries:
                # 提取基本信息
                kanji_forms = [str(k) for k in entry.kanji_forms]
                kana_forms = [str(r) for r in entry.kana_forms]

                # 判定是否精确匹配
                is_exact = (query in kanji_forms) or (query in kana_forms)
                if is_exact:
                    exact_match_found = True

                # 构建释义列表
                senses = []
                for sense in entry.senses:
                    senses.append(SenseEntry(
                        pos=[str(p) for p in sense.pos],
                        definitions=[str(g) for g in sense.gloss]
                    ))

                # 获取音调（预留，暂时为空）
                primary_reading = kana_forms[0] if kana_forms else ""
                pitch = self._get_pitch_accent(query, primary_reading)

                entries_list.append(DictEntry(
                    id=str(entry.idseq),
                    kanji=kanji_forms,
                    reading=kana_forms,
                    senses=senses,
                    pitch_accent=pitch if pitch else None
                ))

            # 排序：精确匹配的排在前面
            entries_list.sort(
                key=lambda x: 0 if (query in x.kanji or query in x.reading) else 1
            )

            return DictResult(
                query=query,
                found=True,
                is_exact_match=exact_match_found,
                entries=entries_list,
                error=None
            )

        except Exception as e:
            logger.error(f"Lookup failed for '{query}': {e}", exc_info=True)
            return DictResult(
                query=query,
                found=False,
                error=str(e)
            )


# ==================== FastAPI 依赖注入 ====================
def get_dictionary_service() -> DictionaryService:
    """获取字典服务实例（单例）"""
    return DictionaryService()
