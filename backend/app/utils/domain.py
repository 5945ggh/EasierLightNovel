from typing import List, Dict, Any, Optional

# ==================== Parser =================
# 为了保证保证原顺序的图文交错排布, 我们在Chapter内划分出了Segment
# 基本逻辑是: 解析Epub的一个Chapter时, 我们维护一个text cache.
# 每当解析到图片, 我们就将text cache中的内容结算为一个TextSegment,
# 并将图片内容作为ImageSegment插在后面, 依次类推, 从而保证了顺序.
class ContentSegment:
    """Segment基类"""
    def __init__(self) -> None:
        self.type = "base"
        
    def to_dict(self):
        raise NotImplementedError

class TextSegment(ContentSegment):
    def __init__(self, text: str):
        self.type = "text"
        self.text: str = text
        # 预留 tokens 字段，默认为空列表, 在后续的 Service 层被填充
        self.tokens: List[Dict[str, Any]] = []

    def set_tokens(self, tokens: list) -> None:
        """设置切词结果tokens并清空text"""
        self.tokens = tokens
        # 分词完成后，内存里的 text 其实也可以清空了，省内存
        self.text = ""

    def to_dict(self) -> Dict[str, Any]:
        output: Dict[str, Any] = {
            "type": "text",
        }
        if self.text: output["text"] = self.text
        if self.tokens: output["tokens"] = self.tokens
        return output

class ImageSegment(ContentSegment):
    def __init__(self, src_path: str, alt: str = ""):
        self.type = "image"
        self.src = src_path  # 这里存储的是相对于后端URL根目录的路径，如 /static/books/book_id/images/1.jpg
        self.alt = alt

    def to_dict(self):
        return {"type": "image", "src": self.src, "alt": self.alt}

class Chapter:
    def __init__(self, title: str, index: int):
        self.title = title
        self.index = index
        self.segments: List[ContentSegment] = []

    def to_dict(self):
        return {
            "title": self.title,
            "index": self.index,
            "segments": [seg.to_dict() for seg in self.segments]
        }
        
# ================= Tokenizer =================
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