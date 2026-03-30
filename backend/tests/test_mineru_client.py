from unittest.mock import patch

from app.services.mineru_client import MinerUClient, MinerURetryableError


def test_poll_for_completion_retries_retryable_error():
    client = MinerUClient(api_token="test-token")

    responses = [
        MinerURetryableError("temporary"),
        {
            "extract_result": [
                {
                    "state": "done",
                }
            ]
        },
    ]

    def fake_get_batch_result(_batch_id: str):
        result = responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    with patch.object(client, "_get_batch_result", side_effect=fake_get_batch_result):
        with patch("app.services.mineru_client.time.sleep", return_value=None):
            assert client._poll_for_completion("batch-1") == "batch-1"
