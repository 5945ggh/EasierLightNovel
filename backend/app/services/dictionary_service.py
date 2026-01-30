# app/services/dictionary_service.py
import logging
import threading
from functools import lru_cache
from typing import List, Optional

from jamdict import Jamdict

from app.schemas import DictResult, DictEntry, SenseEntry
from app.config import (
    DICTIONARY_CACHE_SIZE,
    DICTIONARY_MEMORY_MODE,
    DICTIONARY_LOAD_KANJI_DICT,
    DICTIONARY_DB_PATH,
    DICTIONARY_PREFERRED_LANGUAGES,
    DICTIONARY_SHOW_ALL_LANGUAGES,
)

logger = logging.getLogger(__name__)

# 线程局部存储，每个线程有自己的 Jamdict 实例
_thread_local = threading.local()


class DictionaryService:
    """
    日语词典服务

    使用 Jamdict (JMDict) 提供日语词汇查询功能。
    使用线程局部存储解决 SQLite 线程安全问题。
    """

    _instance: Optional["DictionaryService"] = None
    _initialized: bool = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True

    @property
    def _jmd(self) -> Jamdict:
        """获取当前线程的 Jamdict 实例"""
        if not hasattr(_thread_local, 'jmd'):
            # 从配置读取数据库路径和内存模式
            db_path = DICTIONARY_DB_PATH if DICTIONARY_DB_PATH else None
            _thread_local.jmd = Jamdict(
                db_file=db_path,
                memory_mode=DICTIONARY_MEMORY_MODE,
                # kd2=DICTIONARY_LOAD_KANJI_DICT TODO: 研究其他参数
            )
            logger.debug(f"Created new Jamdict instance for thread {threading.get_ident()}, db_path={db_path}")
        return _thread_local.jmd

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

    def _filter_glosses(self, glosses) -> List[str]:
        """
        根据语言配置过滤和排序释义

        逻辑:
        - show_all_languages=true: 显示所有语言，按 preferred_languages 顺序排序
        - show_all_languages=false: 只显示 preferred_languages 中第一个有释义的语言

        Args:
            glosses: jamdict 返回的 gloss 对象列表

        Returns:
            过滤并排序后的释义文本列表
        """
        # 按语言分组
        grouped: dict[str, List[str]] = {}
        for g in glosses:
            lang = getattr(g, 'lang', 'eng')
            text = getattr(g, 'text', str(g))  # 使用 text 属性获取纯文本
            if lang not in grouped:
                grouped[lang] = []
            grouped[lang].append(text)

        if DICTIONARY_SHOW_ALL_LANGUAGES:
            # 显示所有语言，按 preferred_languages 顺序排序
            result = []
            for lang in DICTIONARY_PREFERRED_LANGUAGES:
                if lang in grouped:
                    result.extend(grouped[lang])
            # 添加其他不在优先级列表中的语言
            for lang, texts in grouped.items():
                if lang not in DICTIONARY_PREFERRED_LANGUAGES:
                    result.extend(texts)
            return result
        else:
            # 只显示第一个有释义的首选语言
            for lang in DICTIONARY_PREFERRED_LANGUAGES:
                if lang in grouped:
                    return grouped[lang]
            # 如果没有首选语言，返回空列表
            return []

    @lru_cache(maxsize=DICTIONARY_CACHE_SIZE)
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

                # 构建释义列表（根据语言配置过滤）
                senses = []
                for sense in entry.senses:
                    senses.append(SenseEntry(
                        pos=[str(p) for p in sense.pos],
                        definitions=self._filter_glosses(sense.gloss)
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
