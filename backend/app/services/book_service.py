# app/services/book_services.py
import os
import shutil
import logging
from typing import List, Optional, Literal
from sqlalchemy.orm import Session
from fastapi import UploadFile, BackgroundTasks

from models import Book, Chapter, ProcessingStatus
from schemas import BookCreate
from utils.epub_parser import LightNovelParser, TextSegment, ImageSegment
from utils.tokenizer import JapaneseTokenizer
from config import UPLOAD_DIR

logger = logging.getLogger(__name__)

class BookService:
    def __init__(self, db: Session):
        self.db = db

    def get_books(self, skip: int = 0, limit: int = 100) -> List[Book]:
        return self.db.query(Book).offset(skip).limit(limit).all()

    def get_book(self, book_id: str) -> Optional[Book]:
        return self.db.query(Book).filter(Book.id == book_id).first()

    def delete_book(self, book_id: str):
        book = self.get_book(book_id)
        if book:
            # 1. 删除物理文件 (封面、解压的图片等)
            book_dir = os.path.join(UPLOAD_DIR, book_id)
            if os.path.exists(book_dir):
                shutil.rmtree(book_dir, ignore_errors=True)
            
            # 2. 删除数据库记录 (Cascade delete 会自动删除 chapters, progress 等)
            self.db.delete(book)
            self.db.commit()
            return True
        return False

    def _extract_epub_metadata(self, epub_path: str, fallback_title: str) -> tuple[str, Optional[str]]:
        """
        从 EPUB 文件提取元数据

        Returns:
            (title, author): 标题和作者
        """
        try:
            from ebooklib import epub
            book_obj = epub.read_epub(epub_path)

            # 提取标题
            title = fallback_title
            if book_obj.get_metadata('DC', 'title'):
                title = book_obj.get_metadata('DC', 'title')[0][0]

            # 提取作者
            author = None
            if book_obj.get_metadata('DC', 'creator'):
                author = book_obj.get_metadata('DC', 'creator')[0][0]

            logger.info(f"Extracted metadata - Title: {title}, Author: {author}")
            return title, author

        except Exception as e:
            logger.warning(f"Failed to extract EPUB metadata: {e}, using fallback")
            return fallback_title, None

    def _find_cover_image_fallback(self, book_id: str) -> Optional[str]: 
        """
        当process_book_task中寻找封面的逻辑失效时用来模糊查找书籍封面图片

        策略：
        1. 优先查找文件名包含 'cover' 的图片
        2. 否则使用第一张图片

        Args:
            book_id: 书籍 ID

        Returns:
            封面 URL（如 /static/books/{book_id}/images/cover.jpg），找不到则返回 None
        """
        images_dir = os.path.join(UPLOAD_DIR, book_id, "images")

        # 检查目录是否存在
        if not os.path.exists(images_dir):
            logger.warning(f"Images directory not found: {images_dir}")
            return None

        try:
            # 获取所有图片文件
            image_files = sorted([
                f for f in os.listdir(images_dir)
                if f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp'))
            ])

            if not image_files:
                logger.warning(f"No images found in {images_dir}")
                return None

            # 策略1：优先找包含 'cover' 的文件名
            for img_file in image_files:
                if 'cover' in img_file.lower():
                    cover_url = f"/static/books/{book_id}/images/{img_file}"
                    logger.info(f"Found cover image: {cover_url}")
                    return cover_url

            # 策略2：使用第一张图片作为封面
            cover_url = f"/static/books/{book_id}/images/{image_files[0]}"
            logger.info(f"Using first image as cover: {cover_url}")
            return cover_url

        except Exception as e:
            logger.error(f"Failed to find cover image for {book_id}: {e}")
            return None

    async def create_book_from_file(self, file: UploadFile, background_tasks: BackgroundTasks) -> Book:
        """
        接收上传文件，创建 Book 记录 (Pending 状态)，并触发后台解析任务
        """
        # 1. 预读取文件头计算 Hash (作为 ID)
        # 注意：对于大文件，read() 可能会耗内存，但 EPUB 通常不大
        if file.filename is None: raise ValueError("Upload File Error: No filename")
        content = await file.read()

        # 临时保存文件以便解析器读取
        temp_dir = "./temp_uploads"
        os.makedirs(temp_dir, exist_ok=True)
        temp_file_path = os.path.join(temp_dir, file.filename)

        with open(temp_file_path, "wb") as f:
            f.write(content)

        book_id = LightNovelParser.generate_book_id_from_head(temp_file_path)

        # 2. 检查是否已存在
        existing_book = self.get_book(book_id)
        if existing_book:
            # 清理临时文件
            os.remove(temp_file_path)
            return existing_book

        # 3. 提取 EPUB 元数据
        fallback_title = file.filename.replace(".epub", "")
        title, author = self._extract_epub_metadata(temp_file_path, fallback_title)

        # 4. 创建数据库记录 (PENDING)
        new_book = Book(
            id=book_id,
            title=title,
            author=author,
            status=ProcessingStatus.PENDING,
            total_chapters=0,
            cover_url=None,  # TODO: 我们可以在提取EPUB元数据时找一下cover? 不过没有images_map, 不好操作
            error_message=None
        )
        self.db.add(new_book)
        self.db.commit()
        self.db.refresh(new_book)

        # 5. 添加后台任务
        # 注意：这里需要传递文件路径，后台任务跑完后负责删除临时文件
        background_tasks.add_task(
            self.process_book_task,
            book_id,
            temp_file_path
        )

        return new_book

    def process_book_task(self, book_id: str, file_path: str, mode: Literal["A", "B", "C"] = "B"):
        """
        后台任务：解析 EPUB -> 分词 -> 存入数据库
        需要创建新的 DB Session，因为原来的请求 Session 可能已关闭
        """
        # 这里的 SessionLocal 是 database.py 里定义的
        from database import SessionLocal 
        db = SessionLocal()
        
        try:
            book = db.query(Book).filter(Book.id == book_id).first()
            if not book: return # 甚至可能在解析前被删了
            
            book.status = ProcessingStatus.PROCESSING # type: ignore
            db.commit()
            
            logger.info(f"Start processing book: {book.title} ({book_id})")

            # A. 解析 EPUB 结构
            parser = LightNovelParser(file_path, UPLOAD_DIR)
            raw_chapters = parser.parse() # 返回 List[Chapter] (这里的 Chapter 是 parser 类，非 ORM) 

            # B. 初始化分词器
            tokenizer = JapaneseTokenizer(mode=mode)

            # C. 遍历处理每个章节
            detected_cover_url: Optional[str] = None
            total_chapters = len(raw_chapters)
            orm_chapters = []

            for raw_chap in raw_chapters:
                # 遍历 segment，如果是 text 类型，进行分词
                for seg in raw_chap.segments:
                    if detected_cover_url is None:
                        # 兼容处理：检查类型是否为 ImageSegment 或 type 字段为 image
                        is_image = False
                        if hasattr(seg, 'type') and getattr(seg, "type") == 'image':
                            is_image = True
                        elif isinstance(seg, ImageSegment):
                            is_image = True
                            
                        if is_image and (src := getattr(seg, 'src', None)):
                            detected_cover_url = src
                            logger.info(f"Detected cover from content stream: {detected_cover_url}")
                            
                    if isinstance(seg, TextSegment) and seg.text: # 这里使用isinstance判断究竟是否可能因导入方式的不同而产生意外的后果?
                        # 调用 Sudachi 分词
                        tokens_obj_list = tokenizer.process_text(seg.text)
                        # 转换成 dict 存储
                        seg.set_tokens([t.to_dict() for t in tokens_obj_list])

                # 创建 ORM 对象
                # 注意：content_json 需要存储为 Python 对象 (List[Dict])，SQLAlchemy 会自动转 JSON
                segments_json = [seg.to_dict() for seg in raw_chap.segments]
                
                new_chapter = Chapter(
                    book_id=book_id,
                    index=raw_chap.index,
                    title=raw_chap.title,
                    content_json=segments_json
                )
                orm_chapters.append(new_chapter)

            # D. 批量写入章节
            db.bulk_save_objects(orm_chapters)

            # E. 若遍历时落空, 兜底查找封面图片
            cover_url = detected_cover_url or self._find_cover_image_fallback(book_id)

            # F. 更新书籍状态
            book.status = ProcessingStatus.COMPLETED # type: ignore
            book.total_chapters = total_chapters # type: ignore
            if cover_url:
                book.cover_url = cover_url # type: ignore

            db.commit()
            logger.info(f"Successfully processed book: {book.title} ({total_chapters} chapters)")

        except Exception as e:
            logger.error(f"Failed to process book {book_id}: {e}", exc_info=True)
            book.status = ProcessingStatus.FAILED # type: ignore
            book.error_message = str(e)[:250] # type: ignore
            db.commit()
        
        finally:
            db.close()
            # 清理上传的临时文件
            if os.path.exists(file_path):
                os.remove(file_path)
