import os
import re
import hashlib
import warnings
from urllib.parse import unquote
from typing import List, Dict, Any, Optional
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from bs4.element import NavigableString, Tag, Comment

from app.config import UPLOAD_DIR, STATIC_URL_PREFIX

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

# ================= 数据模型 =================
# 为了保证保证原顺序的图文交错排布, 我们在Chapter内划分出了Segment
# 基本逻辑是: 解析Epub的一个Chapter时, 我们维护一个text cache. 
# 每当解析到图片, 我们就将text cache中的内容结算为一个TextSegment,
# 并将图片内容作为ImageSegment插在后面, 依次类推, 从而保证了顺序.
class ContentSegment:
    """Segment基类"""
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

# ================= 解析逻辑 =================
class LightNovelParser:
    def __init__(self, epub_path: str, output_dir: Optional[str] = None, max_chunk_size: int = 1024):
        """
        :param epub_path: EPUB 文件路径
        :param output_dir: 静态资源输出目录 (用于存解压后的图片)，默认使用 config.UPLOAD_DIR
        :param max_chunk_size: 一个Segment最大文本长度, 受 Sudachi 分词本身的限制不建议设置超过40k
        """
        self.epub_path = epub_path
        self.max_chunk_size = max_chunk_size

        # 如果未指定 output_dir，使用配置文件中的默认值
        if output_dir is None:
            output_dir = UPLOAD_DIR

        # 创建图片存储目录
        self.book_id = self._generate_book_id(epub_path)

        self.image_output_dir = os.path.join(output_dir, self.book_id, "images")
        os.makedirs(self.image_output_dir, exist_ok=True)

        # 使用配置的静态文件 URL 前缀
        self.web_image_prefix = f"{STATIC_URL_PREFIX}/books/{self.book_id}/images"

        self.book = epub.read_epub(epub_path)
        self.images_map = {} # map internal filename -> saved web path
        self._extract_all_images()

    def _generate_book_id(self, path: str) -> str:
        """读取文件头 1KB 生成简单的 Hash ID，用于目录隔离"""
        with open(path, 'rb') as f:
            content_head = f.read(1024)
        return hashlib.md5(content_head).hexdigest()[:12] 
    
    @staticmethod
    def generate_book_id_from_head(path: str) -> str:
        """读取文件头 1KB 生成简单的 Hash ID"""
        with open(path, 'rb') as f:
            content_head = f.read(1024)
        return hashlib.md5(content_head).hexdigest()[:12] 
    
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

    def parse(self) -> List[Chapter]:
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

            # 安全获取标题
            title_str = f"Chapter {i+1}" # TODO: 章节名称提取逻辑待完善
            header_tag = soup.find(['h1', 'h2', 'h3', 'title'])
            if header_tag:
                t = header_tag.get_text().strip()
                if t: title_str = t

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
