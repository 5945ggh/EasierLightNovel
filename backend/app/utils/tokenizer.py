import re
from typing import List, Optional, Literal, Dict, Any
from sudachipy import tokenizer, dictionary
import jaconv

from app.config import TOKENIZER_DEFAULT_MODE

# ================= 数据模型 =================
class Token:
    def __init__(self, surface: str, reading: Optional[str] = None, base_form: str = "", pos: str = "", is_gap: bool = False):
        self.surface = surface      # 显示文本
        self.reading = reading      # 读音
        self.base_form = base_form  # 原型
        self.pos = pos              # 词性
        self.is_gap = is_gap        # 标记是否为补全的空白/符号
        self.parts: List[Dict[str, Any]] = []

    def to_dict(self):
        # 极简模式，减少 JSON 体积
        d: Dict[str, Any] = {"s": self.surface}
        if self.is_gap:
            d["gap"] = True
        else:
            if self.reading: d["r"] = self.reading
            if self.base_form: d["b"] = self.base_form
            if self.pos: d["p"] = self.pos
            if self.parts: d["RUBY"] = self.parts
        return d

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
