from enum import Enum

class ProcessingStatus(str, Enum):
    """书籍处理状态"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    
class JLPTLevel(str, Enum):
    """JLPT 等级"""
    N5 = "N5"
    N4 = "N4"
    N3 = "N3"
    N2 = "N2"
    N1 = "N1"