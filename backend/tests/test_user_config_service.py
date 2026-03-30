import json
import time

from app.services.user_config_service import UserConfigService


def create_service(tmp_path) -> UserConfigService:
    schema = {
        "type": "object",
        "properties": {
            "backend": {
                "type": "object",
                "description": "后端配置",
                "properties": {
                    "port": {
                        "type": "integer",
                        "default": 8010,
                        "minimum": 1024,
                        "maximum": 65535,
                    }
                },
            },
            "llm": {
                "type": "object",
                "description": "LLM 配置",
                "properties": {
                    "api_key": {
                        "type": "string",
                        "description": "密钥",
                    }
                },
            },
        },
    }

    schema_path = tmp_path / "schema.json"
    user_config_path = tmp_path / "user.json"
    schema_path.write_text(json.dumps(schema, ensure_ascii=False), encoding="utf-8")

    service = UserConfigService()
    service.schema_path = schema_path
    service.user_config_path = user_config_path
    return service


def test_update_config_rejects_unknown_field(tmp_path):
    service = create_service(tmp_path)

    success, message, updated_fields, restart_required = service.update_config(
        {"backend.unknown_field": 1}
    )

    assert success is False
    assert "未知配置字段" in message
    assert updated_fields == []
    assert restart_required is False


def test_update_config_normalizes_value_and_marks_restart_pending(tmp_path):
    service = create_service(tmp_path)

    success, message, updated_fields, restart_required = service.update_config(
        {"backend.port": " 8011 "}
    )

    assert success is True
    assert "重启后端后生效" in message
    assert updated_fields == ["backend.port"]
    assert restart_required is True

    saved = json.loads(service.user_config_path.read_text(encoding="utf-8"))
    assert saved["backend"]["port"] == 8011

    time.sleep(0.01)
    assert service.has_pending_restart() is True


def test_update_config_keeps_existing_sensitive_value_when_blank(tmp_path):
    service = create_service(tmp_path)
    service.user_config_path.write_text(
        json.dumps({"llm": {"api_key": "existing-secret"}}, ensure_ascii=False),
        encoding="utf-8",
    )

    success, message, updated_fields, restart_required = service.update_config(
        {"llm.api_key": "   "}
    )

    assert success is True
    assert updated_fields == []
    assert restart_required is False

    saved = json.loads(service.user_config_path.read_text(encoding="utf-8"))
    assert saved["llm"]["api_key"] == "existing-secret"
