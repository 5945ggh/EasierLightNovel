# app/schemas.py
from pydantic import BaseModel, Field, model_validator
from typing import List, Optional, Union
from datetime import datetime

from app.enums import ProcessingStatus, JLPTLevel
from app.config import LLMConfig, HIGHLIGHT_STYLE_CATEGORIES

# ==================== Book 相关 ====================
class BookBase(BaseModel):
    """书籍基础信息"""
    title: str
    author: Optional[str] = None

class BookCreate(BookBase):
    """创建书籍请求"""
    pass  # 实际上传是通过文件，这里可能用于元数据补充

class BookDetail(BaseModel):
    """书籍详情响应"""
    id: str
    title: str
    author: Optional[str] = None
    cover_url: Optional[str] = None
    status: ProcessingStatus
    error_message: Optional[str] = None
    total_chapters: int
    created_at: datetime

BookListItem = BookDetail # 书籍列表项

class BookUpdate(BaseModel): # 一般不通过此接口修改 status 或 content，保持纯粹的元数据修改
    """修改书籍元数据请求"""
    title: Optional[str] = None
    author: Optional[str] = None
    cover_url: Optional[str] = None


# ==================== 分词组件 ====================
class RubyPart(BaseModel):
    """注音部分"""
    text: str
    ruby: Optional[str] = None

class TokenData(BaseModel):
    """分词 Token 数据"""
    s: str                                    # surface (表层形)
    r: Optional[str] = None                   # reading (读音)
    b: Optional[str] = None                   # base_form (原型)
    p: Optional[str] = None                   # part_of_speech (词性)
    gap: Optional[bool] = None                # 是否有间隔
    RUBY: Optional[List[RubyPart]] = None     # 振假名 parts（强类型）

    # 我们保证数据的分离传输, 不再包含以下字段:
    # is_vocabulary: Optional[bool] = None      # 是否在生词本中
    # highlight_id: Optional[int] = None        # 所属划线的 ID
    # highlight_style: Optional[str] = None     # 划线样式


# ==================== 章节内容段 ====================
class SegmentBase(BaseModel):
    """内容段基类"""
    type: str

class TextSegmentSchema(SegmentBase):
    """文本段（支持未分词和已分词两种状态）"""
    type: str = "text"
    text: Optional[str] = Field(default=None, description="未分词时的原始文本")
    tokens: Optional[List[TokenData]] = Field(default=None, description="分词后的 token 列表")

class ImageSegmentSchema(SegmentBase):
    """图片段"""
    type: str = "image"
    src: str = Field(..., description="图片 URL")
    alt: str = Field(default="", description="替代文本")

ContentSegment = Union[TextSegmentSchema, ImageSegmentSchema]


# ==================== Chapter 相关 ====================
class ChapterHighlightData(BaseModel):
    id: int
    # 本章节内的定位信息
    start_segment_index: int
    start_token_idx: int
    end_segment_index: int
    end_token_idx: int
    style_category: str

    class Config:
        from_attributes = True

class ChapterResponse(BaseModel):
    index: int
    title: str
    segments: List[ContentSegment]  # 包含 TokenData 的列表

    # === 动态数据（本章范围）===
    highlights: List[ChapterHighlightData] = []

class ChapterListItem(BaseModel):
    """章节列表项"""
    index: int
    title: str

# ==================== Vocabulary 相关 ====================
class VocabularyBaseFormsResponse(BaseModel):
    """生词原型集合响应（全书范围）"""
    base_forms: List[str]  # 去重后的生词原型列表

class VocabularyBase(BaseModel):
    """生词基础信息"""
    word: str = Field(..., description="表层形")
    reading: Optional[str] = Field(None, description="读音")
    base_form: str = Field(..., description="原型")
    part_of_speech: Optional[str] = Field(None, description="词性")
    definition: Optional[str] = Field(None, description="释义json")

class VocabularyCreate(VocabularyBase):
    """添加生词请求"""
    book_id: str
    context_sentences: Optional[List[str]] = Field(None, description="例句列表")

class VocabularyResponse(VocabularyBase):
    """生词响应"""
    id: int
    book_id: str
    definition: Optional[str] = None
    status: int = 0
    next_review_at: Optional[datetime] = None
    context_sentences: Optional[List[str]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# 划线
class HighlightBase(BaseModel):
    """划线基础属性"""
    style_category: str = "default"
    selected_text: str = Field(..., description="选中的纯文本内容，用于校验或回显")

class HighlightCreate(HighlightBase):
    """创建划线请求"""
    book_id: str
    chapter_index: int

    # === 坐标系统 ===
    start_segment_index: int = Field(..., ge=0)
    start_token_idx: int = Field(..., ge=0)
    end_segment_index: int = Field(..., ge=0)
    end_token_idx: int = Field(..., ge=0)

    @model_validator(mode='after')
    def validate_coords(self):
        if self.end_segment_index < self.start_segment_index:
            raise ValueError("end_segment_index must be >= start_segment_index")
        if self.end_segment_index == self.start_segment_index and self.end_token_idx < self.start_token_idx:
            raise ValueError("end_token_idx must be >= start_token_idx in same segment")
        return self

class HighlightResponse(HighlightCreate):
    """划线响应"""
    id: int
    created_at: datetime
    has_Archive: bool = Field(False, description="划线句是否有对应的Archive条目")

    class Config:
        from_attributes = True

# ==================== Dictionary 相关 ====================
class SenseEntry(BaseModel):
    """释义条目"""
    pos: List[str] = Field(default_factory=list, description="词性列表")
    definitions: List[str] = Field(default_factory=list, description="释义列表")


class DictEntry(BaseModel):
    """字典条目"""
    id: str = Field(..., description="JMDict IDSeq")
    kanji: List[str] = Field(default_factory=list, description="汉字形式列表")
    reading: List[str] = Field(default_factory=list, description="读音列表")
    senses: List[SenseEntry] = Field(default_factory=list, description="释义列表")

    # 音调信息：预留字段，暂时返回空列表
    # 格式示例: [0] (平板), [1] (头高), [2] (中高)
    # 同一个词可能有多个音调（不同方言），用列表存储
    pitch_accent: Optional[List[int]] = Field(None, description="音调核位置列表（预留）")


class DictResult(BaseModel):
    """字典查询结果"""
    query: str = Field(..., description="查询词")
    found: bool = Field(..., description="是否找到结果")
    is_exact_match: bool = Field(default=False, description="是否精确匹配")
    entries: List[DictEntry] = Field(default_factory=list, description="字典条目列表")
    error: Optional[str] = Field(None, description="错误信息")


# ==================== UserProgress 相关 ====================
class UserProgressBase(BaseModel):
    """阅读进度基础"""
    current_chapter_index: int = Field(default=0, ge=0)
    current_segment_index: int = Field(default=0, ge=0)

    # 注意：models.py 里这个字段是 nullable=True，但为了前端处理方便，
    # 我们在 Schema 层将其收敛为 int (如果为 None 则由后端逻辑转为 0)
    current_segment_offset: int = Field(default=0, ge=0)

class UserProgressUpdate(UserProgressBase):
    """更新阅读进度请求"""
    pass # 继承了 UserProgressBase

class UserProgressResponse(UserProgressBase):
    """阅读进度响应"""
    book_id: str
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# ==================== AI/Analysis 相关 ====================

class AIAnalysisRequest(BaseModel):
    """
    获取AI分析
    """
    # 不需要 book_id, chapter_index, tokens_indices 做数据查询
    # 但保留它们用于日志记录或后续的用户笔记关联
    book_id: str
    chapter_index: int
    highlight_id: Optional[int] = Field(None, description="触发此分析的划线 ID（如果有）")

    # 核心载荷（长度限制从配置读取）
    target_text: str = Field(..., max_length=LLMConfig.AI_MAX_TARGET_LENGTH, description="用户选中的文本")
    context_text: str = Field(..., max_length=LLMConfig.AI_MAX_CONTEXT_LENGTH, description="包含上下文的完整文本片段")

    user_prompt: Optional[str] = None  # 预留用户自定义提示
    model_preference: Optional[str] = Field(None, description="模型偏好（留空使用默认配置）")

class GrammarPoint(BaseModel):
    target_text: str = Field(..., description="该语法点对应的原文片段")
    pattern: str = Field(..., description="语法句型 (如: ～てしまう)")
    level: Optional[JLPTLevel] = Field(None, description="JLPT 等级")
    explanation: str = Field(..., description="针对当前语境的解释")

class VocabularyNuance(BaseModel):
    """
    针对单个词汇的语感分析，区别于字典，这里专注于语境中的活用变形和细微差别
    """
    target_text: str = Field(..., description="原文中的词汇形式（含活用变形）")
    base_form: str = Field(..., description="原型（辞典形）")
    conjugation: Optional[str] = Field(None, description="活用形类型 (e.g., 使役受身形、タ形、テ形等)")
    nuance: str = Field(..., description="在当前语境下的具体语感、潜台词或修辞效果")

class AIAnalysisResult(BaseModel):
    """
    LLM 返回的结构化结果
    """
    # 翻译针对的是用户选中的整个范围（Selection）
    translation: str = Field(..., description="选中内容的流畅中文翻译")

    # 语法和语感分析列表
    grammar_analysis: List[GrammarPoint] = Field(default_factory=list)
    vocabulary_nuance: List[VocabularyNuance] = Field(default_factory=list)

    # 文化注释（针对整个 selection）
    cultural_notes: Optional[str] = Field(None, description="梗/文化背景/双关语 (Markdown格式)")


class AIAnalysisUpdate(BaseModel):
    """
    用户修改后的 AI 分析结果（用于保存到积累本）
    """
    translation: str = Field(..., description="用户编辑后的翻译")
    grammar_analysis: List[GrammarPoint] = Field(default_factory=list)
    vocabulary_nuance: List[VocabularyNuance] = Field(default_factory=list)
    cultural_notes: Optional[str] = Field(None, description="文化注释 (Markdown格式)")


class ArchiveItemResponse(BaseModel):
    """积累本条目响应"""
    id: int
    highlight_id: int
    user_note: Optional[str] = None
    ai_analysis: Optional[str] = None  # JSON 字符串
    in_review_queue: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==================== Config 相关 ====================
class HighlightStyleInfo(BaseModel):
    """划线样式信息"""
    color: str
    name: str


class FeatureFlags(BaseModel):
    """功能开关"""
    ai_analysis: bool = True
    dictionary: bool = True


class ConfigLimits(BaseModel):
    """前端需要的配置限制"""
    max_target_length: int = Field(..., description="AI 分析选中文本最大长度")
    max_context_length: int = Field(..., description="AI 分析上下文最大长度")
    max_upload_size: int = Field(..., description="文件上传最大大小（字节）")
    query_default_limit: int = Field(..., description="查询默认限制")
    query_max_limit: int = Field(..., description="查询最大限制")


class BackendInfo(BaseModel):
    """后端服务器信息"""
    host: str = Field(..., description="后端监听地址")
    port: int = Field(..., description="后端端口")
    url: str = Field(..., description="后端基础 URL（供前端使用）")


class PublicConfigResponse(BaseModel):
    """公共配置响应（供前端使用）"""
    version: str = Field(..., description="API 版本")
    backend: BackendInfo
    limits: ConfigLimits
    features: FeatureFlags
    highlight_styles: dict[str, HighlightStyleInfo]
