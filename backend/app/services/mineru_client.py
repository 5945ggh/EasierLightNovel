# app/services/mineru_client.py
"""
MinerU API 客户端

用于与 MinerU 云端 API 交互，将 PDF 转换为 Markdown + 图片

文档: https://mineru.net/
"""
import os
import logging
import time
import requests
from typing import Optional, Callable

from app.config import (
    MINERU_API_TOKEN,
    MINERU_MODEL_VERSION,
    MINERU_LANGUAGE,
    MINERU_POLL_INTERVAL,
    MINERU_MAX_RETRIES
)

logger = logging.getLogger(__name__)


class MinerUError(Exception):
    """MinerU API 错误基类"""
    pass


class MinerUUploadError(MinerUError):
    """上传失败错误"""
    pass


class MinerUProcessingError(MinerUError):
    """处理失败错误"""
    pass


class MinerUTimeoutError(MinerUError):
    """处理超时错误"""
    pass


class MinerUClient:
    """
    MinerU API 客户端

    文档: https://mineru.net/
    """

    API_BASE = "https://mineru.net/api/v4"

    # 不应重试的 HTTP 状态码
    NON_RETRYABLE_STATUS_CODES = {401, 403, 404, 400, 422, 409, 410}
    # 需要更长等待时间的状态码（如 429 限流）
    LONG_RETRY_STATUS_CODES = {429}

    def __init__(self, api_token: Optional[str] = None):
        """
        初始化客户端

        Args:
            api_token: MinerU API Token，如果为 None 则从配置读取
        """
        self.api_token = api_token or MINERU_API_TOKEN
        if not self.api_token:
            raise ValueError("MinerU API token 未配置，请在 config/user.json 中设置 pdf.mineru_api_token")

        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json"
        })

    def _request_json(self, method: str, url: str, **kwargs) -> dict:
        """
        统一的 JSON 请求处理

        Args:
            method: HTTP 方法
            url: 请求 URL
            **kwargs: 传递给 requests 的参数

        Returns:
            响应的 JSON 数据（data 部分）

        Raises:
            MinerUProcessingError: 所有请求失败（网络、HTTP、JSON、业务错误）
        """
        try:
            resp = self.session.request(method, url, timeout=kwargs.pop("timeout", 30), **kwargs)
        except requests.RequestException as e:
            raise MinerUProcessingError(f"网络请求失败: {type(e).__name__}: {e}") from e

        # 检查 HTTP 状态码
        if resp.status_code in self.NON_RETRYABLE_STATUS_CODES:
            # 尝试读取响应内容帮助调试
            resp_text = resp.text[:200] if resp.text else "(无响应体)"
            raise MinerUProcessingError(
                f"请求失败（不可重试）: HTTP {resp.status_code}, 响应: {resp_text}"
            )
        try:
            resp.raise_for_status()
        except requests.HTTPError as e:
            resp_text = resp.text[:200] if resp.text else "(无响应体)"
            raise MinerUProcessingError(
                f"HTTP 错误: {e.response.status_code}, 响应: {resp_text}"
            ) from e

        # 解析 JSON
        try:
            data = resp.json()
        except Exception as e:
            raise MinerUProcessingError(f"响应解析失败（非 JSON）: {e}") from e

        # 检查业务状态码
        if data.get("code") != 0:
            msg = data.get("msg", "未知错误")
            trace_id = data.get("trace_id", "")
            raise MinerUProcessingError(f"MinerU API 错误: {msg} (trace_id: {trace_id})")

        return data.get("data", {})

    def upload_and_wait(
        self,
        pdf_path: str,
        model_version: Optional[str] = None,
        language: Optional[str] = None,
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> str:
        """
        上传 PDF 并等待处理完成

        注意：当前实现仅支持单文件上传。

        Args:
            pdf_path: PDF 文件路径
            model_version: 模型版本 (vlm/pipeline)，默认从配置读取
            language: 文档语言 (ch/japan 等)，默认从配置读取
            progress_callback: 进度回调 (current_page, total_pages)

        Returns:
            batch_id: 批次 ID

        Raises:
            MinerUUploadError: 上传失败
            MinerUProcessingError: 处理失败
            MinerUTimeoutError: 处理超时
        """
        filename = os.path.basename(pdf_path)
        data_id = os.urandom(16).hex()

        # 使用配置的默认值
        model_version = model_version or MINERU_MODEL_VERSION
        language = language or MINERU_LANGUAGE

        logger.info(f"申请 MinerU 上传链接: {filename}, model={model_version}, language={language}")

        # 1. 申请上传链接
        try:
            data = self._request_json(
                "POST",
                f"{self.API_BASE}/file-urls/batch",
                json={
                    "files": [{"name": filename, "data_id": data_id}],
                    "model_version": model_version,
                    "language": language
                }
            )
        except MinerUProcessingError as e:
            raise MinerUUploadError(f"申请上传链接失败: {e}")

        batch_id = data.get("batch_id")
        # 兼容字段名：file_urls 或 files
        urls = data.get("file_urls") or data.get("files", [])
        if not batch_id or not urls:
            raise MinerUUploadError("MinerU API 返回数据格式异常：缺少 batch_id 或上传链接")

        upload_url = urls[0]

        logger.info(f"上传链接获取成功，batch_id={batch_id}")

        # 2. 上传文件（用裸 requests，不带 Authorization 头）
        logger.info(f"开始上传文件: {pdf_path}")
        try:
            with open(pdf_path, "rb") as f:
                upload_resp = requests.put(upload_url, data=f, timeout=300)
        except (IOError, requests.RequestException) as e:
            raise MinerUUploadError(f"文件上传失败: {e}")

        if upload_resp.status_code not in (200, 201):
            raise MinerUUploadError(f"文件上传失败: HTTP {upload_resp.status_code}")

        logger.info(f"文件上传成功，开始轮询处理状态")

        # 3. 轮询等待完成
        return self._poll_for_completion(batch_id, progress_callback)

    def _poll_for_completion(
        self,
        batch_id: str,
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> str:
        """
        轮询任务状态直到完成

        Args:
            batch_id: 批次 ID
            progress_callback: 进度回调 (current_page, total_pages)

        Returns:
            batch_id: 完成的批次 ID

        Raises:
            MinerUProcessingError: 处理失败
            MinerUTimeoutError: 处理超时
        """
        for attempt in range(MINERU_MAX_RETRIES):
            try:
                data = self._get_batch_result(batch_id)

                # 获取解析结果列表
                results = data.get("extract_result", [])
                if not results:
                    logger.debug(f"暂无结果，attempt {attempt + 1}")
                    time.sleep(MINERU_POLL_INTERVAL)
                    continue

                # 单文件上传取第一个结果
                r0 = results[0]
                state = r0.get("state")

                # 报告进度
                if progress_callback and state == "running":
                    prog = r0.get("extract_progress", {})
                    current = int(prog.get("extracted_pages", 0))
                    total = int(prog.get("total_pages", 0))
                    if total > 0:
                        try:
                            progress_callback(current, total)
                        except Exception:
                            logger.exception("progress_callback 异常")
                        logger.debug(f"处理进度: {current}/{total}")

                if state == "done":
                    logger.info(f"MinerU 处理完成: {batch_id}")
                    return batch_id
                elif state == "failed":
                    error_msg = r0.get("err_msg", "未知错误")
                    raise MinerUProcessingError(f"解析失败: {error_msg}")
                elif state in ("pending", "running", "waiting-file", "converting"):
                    # 继续等待
                    time.sleep(MINERU_POLL_INTERVAL)
                else:
                    logger.warning(f"未知状态: {state}")
                    time.sleep(MINERU_POLL_INTERVAL)

            except MinerUProcessingError:
                raise
            except Exception:
                logger.exception("轮询异常")
                time.sleep(MINERU_POLL_INTERVAL)

        raise MinerUTimeoutError(f"处理超时 (超过 {MINERU_MAX_RETRIES * MINERU_POLL_INTERVAL} 秒)")

    def _get_batch_result(self, batch_id: str) -> dict:
        """
        获取批次结果（内部方法）

        Args:
            batch_id: 批次 ID

        Returns:
            data 字典

        Raises:
            MinerUProcessingError: 获取失败
        """
        return self._request_json(
            "GET",
            f"{self.API_BASE}/extract-results/batch/{batch_id}"
        )

    def get_result_url(self, batch_id: str) -> str:
        """
        获取已完成任务的下载链接

        Args:
            batch_id: 批次 ID

        Returns:
            full_zip_url: 结果 ZIP 文件的下载链接

        Raises:
            MinerUProcessingError: 获取失败
        """
        data = self._get_batch_result(batch_id)

        results = data.get("extract_result", [])
        if not results:
            raise MinerUProcessingError("未找到解析结果")

        r0 = results[0]
        if r0.get("state") != "done":
            raise MinerUProcessingError(f"任务未完成: {r0.get('state')}")

        zip_url = r0.get("full_zip_url")
        if not zip_url:
            raise MinerUProcessingError("结果中缺少下载链接")

        return zip_url

    def download_result(self, batch_id: str, output_dir: str) -> str:
        """
        下载已完成任务的结果

        Args:
            batch_id: 批次 ID
            output_dir: 输出目录

        Returns:
            zip_path: 下载的 ZIP 文件路径

        Raises:
            MinerUProcessingError: 下载失败
        """
        zip_url = self.get_result_url(batch_id)
        zip_path = os.path.join(output_dir, f"{batch_id}.zip")

        # 确保输出目录存在且可写
        if os.path.exists(output_dir) and not os.path.isdir(output_dir):
            raise MinerUProcessingError(f"输出路径不是目录: {output_dir}")
        os.makedirs(output_dir, exist_ok=True)

        # 检查是否可写
        if not os.access(output_dir, os.W_OK):
            raise MinerUProcessingError(f"输出目录不可写: {output_dir}")

        logger.info(f"开始下载结果: batch_id={batch_id}")

        try:
            # 使用裸 requests（不带 Authorization 头访问 presigned URL）
            resp = requests.get(zip_url, timeout=300, stream=True)
            resp.raise_for_status()

            with open(zip_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:  # 过滤 keep-alive 空包
                        f.write(chunk)

            logger.info(f"结果下载完成: {zip_path}")
            return zip_path

        except (requests.RequestException, IOError) as e:
            raise MinerUProcessingError(f"下载失败: {e}")

    def get_batch_status(self, batch_id: str) -> dict:
        """
        获取批次状态（不等待）

        注意：当前实现仅支持单文件上传，多文件上传时会返回第一个结果。

        Args:
            batch_id: 批次 ID

        Returns:
            status: 状态字典
        """
        try:
            data = self._get_batch_result(batch_id)
            results = data.get("extract_result", [])
            if results:
                return results[0]
            # extract_result 为空通常是异常情况，返回明确状态
            return {"state": "unknown", "error": "missing extract_result", "data_keys": list(data.keys())}
        except MinerUProcessingError as e:
            return {"state": "error", "error": str(e)}
