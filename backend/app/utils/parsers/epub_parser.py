import hashlib
import os
import posixpath
import re
import uuid
import warnings
from urllib.parse import unquote, urlsplit
from typing import List, Dict, Any, Optional
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from bs4.element import NavigableString, Tag, Comment

from app.config import UPLOAD_DIR, STATIC_URL_PREFIX, EPUB_MAX_TITLE_LENGTH, EPUB_MAX_CHUNK_SIZE
from app.utils.domain import ContentSegment, TextSegment, ImageSegment, Chapter

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)


# ================= 解析逻辑 =================
class LightNovelParser:
    def __init__(self, epub_path: str, book_id: str, output_dir: Optional[str] = None, max_chunk_size: Optional[int] = None):
        """
        :param epub_path: EPUB 文件路径
        :param book_id: 书籍唯一 ID（由调用方生成的 UUID）
        :param output_dir: 静态资源输出目录 (用于存解压后的图片)，默认使用 config.UPLOAD_DIR
        :param max_chunk_size: 一个Segment最大文本长度, 从配置读取默认值, 受 Sudachi 分词本身的限制不建议设置超过40k
        """
        self.epub_path = epub_path
        self.book_id = book_id
        # 从配置读取默认值
        self.max_chunk_size = max_chunk_size or EPUB_MAX_CHUNK_SIZE

        # 如果未指定 output_dir，使用配置文件中的默认值
        if output_dir is None:
            output_dir = UPLOAD_DIR

        # 创建图片存储目录
        self.image_output_dir = os.path.join(output_dir, self.book_id, "images")
        os.makedirs(self.image_output_dir, exist_ok=True)

        # 使用配置的静态文件 URL 前缀
        self.web_image_prefix = f"{STATIC_URL_PREFIX}/books/{self.book_id}/images"

        self.book = epub.read_epub(epub_path)
        self.images_map = {} # map internal filename -> saved web path
        self._extract_all_images()
        self.cover_image_url = self._find_declared_cover_image()
        image_paths = sorted(self.images_map)
        fallback_path = next(
            (path for path in image_paths if "cover" in posixpath.basename(path).lower()),
            image_paths[0] if image_paths else None,
        )
        self.fallback_cover_image_url = self.images_map.get(fallback_path)
        # A parser-source coordinate space kept outside the reader cache.  It
        # is persisted by BookService as a SourceContentVersion after import.
        self.source_documents: List[Dict[str, Any]] = []

        # 建立 TOC 映射: spine_id -> chapter_title
        self.toc_map = self._build_toc_map()

        # 记录上一个有 TOC 标题的章节（用于标题继承）
        self._last_toc_title: Optional[str] = None

    @staticmethod
    def generate_book_id() -> str:
        """
        生成唯一的书籍 ID

        使用 UUID v4 确保唯一性，避免基于文件内容的哈希冲突。
        EPUB 文件头高度相似（ZIP + mimetype），使用内容哈希会导致冲突。
        """
        return uuid.uuid4().hex

    def _build_toc_map(self) -> Dict[str, str]:
        """
        建立 TOC 映射表: spine_id -> chapter_title

        EPUB 的 TOC (book.toc) 是一个 Link 对象列表，每个 Link 有:
        - title: 章节标题
        - href: 如 "xhtml/p-001.xhtml"

        从 href 中提取 spine_id (如 "p-001")，建立映射关系。
        """
        toc_map = {}
        for link in self.book.toc:
            href = getattr(link, 'href', '')
            if not href:
                continue

            # href 可能是 "xhtml/p-001.xhtml" 或 "../item/xhtml/p-001.xhtml"
            # 提取文件名并去掉扩展名
            filename = os.path.basename(href)
            spine_id = os.path.splitext(filename)[0]

            title = getattr(link, 'title', '')
            if spine_id and title:
                toc_map[spine_id] = title

        return toc_map

    def _extract_chapter_title(
        self,
        spine_id: str,
        soup: BeautifulSoup,
        chapter_index: int,
        first_text_line_info: tuple[Optional[str], bool] = (None, False)
    ) -> str:
        """
        提取章节标题（组合策略）

        优先级：
        1. TOC 标题（如果存在）
        2. 继承上一个 TOC 标题（用于同一章的后续部分，如 p-002, p-003）
        3. 从文档的 h1-h6 标签获取
        4. 正文首行提取（引号标题/标点符号策略）
        5. Fallback: "Chapter X"

        Args:
            spine_id: spine 中的 item_id (如 "p-001")
            soup: BeautifulSoup 解析后的文档对象
            chapter_index: 章节索引（用于 fallback）
            first_text_line_info: (标题文本, 是否为引号候选)

        Returns:
            章节标题字符串
        """
        first_text_line, is_quoted = first_text_line_info

        # 1. 优先使用 TOC 标题
        if spine_id in self.toc_map:
            title = self.toc_map[spine_id].strip()
            if title:
                self._last_toc_title = title  # 更新上一个 TOC 标题
                return title

        # 2. 继承上一个 TOC 标题（同一章的后续部分）
        if self._last_toc_title:
            return self._last_toc_title

        # 3. 尝试从文档的 h1-h6 标签获取
        header_tag = soup.find(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
        if header_tag:
            title = header_tag.get_text().strip()
            title = re.sub(r'\s+', ' ', title)  # 换行符替换为空格
            if title:
                return title

        # 4. 使用正文首行提取结果
        if first_text_line:
            # 引号候选不截断，其他策略才截断
            if is_quoted:
                return first_text_line
            return first_text_line[:EPUB_MAX_TITLE_LENGTH]

        # 5. Fallback
        return f"Chapter {chapter_index + 1}"

    @staticmethod
    def _normalize_archive_path(path: str) -> str:
        # ebooklib resource names are already decoded; '%' is literal here.
        return posixpath.normpath(path.replace("\\", "/")).lstrip("/")

    def _extract_all_images(self):
        """Store images by package path; ambiguous basenames never alias."""
        self.image_basename_map: Dict[str, Optional[str]] = {}
        for item in self.book.get_items():
            if item.get_type() not in {ebooklib.ITEM_IMAGE, ebooklib.ITEM_COVER}:
                continue
            path = self._normalize_archive_path(item.get_name())
            extension = posixpath.splitext(path)[1]
            filename = hashlib.sha256(path.encode("utf-8")).hexdigest() + extension
            with open(os.path.join(self.image_output_dir, filename), "wb") as output:
                output.write(item.get_content())
            web_path = f"{self.web_image_prefix}/{filename}"
            self.images_map[path] = web_path
            basename = posixpath.basename(path)
            if basename in self.image_basename_map:
                self.image_basename_map[basename] = None
            else:
                self.image_basename_map[basename] = web_path

    def _find_declared_cover_image(self) -> Optional[str]:
        """Resolve EPUB 2 metadata IDs and EPUB 3 cover-image resources."""
        metadata = self.book.get_metadata("OPF", "meta") + self.book.get_metadata("OPF", "cover")
        for _, attributes in metadata:
            if attributes.get("name") != "cover":
                continue
            item = self.book.get_item_with_id(attributes.get("content"))
            if item is not None:
                url = self.images_map.get(self._normalize_archive_path(item.get_name()))
                if url:
                    return url
        for item in self.book.get_items_of_type(ebooklib.ITEM_COVER):
            url = self.images_map.get(self._normalize_archive_path(item.get_name()))
            if url:
                return url
        return None

    def _find_image_web_path(self, src_path: str, document_path: str = "") -> Optional[str]:
        """Resolve against the containing XHTML before package/fallback lookup."""
        if not src_path:
            return None
        reference = urlsplit(src_path.replace("\\", "/"))
        if reference.scheme or reference.netloc or not reference.path:
            return None
        # Only URI references need percent decoding, exactly once.
        path = self._normalize_archive_path(unquote(reference.path))
        if document_path and not reference.path.startswith("/"):
            directory = posixpath.dirname(self._normalize_archive_path(document_path))
            relative_path = posixpath.normpath(posixpath.join(directory, path))
            if relative_path in self.images_map:
                return self.images_map[relative_path]
        if path in self.images_map:
            return self.images_map[path]
        return self.image_basename_map.get(posixpath.basename(path))

    @staticmethod
    def _retain_text_node(node: NavigableString) -> bool:
        """Keep horizontal inline gaps while discarding XHTML indentation."""
        value = str(node)
        if value.strip():
            return True
        if not value or any(character in value for character in "\r\n\t"):
            return False
        parent = node.parent
        if parent is None or parent.name in {"body", "html", "[document]"}:
            return False
        blocks = {"p", "div", "h1", "h2", "h3", "blockquote", "li"}
        # Whitespace between block siblings is formatting, even on one line.
        return not any(
            isinstance(sibling, Tag) and sibling.name in blocks
            for sibling in (node.previous_sibling, node.next_sibling)
        )

    @staticmethod
    def _normalize_text_with_boundary_map(text: str) -> tuple[str, List[int]]:
        """Apply reader normalization and map raw boundaries to output ones.

        Source-content offsets must use the exact normalized character space
        that reader text uses.  The map has one entry for every boundary in
        ``text`` so parser-captured ruby and structural-boundary offsets can
        be moved deliberately instead of being repaired later by searching or
        replacing text in the projection layer.
        """
        normalized: List[str] = []
        boundary_map = [0] * (len(text) + 1)
        index = 0

        while index < len(text):
            boundary_map[index] = len(normalized)
            character = text[index]
            if character == '\u200b':
                boundary_map[index + 1] = len(normalized)
                index += 1
                continue

            if character == '\n':
                run_end = index
                while run_end < len(text) and text[run_end] == '\n':
                    run_end += 1
                retained_count = min(run_end - index, 2)
                normalized.extend('\n' for _ in range(retained_count))
                for boundary in range(index + 1, run_end + 1):
                    boundary_map[boundary] = len(normalized) - max(
                        retained_count - (boundary - index), 0
                    )
                index = run_end
                continue

            normalized.append(character)
            boundary_map[index + 1] = len(normalized)
            index += 1

        return ''.join(normalized), boundary_map

    def _clean_text(self, text: str) -> str:
        """日语文本清洗"""
        return self._normalize_text_with_boundary_map(text)[0]

    def _safe_split_text(self, text: str) -> List[str]:
        """针对日语长文本的安全切分"""
        if len(text) <= self.max_chunk_size:
            return [text]

        chunks = []
        current_buf = ""
        # 优先按句号切分，其次是感叹号等
        sentences = re.split(r'([。！？?!\n])', text)

        for part in sentences:
            current_buf += part
            # 只有当包含标点且长度足够时才切分
            if len(current_buf) > self.max_chunk_size:
                chunks.append(current_buf)
                current_buf = ""

        if current_buf:
            chunks.append(current_buf)
        return chunks

    def _process_node(self, node, text_buffer: List[str], segments: List[ContentSegment], document_path: str = ""):
        """
        递归 DOM 遍历，关键在于处理 Ruby 和 Block 元素
        """
        # 1. 忽略标签：注音(rt/rp)、脚本、样式、注释
        if isinstance(node, Tag) and node.name in ['rt', 'rp', 'script', 'style']:
            return

        if isinstance(node, Comment): return

        # 2. 文本节点
        if isinstance(node, NavigableString):
            text = str(node)
            if self._retain_text_node(node):
                text_buffer.append(text)
            return

        # 3. 元素节点 (Tag)
        if isinstance(node, Tag):
            # --- 图片处理 ---
            if node.name in ["img", "image"]:
                # 结算文本
                self._flush_buffer(text_buffer, segments)

                # 寻找 src
                src = node.get('src') or node.get('xlink:href')
                if src:
                    web_path = self._find_image_web_path(str(src), document_path)
                    if web_path:
                        alt = node.get('alt', '')
                        segments.append(ImageSegment(src_path=web_path, alt=str(alt)))
                return # 图片处理完直接返回，不遍历其子节点

            # --- 换行处理 ---
            # 遇到 br 强行换行
            if node.name == 'br':
                text_buffer.append("\n")

            # --- 块级元素前后加换行 ---
            is_block = node.name in ['p', 'div', 'h1', 'h2', 'h3', 'blockquote', 'li']

            # 递归前：如果是块级元素，确保 buffer 尾部有换行（避免粘连）
            if is_block and text_buffer and not text_buffer[-1].endswith('\n'):
                text_buffer.append("\n")

            # ** 递归遍历子节点 **
            for child in node.children:
                self._process_node(child, text_buffer, segments, document_path)

            # 递归后：块级元素结束，补换行
            if is_block and text_buffer and not text_buffer[-1].endswith('\n'):
                text_buffer.append("\n")

    @staticmethod
    def _ruby_base_text(node: Tag) -> str:
        """Return ruby base text while excluding pronunciation/fallback nodes."""
        pieces: List[str] = []

        def visit(child: Any) -> None:
            if isinstance(child, NavigableString):
                value = str(child)
                # EPUB writers often pretty-print <rb> children with
                # indentation nodes. Those nodes are markup whitespace, not
                # ruby base text and must not shift the captured span.
                if LightNovelParser._retain_text_node(child):
                    pieces.append(value)
            elif isinstance(child, Tag) and child.name not in {"rt", "rp"}:
                for descendant in child.children:
                    visit(descendant)

        for child in node.children:
            visit(child)
        return "".join(pieces)

    @staticmethod
    def _ruby_reading_raw(node: Tag) -> str:
        return "".join(rt.get_text() for rt in node.find_all("rt"))

    def _extract_source_document(self, root: Tag, document_id: str, spine_index: int) -> Dict[str, Any]:
        """Build document-relative source text and immutable ruby hints.

        Offsets are Python Unicode code-point offsets into this exact ``text``
        value.  The display parser may later split or discard TextSegment.text;
        this document remains the stable coordinate space for reconstruction.
        """
        buffer: List[str] = []
        ruby_hints: List[Dict[str, Any]] = []
        pending_ruby_hints: List[Dict[str, Any]] = []
        structural_boundaries: List[Dict[str, Any]] = []
        source_parts: List[str] = []
        source_offset = 0

        def offset() -> int:
            return sum(len(part) for part in buffer)

        def flush_source_buffer() -> bool:
            """Emit one source text buffer at the same boundary as reader flushes."""
            nonlocal source_offset
            if not buffer:
                return False

            source_text, boundary_map = self._normalize_text_with_boundary_map("".join(buffer))
            if not source_text.strip():
                buffer.clear()
                pending_ruby_hints.clear()
                return False

            for hint in pending_ruby_hints:
                raw_start = hint["start_offset"]
                raw_end = hint["end_offset"]
                hint["start_offset"] = source_offset + boundary_map[raw_start]
                hint["end_offset"] = source_offset + boundary_map[raw_end]
                # ``base_text`` is defined by source-content coordinates. Keep
                # the author-emitted base when normalization removes U+200B.
                hint["base_text_raw"] = hint["base_text"]
                hint["base_text"] = source_text[
                    boundary_map[raw_start]:boundary_map[raw_end]
                ]

            ruby_hints.extend(pending_ruby_hints)
            pending_ruby_hints.clear()
            source_parts.append(source_text)
            source_offset += len(source_text)
            buffer.clear()
            return True

        def visit(node: Any) -> None:
            nonlocal source_offset
            if isinstance(node, Comment):
                return
            if isinstance(node, NavigableString):
                value = str(node)
                if self._retain_text_node(node):
                    buffer.append(value)
                return
            if not isinstance(node, Tag) or node.name in {"rt", "rp", "script", "style"}:
                return
            if node.name in {"img", "image"}:
                # The reader flushes its text buffer before an image. Source
                # emission must do the same so newline normalization never
                # crosses this structural boundary.
                flush_source_buffer()
                if source_parts:
                    structural_boundaries.append({
                        "offset": source_offset,
                        "end_offset": source_offset + 1,
                        "text": "\n",
                        "reason": "image",
                    })
                    source_parts.append("\n")
                    source_offset += 1
                return
            if node.name == "ruby":
                base_text = self._ruby_base_text(node)
                reading_raw = self._ruby_reading_raw(node)
                start_offset = offset()
                buffer.append(base_text)
                end_offset = offset()
                if base_text and reading_raw:
                    pending_ruby_hints.append({
                        "start_offset": start_offset,
                        "end_offset": end_offset,
                        "base_text": base_text,
                        "reading_raw": reading_raw,
                        "markup": {
                            "element": "ruby",
                            "has_rb": node.find("rb") is not None,
                            "has_rp": node.find("rp") is not None,
                        },
                        "provenance": "epub_ruby",
                    })
                return
            if node.name == "br":
                buffer.append("\n")
                return

            is_block = node.name in ["p", "div", "h1", "h2", "h3", "blockquote", "li"]
            if is_block and buffer and not buffer[-1].endswith("\n"):
                buffer.append("\n")
            for child in node.children:
                visit(child)
            if is_block and buffer and not buffer[-1].endswith("\n"):
                buffer.append("\n")

        for child in root.children:
            visit(child)
        flush_source_buffer()

        return {
            "document_id": document_id,
            "spine_index": spine_index,
            "text": "".join(source_parts),
            "ruby_hints": ruby_hints,
            "structural_boundaries": structural_boundaries,
        }

    def _flush_buffer(self, buffer: List[str], segments: List[ContentSegment]):
        if not buffer:
            return

        raw_text = "".join(buffer)
        cleaned_text = self._clean_text(raw_text)

        if not cleaned_text.strip():
            buffer.clear()
            return

        chunks = self._safe_split_text(cleaned_text)
        for chunk in chunks:
            segments.append(TextSegment(chunk))

        buffer.clear()

    def _extract_first_text_line(self, soup: BeautifulSoup) -> tuple[Optional[str], bool]:
        """
        提取正文第一行文本（用于作为章节标题的 fallback）

        返回: (标题文本, 是否为引号候选)

        策略优先级：
        1. 检测引号标题 『...』 或 「...」
        2. 第一个标点符号后向前找换行符
        3. 传统的首行截取（降级）
        """
        if not soup.body:
            return None, False

        # 获取正文所有文本（保留换行结构）
        body_text = soup.body.get_text(separator='\n', strip=False)

        # ========== 策略1: 检测引号标题 ==========
        # 匹配 『...』 或 「...」
        for quote_start, quote_end in [('『', '』'), ('「', '」')]:
            start_idx = body_text.find(quote_start)
            if start_idx != -1:
                end_idx = body_text.find(quote_end, start_idx + 1)
                if end_idx != -1:
                    title = body_text[start_idx:end_idx + 1]
                    title = re.sub(r'\s+', ' ', title).strip()  # 换行符替换为空格
                    if title:  # 只需要防止为空
                        return title, True  # 仅作为标题标签，不修改正文

        # ========== 策略2: 第一个标点符号 + 向前找换行符 ==========
        # 常见日文/中文标点
        punctuation = ['。', '！', '？', '！', '？', '.', '!', '?', '．', '｡', '…']

        for i, char in enumerate(body_text):
            if char in punctuation:
                # 从标点符号位置向前找第一个换行符
                newline_before = body_text.rfind('\n', 0, i)
                if newline_before == -1:
                    newline_before = 0
                else:
                    newline_before += 1  # 跳过换行符本身

                # 提取标题
                title = body_text[newline_before:i + 1].strip()
                title = re.sub(r'\s+', ' ', title)  # 换行符替换为空格

                # 边界检查：不为空且不是纯数字
                if title and not title.isdigit():
                    return title, False

        # ========== 策略3: 降级 - 传统的首行截取 ==========
        lines = body_text.split('\n')
        for line in lines:
            line = line.strip()
            if line and not line.isdigit():
                line = re.sub(r'\s+', ' ', line)
                return line[:EPUB_MAX_TITLE_LENGTH], False

        return None, False

    def parse(self) -> List[Chapter]:
        """
        解析 EPUB，返回章节列表

        注意：
        - 返回的每个 Chapter 对应 EPUB spine 中的一个 item
        - 同一章节可能跨越多个 spine item（如 p-001, p-002, p-003 都是同一章）
        - 这种情况下，相邻的 Chapter 会有相同的 title（通过标题继承实现）
        - **章节合并显示由前端处理**，后端保持原始 spine 结构以便精确定位

        返回：
            List[Chapter]: 章节列表，每个章节的 index 对应 spine 索引
        """
        chapters = []
        # spine 格式通常是 ('item_id', 'yes/no')

        for i, spine_item in enumerate(self.book.spine):
            if isinstance(spine_item, tuple):
                item_id = spine_item[0]
            else:
                item_id = spine_item
            item = self.book.get_item_with_id(item_id)

            if not item or item.get_type() != ebooklib.ITEM_DOCUMENT:
                continue

            # 使用 lxml 解析器，速度更快，容错更好
            # item.get_content() 返回 bytes，BS4 会自动探测编码，通常不需要手动 decode
            soup = BeautifulSoup(item.get_content(), 'lxml')

            # 提取正文第一行（用于标题 fallback）
            first_text_line, is_quoted = self._extract_first_text_line(soup)

            # Titles are labels only: fallback heuristics must never mutate prose.

            # 使用组合策略提取章节标题
            title_str = self._extract_chapter_title(
                spine_id=item_id,
                soup=soup,
                chapter_index=i,
                first_text_line_info=(first_text_line, is_quoted)
            )

            current_chapter = Chapter(title_str, i)
            text_buffer = []

            # 从 body 遍历
            root = soup.body if soup.body else soup
            self.source_documents.append(self._extract_source_document(root, item_id, i))
            for child in root.children:
                self._process_node(child, text_buffer, current_chapter.segments, item.get_name())

            self._flush_buffer(text_buffer, current_chapter.segments)

            if current_chapter.segments:
                current_chapter.source_document_segment_counts.append(
                    (item_id, len(current_chapter.segments))
                )
                chapters.append(current_chapter)

        return chapters
