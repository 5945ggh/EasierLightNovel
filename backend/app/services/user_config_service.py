# app/services/user_config_service.py
"""
用户配置管理服务
负责读取、验证、更新 config/user.json
"""
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple, Set

from app.config import BASE_DIR


# 敏感字段列表（显示时需要掩码）
SENSITIVE_FIELDS: Set[str] = {
    "llm.api_key",
    "pdf.mineru_api_token",
}

# 修改后需要重启后端的字段
RESTART_REQUIRED_FIELDS: Set[str] = {
    "backend.host",
    "backend.port",
    "cors.allowed_origins",
    "paths.data_dir",
    "paths.temp_upload_dir",
    "tokenizer.mode",
    "dictionary.memory_mode",
    "dictionary.load_kanji_dict",
}


class UserConfigService:
    """用户配置管理服务"""

    def __init__(self):
        self.config_dir = BASE_DIR / "config"
        self.schema_path = self.config_dir / "schema.json"
        self.user_config_path = self.config_dir / "user.json"

    def _load_schema(self) -> dict:
        """加载 schema.json"""
        with open(self.schema_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _load_user_config(self) -> dict:
        """加载 user.json"""
        if not self.user_config_path.exists():
            return {}
        with open(self.user_config_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _mask_sensitive_value(self, key_path: str, value: Any) -> Any:
        """掩码敏感字段值"""
        if key_path in SENSITIVE_FIELDS and value:
            if isinstance(value, str) and len(value) > 4:
                # 保留前 4 个字符
                return value[:4] + "*" * (len(value) - 4)
            return "****"
        return value

    def _get_nested_value(self, data: dict, path: str) -> Any:
        """获取嵌套字典中的值（路径如 "backend.host"）"""
        keys = path.split(".")
        value = data
        for key in keys:
            if isinstance(value, dict) and key in value:
                value = value[key]
            else:
                return None
        return value

    def _set_nested_value(self, data: dict, path: str, value: Any) -> dict:
        """设置嵌套字典中的值"""
        keys = path.split(".")
        result = data
        for key in keys[:-1]:
            if key not in result:
                result[key] = {}
            result = result[key]
        result[keys[-1]] = value
        return data

    def get_config_with_schema(self) -> Tuple[dict, List[dict]]:
        """
        获取配置和 schema 信息

        Returns:
            (config, schema_info): config 是掩码后的配置，schema_info 是分组后的 schema 信息
        """
        schema = self._load_schema()
        user_config = self._load_user_config()

        # 生成 schema_info（按分组组织）
        schema_info = []
        for group_key, group_data in schema.get("properties", {}).items():
            fields = []
            group_properties = group_data.get("properties", {})
            for field_key, field_data in group_properties.items():
                field_path = f"{group_key}.{field_key}"
                field_info = {
                    "key": field_path,
                    "type": field_data.get("type", "string"),
                    "default": field_data.get("default"),
                    "description": field_data.get("description", ""),
                }
                if "enum" in field_data:
                    field_info["enum"] = field_data["enum"]
                if "minimum" in field_data:
                    field_info["minimum"] = field_data["minimum"]
                if "maximum" in field_data:
                    field_info["maximum"] = field_data["maximum"]
                fields.append(field_info)

            schema_info.append({
                "group": group_key,
                "label": group_data.get("description", group_key),
                "description": group_data.get("description", ""),
                "fields": fields,
            })

        # 对敏感字段进行掩码
        masked_config = {}
        for group_key, group_data in user_config.items():
            masked_config[group_key] = {}
            if isinstance(group_data, dict):
                for field_key, field_value in group_data.items():
                    field_path = f"{group_key}.{field_key}"
                    masked_config[group_key][field_key] = self._mask_sensitive_value(
                        field_path, field_value
                    )
            else:
                # 如果 group_data 不是字典，直接使用
                masked_config[group_key] = group_data

        return masked_config, schema_info

    def validate_value(self, path: str, value: Any, schema: dict) -> Tuple[bool, str]:
        """
        根据 schema 验证单个值

        Returns:
            (is_valid, error_message)
        """
        # 预处理：去除字符串首尾空白
        if isinstance(value, str):
            value = value.strip()
            # 空字符串处理
            if value == "":
                # 检查是否允许空值
                keys = path.split(".")
                schema_node = schema.get("properties", {})
                for key in keys[:-1]:
                    schema_node = schema_node.get(key, {}).get("properties", {})
                field_schema = schema_node.get(keys[-1], {})
                # 如果字符串为空且有默认值，使用默认值
                if field_schema.get("default") is not None:
                    value = field_schema.get("default")

        keys = path.split(".")
        schema_node = schema.get("properties", {})
        for key in keys[:-1]:
            schema_node = schema_node.get(key, {}).get("properties", {})

        field_schema = schema_node.get(keys[-1], {})

        # 类型验证
        expected_type = field_schema.get("type")
        if expected_type == "integer":
            if not isinstance(value, int):
                try:
                    value = int(str(value).strip()) if isinstance(value, str) else int(value)
                except (ValueError, TypeError):
                    return False, "必须是整数"
        elif expected_type == "number":
            if not isinstance(value, (int, float)):
                try:
                    value = float(str(value).strip()) if isinstance(value, str) else float(value)
                except (ValueError, TypeError):
                    return False, "必须是数字"
        elif expected_type == "boolean":
            if not isinstance(value, bool):
                if isinstance(value, str):
                    value = value.strip().lower() in ("true", "1", "yes", "on")
                else:
                    return False, "必须是布尔值"
        elif expected_type == "array":
            if not isinstance(value, list):
                return False, "必须是数组"

        # 枚举验证
        if "enum" in field_schema:
            if value not in field_schema["enum"]:
                return False, f"必须是以下值之一: {', '.join(field_schema['enum'])}"

        # 范围验证
        if "minimum" in field_schema:
            if isinstance(value, (int, float)) and value < field_schema["minimum"]:
                return False, f"不能小于 {field_schema['minimum']}"
        if "maximum" in field_schema:
            if isinstance(value, (int, float)) and value > field_schema["maximum"]:
                return False, f"不能大于 {field_schema['maximum']}"

        return True, ""

    def update_config(self, updates: Dict[str, Any]) -> Tuple[bool, str, List[str], bool]:
        """
        更新配置

        Args:
            updates: 要更新的配置字典（扁平化或嵌套均可）

        Returns:
            (success, message, updated_fields, restart_required)
        """
        schema = self._load_schema()
        user_config = self._load_user_config()

        updated_fields = []
        errors = []
        restart_required = False

        for field_path, new_value in updates.items():
            # 预处理：去除字符串首尾空白
            if isinstance(new_value, str):
                new_value = new_value.strip()
            elif isinstance(new_value, list):
                # 去除数组中每个字符串元素的空白
                new_value = [v.strip() if isinstance(v, str) else v for v in new_value]

            # 验证值
            is_valid, error_msg = self.validate_value(field_path, new_value, schema)
            if not is_valid:
                errors.append(f"{field_path}: {error_msg}")
                continue

            # 设置新值
            self._set_nested_value(user_config, field_path, new_value)
            updated_fields.append(field_path)

            # 检查是否需要重启
            if field_path in RESTART_REQUIRED_FIELDS:
                restart_required = True

        if errors:
            return False, "; ".join(errors), [], False

        # 写入文件
        try:
            # 确保目录存在
            self.user_config_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.user_config_path, "w", encoding="utf-8") as f:
                json.dump(user_config, f, ensure_ascii=False, indent=2)
        except Exception as e:
            return False, f"保存配置失败: {str(e)}", [], False

        return True, "配置已保存", updated_fields, restart_required
