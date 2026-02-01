import os
import re
import logging
from typing import List
from urllib.parse import unquote, urlparse

from app.config import EPUB_MAX_CHUNK_SIZE
from app.utils.domain import Chapter, ContentSegment, TextSegment, ImageSegment

logger = logging.getLogger(__name__)

class MarkdownParser:
    # 默认只对 H1/H2 切章，避免产生过多细碎章节
    DEFAULT_SPLIT_HEADER_LEVEL = 2

    def __init__(self, markdown_text: str, book_id: str, web_image_prefix: str,
                 max_chunk_size: int = EPUB_MAX_CHUNK_SIZE, split_header_level: int = DEFAULT_SPLIT_HEADER_LEVEL):
        """
        Args:
            markdown_text: MinerU 转换后的 Markdown 源码
            book_id: 书籍 UUID（用于日志）
            web_image_prefix: 图片在前端访问的 URL 前缀 (e.g. /static/books/{uuid}/images)
            max_chunk_size: 文本切片最大长度
            split_header_level: 触发切章的最大标题级别（1=仅H1, 2=H1/H2, 默认2）
        """
        self.raw_text = markdown_text
        self.book_id = book_id
        self.web_image_prefix = web_image_prefix.rstrip('/')
        self.max_chunk_size = max_chunk_size
        self.split_header_level = split_header_level

        # 匹配 Markdown 图片: ![alt](src "title"?) - 简化版，详细解析在 _normalize_image_src
        self.img_pattern = re.compile(r'!\[(.*?)\]\((.*?)\)')

        # 匹配 ATX 标题（支持 closing # sequence）: # Title, ## Title ##
        # 参考 CommonMark 规范: https://spec.commonmark.org/0.30/#atx-headings
        self.header_pattern = re.compile(r'^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+[ \t]*)?$')

    def _clean_text(self, text: str) -> str:
        """
        文本清洗 (逻辑与 EpubParser 保持一致)
        MinerU 有时会残留 PDF 中的断行连字符或奇怪的空白
        """
        if not text:
            return ""
        # 移除零宽空格
        text = text.replace('\u200b', '')
        # 移除 PDF 常见的非标准空格
        text = text.replace('\xa0', ' ')
        # 压缩连续换行 (Markdown通常用双换行表示段落，保留它)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text

    def _normalize_image_src(self, src: str) -> str:
        """
        规范化图片 URL

        处理:
        1. 去除 inline title: ![alt](url "title") -> url
        2. 外链直接返回: http://, https://, data:
        3. 本地路径保留 images/ 下的相对结构
        4. 防止路径穿越攻击

        Args:
            src: 从 Markdown 图片语法提取的 src 字符串

        Returns:
            规范化后的图片 URL

        Raises:
            ValueError: 检测到不安全的路径
        """
        src = unquote(src).strip()

        # 1) 处理 inline title：取第一个 token（覆盖 ![alt](url "title")）
        if " " in src:
            src = src.split()[0]

        # 2) 外链直接返回
        scheme = urlparse(src).scheme
        if scheme in ("http", "https", "data"):
            return src

        # 3) 本地路径：尽量保留 images/ 下的相对路径
        src = src.replace("\\", "/")

        # 去掉开头的 ./
        if src.startswith("./"):
            src = src[2:]

        # 提取 images/ 后的相对路径
        if src.startswith("images/"):
            rel = src[len("images/"):]
        else:
            rel = os.path.basename(src)

        # 规范化路径并检查安全性
        rel = os.path.normpath(rel).replace("\\", "/")
        if rel.startswith("../") or rel.startswith("/") or rel == "..":
            raise ValueError(f"不安全的图片路径: {src}")

        return f"{self.web_image_prefix}/{rel}"

    def _safe_split_text(self, text: str) -> List[str]:
        """
        长文本切分 (逻辑与 EpubParser 保持一致)

        严格控制 chunk 大小，避免超出 max_chunk_size
        """
        if len(text) <= self.max_chunk_size:
            return [text]

        chunks = []
        current_buf = ""
        # 优先按句号切分
        sentences = re.split(r'([。！？?!\n])', text)

        for part in sentences:
            # 在加入前判断是否会超长
            if len(current_buf) + len(part) > self.max_chunk_size and current_buf:
                chunks.append(current_buf)
                current_buf = part
            else:
                current_buf += part

        if current_buf:
            chunks.append(current_buf)
        return chunks

    def _process_line_content(self, line: str, segments: List[ContentSegment]):
        """
        核心逻辑：处理单行内的 [文字 -> 图片 -> 文字] 混合流
        """
        last_pos = 0
        # finditer 按顺序查找行内所有图片
        for match in self.img_pattern.finditer(line):
            start, end = match.span()

            # 1. 提取图片前的文字
            if start > last_pos:
                text_part = line[last_pos:start]
                if text_part.strip():
                    segments.append(TextSegment(text_part))

            # 2. 提取图片
            alt = match.group(1)
            src = match.group(2)

            # 使用 _normalize_image_src 规范化图片路径
            try:
                final_src = self._normalize_image_src(src)
            except ValueError as e:
                logger.warning(f"图片路径规范化失败，跳过: {e}")
                continue

            segments.append(ImageSegment(src_path=final_src, alt=alt))

            last_pos = end

        # 3. 提取图片后的剩余文字
        if last_pos < len(line):
            text_part = line[last_pos:]
            if text_part.strip():
                segments.append(TextSegment(text_part))

    def _flush_chapter(self, title: str, index: int, raw_segments: List[ContentSegment]) -> Chapter:
        """
        章节结算：合并细碎的 TextSegment，应用清洗和切分逻辑
        """
        chapter = Chapter(title=title, index=index)
        merged_segments = []
        text_buffer = []

        for seg in raw_segments:
            if isinstance(seg, TextSegment):
                text_buffer.append(seg.text)
            elif isinstance(seg, ImageSegment):
                # 遇到图片，先结算之前的文本缓存
                if text_buffer:
                    full_text = "\n".join(text_buffer) # Markdown 换行通常会被转换为空格，这里视情况保留换行
                    cleaned = self._clean_text(full_text)
                    for chunk in self._safe_split_text(cleaned):
                        merged_segments.append(TextSegment(chunk))
                    text_buffer = []
                
                merged_segments.append(seg)
        
        # 结算剩余文本
        if text_buffer:
            full_text = "\n".join(text_buffer)
            cleaned = self._clean_text(full_text)
            for chunk in self._safe_split_text(cleaned):
                merged_segments.append(TextSegment(chunk))

        chapter.segments = merged_segments
        return chapter

    def parse(self) -> List[Chapter]:
        chapters = []
        lines = self.raw_text.split('\n')

        current_title = "正文"  # 默认标题
        current_raw_segments: List[ContentSegment] = []
        chapter_index = 0

        for line in lines:
            line = line.rstrip()  # 保留左侧缩进，去除右侧换行

            # 1. 检测标题 (视为章节分割)
            header_match = self.header_pattern.match(line)
            if header_match:
                header_level = len(header_match.group(1))
                header_text = header_match.group(2).strip()

                # 只对指定级别及以上的标题切章（默认 H1/H2）
                if header_level <= self.split_header_level:
                    # 只有当暂存区有内容时才结算上一章
                    # 避免文档开头的连续标题导致空章节
                    if current_raw_segments:
                        chapters.append(self._flush_chapter(current_title, chapter_index, current_raw_segments))
                        chapter_index += 1
                        current_raw_segments = []

                    current_title = header_text
                    continue
                else:
                    # 低于阈级的标题当作普通文本处理
                    line = f"\n{header_text}\n"

            # 2. 处理空行（段落边界）
            if not line.strip():
                # 显式添加段落分隔，防止段落粘连
                if current_raw_segments and isinstance(current_raw_segments[-1], TextSegment):
                    # 避免连续多个空行
                    if not current_raw_segments[-1].text.endswith("\n\n"):
                        current_raw_segments.append(TextSegment("\n"))
                continue

            # 3. 处理内容行 (包含图片检测)
            self._process_line_content(line, current_raw_segments)

        # 4. 循环结束，结算最后一章
        if current_raw_segments:
            chapters.append(self._flush_chapter(current_title, chapter_index, current_raw_segments))

        logger.info(f"Markdown 解析完成，共 {len(chapters)} 章")
        return chapters
