# app/schemas.py
from pydantic import BaseModel, Field, model_validator
from typing import List, Optional, Union, Any, Dict
from enum import Enum
from datetime import datetime

from app.enums import ProcessingStatus

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
    
    class Config:
        from_attributes = True
        
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