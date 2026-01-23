# app/schemas/book.py
from pydantic import BaseModel, Field
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

    # 可选字段（按需添加，分词时不包含）
    is_vocabulary: Optional[bool] = None      # 是否在生词本中
    highlight_id: Optional[int] = None        # 所属划线的 ID
    highlight_style: Optional[str] = None     # 划线样式
    
    
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