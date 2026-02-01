import os
import re
import uuid
import warnings
from urllib.parse import unquote
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
            first_text_line_info: (标题文本, 是否需要从正文中删除)

        Returns:
            章节标题字符串
        """
        first_text_line, should_remove = first_text_line_info

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
            # 引号标题（should_remove=True）不截断，其他策略才截断
            if should_remove:
                return first_text_line
            return first_text_line[:EPUB_MAX_TITLE_LENGTH]

        # 5. Fallback
        return f"Chapter {chapter_index + 1}"

    def _extract_all_images(self):
        """预先解压所有图片，建立映射关系"""
        for item in self.book.get_items():
            if item.get_type() == ebooklib.ITEM_IMAGE:
                # 获取原始文件名
                raw_name = item.get_name()
                clean_name = os.path.basename(raw_name)

                # 写入磁盘
                save_path = os.path.join(self.image_output_dir, clean_name)
                with open(save_path, "wb") as f:
                    f.write(item.get_content())

                # 记录多种可能的映射方式
                # 1. 纯文件名
                self.images_map[clean_name] = f"{self.web_image_prefix}/{clean_name}"

                # 2. 原始路径（如果引用使用完整路径）
                self.images_map[raw_name] = f"{self.web_image_prefix}/{clean_name}"

                # 3. 处理路径分隔符差异（EPUB 用 /，Windows 用 \）
                # 有些 EPUB 可能使用 Windows 风格路径
                normalized_path = raw_name.replace('\\', '/')
                if normalized_path != raw_name:
                    self.images_map[normalized_path] = f"{self.web_image_prefix}/{clean_name}"

    def _find_image_web_path(self, src_path: str) -> Optional[str]:
        """
        根据引用的 src 路径查找对应的 Web 访问路径
        尝试多种匹配策略：
        1. 直接查找
        2. 只用文件名
        3. 标准化路径分隔符后查找
        """
        if not src_path:
            return None

        # 1. 直接查找
        if src_path in self.images_map:
            return self.images_map[src_path]

        # 2. 尝试只用文件名
        filename = os.path.basename(src_path)
        if filename in self.images_map:
            return self.images_map[filename]

        # 3. 标准化路径分隔符后查找
        normalized_path = src_path.replace('\\', '/')
        if normalized_path in self.images_map:
            return self.images_map[normalized_path]

        # 4. 处理相对路径（如 ../images/cover.jpg）
        # 去除开头的 ./ 或 ../
        if src_path.startswith('./') or src_path.startswith('../'):
            clean_rel = src_path.lstrip('./')
            if clean_rel in self.images_map:
                return self.images_map[clean_rel]

        return None

    def _clean_text(self, text: str) -> str:
        """日语文本清洗"""
        # 移除零宽空格等不可见字符
        text = text.replace('\u200b', '')
        # 移除多余的空白行，但保留段落感
        return re.sub(r'\n{3,}', '\n\n', text)

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

    def _process_node(self, node, text_buffer: List[str], segments: List[ContentSegment]):
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
            # 只有非纯空白才添加，或者它在 pre 标签里
            if text.strip():
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
                    src = unquote(str(src))
                    web_path = self._find_image_web_path(str(src))
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
                self._process_node(child, text_buffer, segments)

            # 递归后：块级元素结束，补换行
            if is_block and text_buffer and not text_buffer[-1].endswith('\n'):
                text_buffer.append("\n")

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

        返回: (标题文本, 是否需要从正文中删除)

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
                        return title, True  # 返回标题，标记需要删除

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

    def _remove_title_from_soup(self, soup: BeautifulSoup, title: str) -> None:
        """
        从 soup 中删除引号标题，避免在正文中重复出现

        策略：找到包含标题文本的文本节点，将其父节点删除
        """
        # 标准化标题用于匹配（去除空格）
        title_normalized = re.sub(r'\s+', '', title)

        # 遍历所有文本节点
        for text_node in list(soup.find_all(string=True)):
            if not text_node.strip():
                continue

            # 标准化节点文本
            node_normalized = re.sub(r'\s+', '', text_node)

            # 检查是否包含标题
            if title_normalized in node_normalized:
                # 找到包含该文本的父元素
                parent = text_node.parent
                if parent:
                    # 如果是纯标题节点（只有标题文本），直接删除
                    # 如果标题是段落的一部分，只删除标题部分
                    parent_text = parent.get_text()
                    parent_text_normalized = re.sub(r'\s+', '', parent_text)

                    # 如果整个元素就是标题，删除整个元素
                    if parent_text_normalized == title_normalized:
                        parent.decompose()
                        break
                    # 如果标题只是元素的一部分，替换文本
                    elif title_normalized in parent_text_normalized:
                        # 用空字符串替换标题文本
                        new_text = re.sub(re.escape(title), '', parent_text, flags=re.IGNORECASE)
                        parent.string = new_text
                        break

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
            first_text_line, should_remove_title = self._extract_first_text_line(soup)

            # 如果检测到引号标题，从正文中删除它
            if should_remove_title and first_text_line:
                self._remove_title_from_soup(soup, first_text_line)

            # 使用组合策略提取章节标题
            title_str = self._extract_chapter_title(
                spine_id=item_id,
                soup=soup,
                chapter_index=i,
                first_text_line_info=(first_text_line, should_remove_title)
            )

            current_chapter = Chapter(title_str, i)
            text_buffer = []

            # 从 body 遍历
            root = soup.body if soup.body else soup
            for child in root.children:
                self._process_node(child, text_buffer, current_chapter.segments)

            self._flush_buffer(text_buffer, current_chapter.segments)

            if current_chapter.segments:
                chapters.append(current_chapter)

        return chapters
