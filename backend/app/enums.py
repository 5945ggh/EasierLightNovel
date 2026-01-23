from enum import Enum

class ProcessingStatus(str, Enum):
    """书籍处理状态"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"