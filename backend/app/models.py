from datetime import datetime
from enum import Enum
from typing import List, Optional
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, JSON, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship, declarative_base, deferred
from sqlalchemy.sql import func
from app.enums import ProcessingStatus

Base = declarative_base()

class Book(Base):
    __tablename__ = "books"

    id = Column(String(32), primary_key=True)  # 使用你的 hash ID
    title = Column(String(255), nullable=False)
    author = Column(String(255), nullable=True)
    cover_url = Column(String(255)) # API Web 相对URL, 如: /static/books/{id}/images/cover.jpg 
    
    status = Column(SQLEnum(ProcessingStatus), default=ProcessingStatus.PENDING)
    error_message = Column(String(255), nullable=True) # 如果失败，记录原因
    
    # 统计信息
    total_chapters = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关联
    chapters = relationship("Chapter", back_populates="book", cascade="all, delete-orphan")
    progress = relationship("UserProgress", back_populates="book", uselist=False)


class Chapter(Base):
    """
    存储章节内容
    """
    __tablename__ = "chapters"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(String(32), ForeignKey("books.id"), index=True)
    index = Column(Integer, nullable=False) # 章节顺序 0, 1, 2...
    title = Column(String(255))
    
    # 核心字段：存储 Chapter.to_dict() 生成的 JSON, 其中每个 TextSegment 应该只包含 tokens 而无 text
    content_json = deferred(Column(JSON, nullable=False)) # 注意防止N+1
    
    book = relationship("Book", back_populates="chapters")


class UserProgress(Base):
    """记录阅读进度"""
    __tablename__ = "user_progress"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(String(32), ForeignKey("books.id"), unique=True)
    
    current_chapter_index = Column(Integer, default=0)
    current_segment_index = Column(Integer, default=0)
    current_segment_offset = Column(Integer, default=0, nullable=True) # segment 的偏移量, 记录当前视口顶部第一个可见的 Token 的 index(Target Token Index); 由于 ImageSegment 的存在, 该字段可以为空
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    book = relationship("Book", back_populates="progress")
    

class Vocabulary(Base):
    """
    生词本（按书存储）
    同一本书的同一个原型（base_form）只记录一次
    """
    __tablename__ = "vocabularies"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(String(32), ForeignKey("books.id"), nullable=False, index=True)

    # 词汇本身
    word = Column(String(100))               # 表层形 (e.g., 食べる)
    reading = Column(String(100))            # 读音 (e.g., たべる)
    base_form = Column(String(100), nullable=False)  # 原型 (e.g., 食べる)
    part_of_speech = Column(String(50))      # 词性

    # 释义 (可能来自 JMDict 或 用户自定义)
    definition = Column(Text, nullable=True)

    # 学习相关接口, 预留, 随时可能更改
    status = Column(Integer, default=0)      # 0: 新学, 1: 学习中, 2: 复习, 3: 已掌握
    next_review_at = Column(DateTime, nullable=True)

    # 上下文（可选）
    context_sentences = Column(JSON, nullable=True)  # 例句列表

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 唯一约束：同一本书 + 同一个原型只记录一次
    __table_args__ = (
        UniqueConstraint('book_id', 'base_form', name='uq_vocab_book_word'),
    )
    

class UserHighlight(Base):
    """
    纯粹的划线实体。
    代表了用户在书上留下的“痕迹”。
    """
    __tablename__ = "user_highlights"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(String(32), ForeignKey("books.id"), index=True)
    chapter_index = Column(Integer, nullable=False)
    
    # === 起点坐标 (Start Anchor) ===
    start_segment_index = Column(Integer, nullable=False)
    start_token_idx = Column(Integer, nullable=False)

    # === 终点坐标 (End Anchor) ===
    end_segment_index = Column(Integer, nullable=False)
    end_token_idx = Column(Integer, nullable=False)
    
    # === 视觉属性 ===
    # 允许用户自定义颜色类别，如: 'grammar'(红), 'vocab'(黄), 'favorite'(粉), ...
    style_category = Column(String(32), default="default") 
    
    # === 数据快照 ===
    # 存储选中的纯文本，既用于校验，也用于列表页展示
    selected_text = Column(Text, nullable=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关联：一个划线对应一个(或0个)积累条目
    # uselist=False 表示一对一关系
    archive = relationship("ArchiveItem", back_populates="highlight", uselist=False, cascade="all, delete-orphan")


class ArchiveItem(Base):
    """
    积累本条目
    只有当用户对划线进行了深度操作（AI解析、写笔记）时才创建此记录
    """
    __tablename__ = "archive_items"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # 外键关联到划线
    highlight_id = Column(Integer, ForeignKey("user_highlights.id"), nullable=True)

    # === 用户笔记 ===
    user_note = Column(Text, nullable=True)

    # === AI 深度解析 ===
    # 灵活存储：可以是 JSON 字符串（结构化）或纯文本（自由格式）
    ai_analysis = Column(Text, nullable=True)

    # === 状态管理预留 ===
    # 是否已加入复习队列
    in_review_queue = Column(Boolean, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    highlight = relationship("UserHighlight", back_populates="archive")
