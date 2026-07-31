import re
from dataclasses import dataclass
from typing import List, Optional, Literal, Dict, Any, Tuple
from sudachipy import tokenizer, dictionary
import jaconv

from app.config import TOKENIZER_DEFAULT_MODE
from app.utils.domain import Token


@dataclass(frozen=True)
class RebuildToken:
    """Lossless-enough Sudachi semantics for a future rebuildable analysis run.

    This is intentionally not serialized into Chapter.content_json.  Reading
    is the raw Sudachi value (normally Katakana), with provenance explicit so
    an OOV guess is never mistaken for a trusted dictionary reading.
    """
    surface: str
    dictionary_form: str
    normalized_form: str
    part_of_speech: Tuple[str, str, str, str, str, str]
    conjugation_type: str
    conjugation_form: str
    is_oov: bool
    word_id: int
    dictionary_id: int
    reading_form: Optional[str]
    reading_provenance: Literal["sudachi_registered", "oov_guess", "none"]
    reading_confidence: Literal["trusted", "untrusted", "none"]
    start_offset: int
    end_offset: int

    @property
    def has_trusted_reading(self) -> bool:
        return self.reading_confidence == "trusted"


# ================= 核心逻辑 =================
class JapaneseTokenizer:
    def __init__(self, mode: Optional[str] = None):
        # 从配置读取默认模式
        if mode is None:
            mode = TOKENIZER_DEFAULT_MODE

        mode_map = {
            "A": tokenizer.Tokenizer.SplitMode.A,
            "B": tokenizer.Tokenizer.SplitMode.B, # 推荐 B：语义平衡
            "C": tokenizer.Tokenizer.SplitMode.C,
        }
        self.tokenizer = dictionary.Dictionary().create()
        self.mode = mode_map.get(mode, tokenizer.Tokenizer.SplitMode.B)
        # 预编译正则，提升字符处理性能
        self.kanji_pattern = re.compile(r'[\u4e00-\u9fff]')
        self.kana_pattern = re.compile(r'[ぁ-んァ-ンー]')

    def process_text(self, text: str) -> List[Token]:
        if not text:
            return []

        sudachi_tokens = self.tokenizer.tokenize(text, self.mode)
        results = []
        cursor = 0 # 光标位置

        for t in sudachi_tokens:
            # 1. 补全丢失的空白/符号 (Gap Filling)
            # Sudachi 的 begin() 是基于字符的索引
            start_idx = t.begin()
            if start_idx > cursor:
                gap_text = text[cursor:start_idx]
                if gap_text:
                    results.append(Token(gap_text, is_gap=True))

            # 2. 处理当前 Token
            surface = t.surface()
            cursor = t.end() # 更新光标

            # 获取读音
            try:
                reading_katakana = t.reading_form()
                if reading_katakana:
                    reading_hiragana = jaconv.kata2hira(reading_katakana)
                else:
                    reading_hiragana = surface
            except (ValueError, TypeError, AttributeError):
                # reading_form() 可能返回 None 或不存在，jaconv.kata2hira() 可能转换失败
                reading_hiragana = surface

            base_form = t.dictionary_form()
            # 安全获取词性
            pos_info = t.part_of_speech()
            pos = pos_info[0] if pos_info else "Unknown"

            token_obj = Token(surface, reading_hiragana, base_form, pos)

            # 3. 智能注音 (仅当有汉字且读音不同时)
            if self._has_kanji(surface) and surface != reading_hiragana:
                 token_obj.parts = self._recursive_align(surface, reading_hiragana)
            else:
                token_obj.reading = None

            results.append(token_obj)

        # 4. 处理末尾剩余的空白 (如换行符)
        if cursor < len(text):
            gap_text = text[cursor:]
            results.append(Token(gap_text, is_gap=True))

        return results

    def tokenize_for_rebuild(self, text: str) -> List[RebuildToken]:
        """Expose a tested semantic tokenizer contract without changing UI tokens."""
        if not text:
            return []
        return [self._to_rebuild_token(morpheme)
                for morpheme in self.tokenizer.tokenize(text, self.mode)]

    @staticmethod
    def _safe_morpheme_value(morpheme: Any, method: str, default: Any) -> Any:
        try:
            value = getattr(morpheme, method)()
            return default if value is None else value
        except (AttributeError, TypeError, ValueError):
            return default

    def _to_rebuild_token(self, morpheme: Any) -> RebuildToken:
        pos_values = tuple(str(value) for value in self._safe_morpheme_value(
            morpheme, "part_of_speech", ()))
        six_pos = tuple((pos_values + ("*",) * 6)[:6])
        is_oov = bool(self._safe_morpheme_value(morpheme, "is_oov", False))
        raw_reading = self._safe_morpheme_value(morpheme, "reading_form", None)
        reading_form = str(raw_reading) if raw_reading else None
        if reading_form and not is_oov:
            provenance: Literal["sudachi_registered", "oov_guess", "none"] = "sudachi_registered"
            confidence: Literal["trusted", "untrusted", "none"] = "trusted"
        elif reading_form:
            provenance = "oov_guess"
            confidence = "untrusted"
        else:
            provenance = "none"
            confidence = "none"

        return RebuildToken(
            surface=str(self._safe_morpheme_value(morpheme, "surface", "")),
            dictionary_form=str(self._safe_morpheme_value(morpheme, "dictionary_form", "")),
            normalized_form=str(self._safe_morpheme_value(morpheme, "normalized_form", "")),
            part_of_speech=six_pos,  # type: ignore[arg-type]
            # Sudachi's six-level POS is the portable source of these values;
            # some installed bindings do not expose separate accessors.
            conjugation_type=six_pos[4],
            conjugation_form=six_pos[5],
            is_oov=is_oov,
            word_id=int(self._safe_morpheme_value(morpheme, "word_id", -1)),
            dictionary_id=int(self._safe_morpheme_value(morpheme, "dictionary_id", -1)),
            reading_form=reading_form,
            reading_provenance=provenance,
            reading_confidence=confidence,
            start_offset=int(self._safe_morpheme_value(morpheme, "begin", 0)),
            end_offset=int(self._safe_morpheme_value(morpheme, "end", 0)),
        )

    def _has_kanji(self, text: str) -> bool:
        return bool(self.kanji_pattern.search(text))

    def _recursive_align(self, surface: str, reading: str) -> List[Dict[str, Any]]:
        """
        递归锚点对齐算法 (Recursive Anchor Alignment)
        解决 "売り出す" -> "う" "り" "だ" "す" 的混合词对齐问题
        """
        # 如果没有汉字，无需拆分 (比如纯片假名单词)
        if not self._has_kanji(surface):
             return [{"text": surface, "ruby": None}]

        # 寻找锚点 (假名)
        anchor_match = self.kana_pattern.search(surface)

        # 如果全是汉字 (无锚点)，整体注音
        if not anchor_match:
            return [{"text": surface, "ruby": reading}]

        anchor_char = anchor_match.group()
        anchor_idx = anchor_match.start()

        # 在读音中寻找锚点
        try:
            # 策略：假设 surface 的第一个假名对应 reading 的第一个相同假名
            # 局限性：对于极其特殊的重复音可能误判，但在 Sudachi 分词粒度下极少发生
            reading_anchor_idx = reading.index(anchor_char)
        except ValueError:
            # 找不到锚点（如熟字训：'大和' -> 'やまと'），Fallback 为整体注音
            return [{"text": surface, "ruby": reading}]

        # 递归切分
        s_head = surface[:anchor_idx]
        r_head = reading[:reading_anchor_idx]

        anchor_part = {"text": anchor_char, "ruby": None}

        s_tail = surface[anchor_idx+1:]
        r_tail = reading[reading_anchor_idx+1:]

        result = []
        if s_head: result.extend(self._recursive_align(s_head, r_head))
        result.append(anchor_part)
        if s_tail: result.extend(self._recursive_align(s_tail, r_tail))

        return result
