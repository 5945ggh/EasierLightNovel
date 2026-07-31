# app/models.py
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, JSON, Boolean, UniqueConstraint, Float
from sqlalchemy.orm import relationship, declarative_base, deferred
from sqlalchemy.sql import func
from app.enums import ProcessingStatus

Base = declarative_base()

class Book(Base):
    __tablename__ = "books"

    id = Column(String(32), primary_key=True) # uuid 32位
    title = Column(String(255), nullable=False)
    author = Column(String(255), nullable=True)
    cover_url = Column(String(255)) # API Web 相对URL, 如: /static/books/{id}/images/cover.jpg

    status = Column(SQLEnum(ProcessingStatus), default=ProcessingStatus.PENDING)
    error_message = Column(String(255), nullable=True) # 如果失败，记录原因

    # 统计信息
    total_chapters = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # PDF 处理进度（可选，仅 PDF 解析时使用）
    pdf_progress_stage = Column(String(50), default="")      # uploading/processing/downloading
    pdf_progress_current = Column(Integer, default=0)         # 当前页数
    pdf_progress_total = Column(Integer, default=0)           # 总页数

    # Existing rows default to legacy_unavailable through the additive SQLite
    # migration. A value of rebuildable is set only after an immutable source
    # file and its source-content version were committed successfully.
    source_rebuild_status = Column(String(32), nullable=False, default="legacy_unavailable")

    # 关联
    chapters = relationship("Chapter", back_populates="book", cascade="all, delete-orphan")
    progress = relationship("UserProgress", back_populates="book", uselist=False, cascade="all, delete-orphan")
    vocabularies = relationship("Vocabulary", back_populates="book", cascade="all, delete-orphan")
    highlights = relationship("UserHighlight", back_populates="book", cascade="all, delete-orphan")
    source_files = relationship("BookSourceFile", back_populates="book", cascade="all, delete-orphan")
    source_content_versions = relationship("SourceContentVersion", back_populates="book", cascade="all, delete-orphan")


class BookSourceFile(Base):
    """Private immutable original uploaded file for one imported book."""
    __tablename__ = "book_source_files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(String(32), ForeignKey("books.id"), nullable=False, unique=True, index=True)
    file_type = Column(String(16), nullable=False)
    media_type = Column(String(100), nullable=False)
    sha256 = Column(String(64), nullable=False, index=True)
    relative_path = Column(String(512), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    book = relationship("Book", back_populates="source_files")


class SourceContentVersion(Base):
    """Versioned parser output used to rebuild future analysis artifacts.

    source_content_json is intentionally separate from Chapter.content_json:
    it stores parser-source documents and stable document-relative character
    offsets, while Chapter.content_json remains the reader's compact cache.
    """
    __tablename__ = "source_content_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(String(32), ForeignKey("books.id"), nullable=False, index=True)
    source_file_sha256 = Column(String(64), nullable=False, index=True)
    parser_version = Column(String(64), nullable=False)
    source_schema_version = Column(Integer, nullable=False)
    source_content_sha256 = Column(String(64), nullable=False)
    source_content_json = deferred(Column(JSON, nullable=False))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    book = relationship("Book", back_populates="source_content_versions")
    ruby_hints = relationship("SourceRubyHint", back_populates="source_content_version", cascade="all, delete-orphan")


class SourceRubyHint(Base):
    """Author ruby retained as a source-level hint, never a rendered token reading."""
    __tablename__ = "source_ruby_hints"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source_content_version_id = Column(Integer, ForeignKey("source_content_versions.id"), nullable=False, index=True)
    document_id = Column(String(255), nullable=False)
    start_offset = Column(Integer, nullable=False)
    end_offset = Column(Integer, nullable=False)
    base_text = Column(Text, nullable=False)
    reading_raw = Column(Text, nullable=False)
    markup = Column(JSON, nullable=False)
    provenance = Column(String(32), nullable=False, default="epub_ruby")

    source_content_version = relationship("SourceContentVersion", back_populates="ruby_hints")


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


# 难点预警：React 渲染是异步的。不能在组件 mount 时立刻 scroll。必须等待 DOM 里的 Token 渲染完毕。建议使用 useLayoutEffect 或监听最后一个 Token 的渲染回调，然后再执行 document.querySelector([data-token-index="${offset}"]).scrollIntoView()。
class UserProgress(Base):
    """记录阅读进度"""
    __tablename__ = "user_progress"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(String(32), ForeignKey("books.id"), unique=True)

    current_chapter_index = Column(Integer, default=0)
    current_segment_index = Column(Integer, default=0)
    # 进度百分比，存储 0-100 的浮点数（当前章节内的滚动位置）
    progress_percentage = Column(Float, default=0.0)
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

    book = relationship("Book", back_populates="vocabularies")
    

class UserHighlight(Base):
    """
    纯粹的划线实体。
    代表了用户在书上留下的"痕迹"。
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

    book = relationship("Book", back_populates="highlights")

    @property
    def has_archive(self) -> bool:
        """是否有对应的积累本条目"""
        # lazy='select' 时访问 self.archive 会触发额外查询
        # 调用方应使用 joinedload/selectinload 预加载
        return self.archive is not None

    @property
    def has_Archive(self) -> bool:
        """兼容旧前端字段名。后续前端统一到 has_archive 后可删除。"""
        return self.has_archive


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
