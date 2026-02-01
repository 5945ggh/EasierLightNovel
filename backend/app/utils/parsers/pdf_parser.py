# app/utils/parsers/pdf_parser.py
"""
PDF 解析器

使用 MinerU API 将 PDF 转换为 Markdown + 图片，
然后通过 MarkdownParser 解析为 Chapter/Segment 结构
"""
import os
import re
import shutil
import uuid
import zipfile
import logging
from typing import List, Optional, Callable

from app.utils.domain import Chapter
from app.utils.parsers.markdown_parser import MarkdownParser
from app.services.mineru_client import MinerUClient

logger = logging.getLogger(__name__)


class PDFParseError(Exception):
    """PDF 解析错误"""
    pass


class ParserProgress:
    """解析进度回调数据"""
    def __init__(self, stage: str, current: int, total: int, message: str = ""):
        self.stage = stage      # "uploading", "processing", "downloading", "parsing"
        self.current = current
        self.total = total
        self.message = message


class PDFParser:
    """
    PDF 解析器 (使用 MinerU API + MarkdownParser)

    流程:
    1. 上传 PDF 到 MinerU
    2. 轮询等待处理完成
    3. 下载结果 ZIP
    4. 解压并提取 Markdown + 图片
    5. 调用 MarkdownParser 解析

    注意：当前实现仅支持单文件上传。
    """

    # 允许的图片扩展名
    ALLOWED_IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp'}

    def __init__(
        self,
        file_path: str,
        book_id: str,
        output_dir: str,
        api_token: Optional[str] = None,
        keep_temp: bool = False
    ):
        """
        初始化 PDF 解析器

        Args:
            file_path: PDF 文件路径
            book_id: 书籍 UUID
            output_dir: 输出目录
            api_token: MinerU API Token（可选，默认从配置读取）
            keep_temp: 是否保留临时目录（用于调试）
        """
        self.file_path = file_path
        self.book_id = book_id
        self.output_dir = output_dir
        self.keep_temp = keep_temp

        # 创建输出目录（图片最终存放位置）
        self.image_output_dir = os.path.join(output_dir, book_id, "images")
        os.makedirs(self.image_output_dir, exist_ok=True)

        # 创建唯一临时目录（避免并发冲突和数据污染）
        temp_id = uuid.uuid4().hex[:8]
        self.temp_dir = os.path.join(output_dir, book_id, "temp", temp_id)
        os.makedirs(self.temp_dir, exist_ok=True)

        self.web_image_prefix = f"/static/books/{book_id}/images"
        self.mineru_client = MinerUClient(api_token)

    def extract_metadata(self) -> tuple[str, Optional[str], Optional[str]]:
        """
        从文件名提取元数据

        Returns:
            (title, author, cover_url)
        """
        filename = os.path.basename(self.file_path)
        title = os.path.splitext(filename)[0]
        return title, None, None

    def parse(self, progress_callback: Optional[Callable] = None) -> List[Chapter]:
        """
        解析 PDF 文档

        Args:
            progress_callback: 进度回调函数

        Returns:
            章节列表

        Raises:
            PDFParseError: 解析失败
        """
        def _report(stage: str, current: int, total: int, msg: str = ""):
            if progress_callback:
                progress_callback(ParserProgress(stage, current, total, msg))

        try:
            # 1. 上传并等待处理
            _report("uploading", 0, 1, "上传 PDF 到 MinerU")
            batch_id = self.mineru_client.upload_and_wait(
                self.file_path,
                progress_callback=lambda c, t: _report("processing", c, t, f"解析页面 {c}/{t}")
            )

            # 2. 下载结果
            _report("downloading", 0, 1, "下载解析结果")
            zip_path = self.mineru_client.download_result(batch_id, self.temp_dir)

            # 3. 解析 ZIP 内容
            _report("parsing", 0, 1, "解析内容")
            return self._parse_result_zip(zip_path)
        except PDFParseError:
            # 已是 PDFParseError，直接重新抛出
            raise
        except Exception as e:
            # 其他异常统一包装成 PDFParseError，保留原始异常链
            raise PDFParseError(
                f"PDF 解析失败 (book_id={self.book_id}, file={self.file_path}): {e}"
            ) from e
        finally:
            # 自动清理临时文件
            if not self.keep_temp:
                self.cleanup()

    def _parse_result_zip(self, zip_path: str) -> List[Chapter]:
        """
        解析 MinerU 返回的 ZIP 文件

        ZIP 结构可能为:
        - md/ (markdown 文件目录)
        - images/ (图片目录)
        - 或直接在根目录

        Args:
            zip_path: ZIP 文件路径

        Returns:
            章节列表

        Raises:
            PDFParseError: 解析失败
        """
        logger.info(f"解压 ZIP 文件: {zip_path}")

        # 安全解压（防止 Zip Slip 漏洞）
        self._safe_extract(zip_path)

        # 查找并合并 markdown 文件
        md_content = self._collect_markdown_content()

        # 复制图片到输出目录
        self._copy_images()

        # 调用 MarkdownParser 解析
        logger.info("调用 MarkdownParser 解析内容")
        parser = MarkdownParser(
            markdown_text=md_content,
            book_id=self.book_id,
            web_image_prefix=self.web_image_prefix
        )
        chapters = parser.parse()
        logger.info(f"解析完成，共 {len(chapters)} 章")

        return chapters

    def _safe_extract(self, zip_path: str) -> None:
        """
        安全解压 ZIP 文件（防止 Zip Slip 漏洞）

        Args:
            zip_path: ZIP 文件路径

        Raises:
            PDFParseError: 解压失败或检测到路径穿越
        """
        # 用于检测重复文件名覆盖
        extracted_files = set()
        duplicate_count = 0

        try:
            with zipfile.ZipFile(zip_path, 'r') as zf:
                for member in zf.namelist():
                    # 跳过目录（只处理文件）
                    if member.endswith('/'):
                        continue

                    # 计算实际路径，防止穿越攻击
                    member_path = os.path.normpath(member)

                    # P1: 检查 Windows 驱动器路径（如 C:\...）
                    drive, _ = os.path.splitdrive(member_path)
                    if drive:
                        raise PDFParseError(f"检测到不安全的绝对路径（包含驱动器）: {member}")

                    # 检查明显的路径穿越特征
                    if member_path.startswith('..') or member_path.startswith('/') or member_path.startswith('\\'):
                        raise PDFParseError(f"检测到不安全的 ZIP 路径: {member}")

                    # P0: 使用 commonpath 验证目标路径在 temp_dir 内（修复 startswith 前缀误判）
                    target_path = os.path.realpath(os.path.join(self.temp_dir, member_path))
                    base_path = os.path.realpath(self.temp_dir)

                    try:
                        common = os.path.commonpath([base_path, target_path])
                    except ValueError:
                        # Windows 上不同驱动器会抛出 ValueError
                        raise PDFParseError(f"检测到路径穿越攻击: {member} -> {target_path}")

                    if common != base_path:
                        raise PDFParseError(f"检测到路径穿越攻击: {member} -> {target_path}")

                    # P1: 检测重复文件名覆盖
                    if target_path in extracted_files:
                        duplicate_count += 1
                        logger.warning(f"ZIP 中存在重复文件，后者覆盖前者: {member} -> {target_path}")
                    else:
                        extracted_files.add(target_path)

                    # 确保目标目录存在
                    target_dir = os.path.dirname(target_path)
                    if target_dir:
                        os.makedirs(target_dir, exist_ok=True)

                    # 解压文件
                    with zf.open(member) as source, open(target_path, 'wb') as target:
                        shutil.copyfileobj(source, target)

                if duplicate_count > 0:
                    logger.warning(f"解压完成，共发现 {duplicate_count} 个重复文件被覆盖")

        except zipfile.BadZipFile as e:
            raise PDFParseError(f"ZIP 文件损坏: {e}") from e
        except (IOError, OSError) as e:
            raise PDFParseError(f"解压失败: {e}") from e

    def _collect_markdown_content(self) -> str:
        """
        收集 ZIP 中的所有 Markdown 内容

        递归查找所有 .md 文件，按自然排序合并

        Returns:
            合并后的 Markdown 内容

        Raises:
            PDFParseError: 未找到 Markdown 内容或所有文件读取失败
        """
        md_files = []

        # 递归查找所有 .md 文件
        for root, _dirs, files in os.walk(self.temp_dir):
            for f in files:
                if f.endswith('.md'):
                    md_files.append(os.path.join(root, f))

        if not md_files:
            raise PDFParseError(
                f"ZIP 文件中未找到 Markdown 内容 (temp_dir: {self.temp_dir})"
            )

        # P2: 使用相对路径进行自然排序（避免完整路径前缀影响排序）
        def natural_key(path: str) -> list:
            # 对相对路径做自然排序
            rel_path = os.path.relpath(path, self.temp_dir)
            return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', rel_path)]

        md_files.sort(key=natural_key)
        logger.info(f"找到 {len(md_files)} 个 Markdown 文件")

        # P2: 跟踪读取失败的文件
        failed_count = 0
        failed_files = []

        # 合并所有 Markdown 文件
        md_content = ""
        for md_file in md_files:
            try:
                with open(md_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                    md_content += content + "\n\n"
            except (IOError, UnicodeDecodeError) as e:
                failed_count += 1
                failed_files.append(md_file)
                logger.warning(f"读取文件失败 {md_file}: {e}")

        if failed_count > 0:
            logger.error(f"共有 {failed_count}/{len(md_files)} 个 Markdown 文件读取失败: {failed_files}")

        if not md_content.strip():
            raise PDFParseError("所有 Markdown 文件均为空或读取失败")

        return md_content

    def _copy_images(self):
        """
        将图片从临时目录复制到输出目录

        递归处理 images/ 目录，只复制允许的图片文件
        """
        images_source_dir = os.path.join(self.temp_dir, "images")

        if not os.path.exists(images_source_dir):
            logger.info("未找到 images/ 目录")
            return

        copied_count = 0

        # 递归遍历 images 目录
        for root, _dirs, files in os.walk(images_source_dir):
            for f in files:
                # 跳过隐藏文件
                if f.startswith('.'):
                    continue

                src = os.path.join(root, f)

                # 只复制文件
                if not os.path.isfile(src):
                    continue

                # P2: 检查文件扩展名（无扩展名的文件会被跳过）
                ext = os.path.splitext(f)[1].lower()
                if ext not in self.ALLOWED_IMAGE_EXTENSIONS:
                    logger.debug(f"跳过非图片文件: {f}")
                    continue

                # 计算目标路径（保持目录结构）
                rel_path = os.path.relpath(src, images_source_dir)
                dst = os.path.join(self.image_output_dir, rel_path)

                # 确保目标目录存在
                dst_dir = os.path.dirname(dst)
                os.makedirs(dst_dir, exist_ok=True)

                try:
                    shutil.copy2(src, dst)
                    copied_count += 1
                except (IOError, shutil.Error) as e:
                    logger.warning(f"复制图片失败 {f}: {e}")

        logger.info(f"复制了 {copied_count} 个图片文件")

    def cleanup(self):
        """
        清理临时文件

        如果 keep_temp=True，则保留临时目录用于调试
        """
        if self.keep_temp:
            logger.info(f"保留临时目录（调试用）: {self.temp_dir}")
            return

        try:
            if os.path.exists(self.temp_dir):
                shutil.rmtree(self.temp_dir)
                logger.info(f"已清理临时目录: {self.temp_dir}")
        except Exception as e:
            logger.warning(f"清理临时目录失败: {e}")
