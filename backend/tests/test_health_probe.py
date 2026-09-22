import json
from unittest.mock import patch, MagicMock
import urllib.error
import pytest

from backend.scripts.check_health_probe import check_health

def make_fake_response(status_code=200, json_data=None):
    mock_resp = MagicMock()
    mock_resp.status = status_code
    body = json.dumps(json_data or {}).encode('utf-8')
    mock_resp.read.return_value = body
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = False
    return mock_resp

def test_check_health_success():
    payload = {
        "status": "healthy",
        "database": "connected",
        "paydunya_circuit": {
            "state": "closed",
            "consecutive_failures": 0,
            "remaining_cooldown_seconds": 0
        },
        "revision": "abcdef1234"
    }
    with patch("urllib.request.urlopen", return_value=make_fake_response(200, payload)):
        assert check_health("https://example.com/health") == 0

def test_check_health_fails_on_paydunya_open():
    payload = {
        "status": "healthy",
        "database": "connected",
        "paydunya_circuit": {
            "state": "open",
            "consecutive_failures": 5,
            "remaining_cooldown_seconds": 60
        }
    }
    with patch("urllib.request.urlopen", return_value=make_fake_response(200, payload)):
        assert check_health("https://example.com/health") == 1

def test_check_health_fails_on_database_disconnected():
    payload = {
        "status": "healthy",
        "database": "disconnected",
        "paydunya_circuit": {
            "state": "closed",
            "consecutive_failures": 0
        }
    }
    with patch("urllib.request.urlopen", return_value=make_fake_response(200, payload)):
        assert check_health("https://example.com/health") == 1

def test_check_health_fails_on_http_error():
    with patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("url", 500, "Server Error", {}, None)):
        assert check_health("https://example.com/health") == 1
