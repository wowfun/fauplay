import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[4]
SERVER_PATH = REPO_ROOT / "tools/mcp/timm-classifier/server.py"
CONFIG_PATH = REPO_ROOT / "tools/mcp/timm-classifier/config.json"
FIXTURE_DIR = REPO_ROOT / "tools/mcp/timm-classifier/tests/fixtures"
FIXTURE_IMAGE = "img1.jpg"
VENV_PYTHON = REPO_ROOT / ".venv/bin/python"


def load_server_module():
    spec = importlib.util.spec_from_file_location("timm_classifier_server", SERVER_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_server_requests(requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
    payload = "\n".join(json.dumps(item, ensure_ascii=False) for item in requests) + "\n"
    completed = subprocess.run(
        [str(VENV_PYTHON), str(SERVER_PATH), "--config", str(CONFIG_PATH)],
        cwd=REPO_ROOT,
        input=payload,
        text=True,
        capture_output=True,
        timeout=600,
        check=False,
    )
    if completed.returncode != 0:
        raise AssertionError(f"server exited with {completed.returncode}: {completed.stderr}")

    responses: list[dict[str, Any]] = []
    for line in completed.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        responses.append(json.loads(line))
    return responses


class _FakePipeline:
    def __init__(self):
        self.calls: list[dict[str, Any]] = []

    def __call__(self, images: Any, *, top_k: int, batch_size: int | None = None):
        self.calls.append({"images": images, "top_k": top_k, "batch_size": batch_size})
        if isinstance(images, list):
            return [[{"label": "ok", "score": 0.9}] for _ in images]
        return [{"label": "ok", "score": 0.9}]


class TimmClassifierServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not VENV_PYTHON.exists():
            raise unittest.SkipTest("missing .venv python")
        cls.server_module = load_server_module()
        cls.base_config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

    def test_batch_size_default_is_64_when_missing(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir) / "config.json"
            tmp_path.write_text(
                json.dumps(
                    {
                        "modelDir": self.base_config["modelDir"],
                        "device": self.base_config.get("device", "auto"),
                    }
                ),
                encoding="utf-8",
            )
            classifier = self.server_module.TimmClassifier(tmp_path)
            self.assertEqual(classifier.config["batch_size"], 64)

    def test_classify_batch_passes_configured_batch_size_to_pipeline(self):
        classifier = self.server_module.TimmClassifier(CONFIG_PATH)
        fake_pipeline = _FakePipeline()
        classifier.pipeline = fake_pipeline
        classifier.model_loaded = True

        from PIL import Image

        classifier.pil_image = Image

        result = classifier.classify_batch(
            {
                "rootPath": str(FIXTURE_DIR),
                "relativePaths": [FIXTURE_IMAGE, FIXTURE_IMAGE],
                "topK": 3,
            }
        )
        self.assertEqual(result["failed"], 0)
        self.assertEqual(result["succeeded"], 2)
        self.assertGreaterEqual(len(fake_pipeline.calls), 1)
        self.assertEqual(fake_pipeline.calls[0]["batch_size"], self.base_config["batch_size"])

    def test_integration_classify_image_and_batch_return_predictions(self):
        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "ml.classifyImage",
                    "arguments": {
                        "rootPath": str(FIXTURE_DIR),
                        "relativePath": FIXTURE_IMAGE,
                        "topK": 5,
                        "minScore": 0.0,
                    },
                },
            },
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "ml.classifyBatch",
                    "arguments": {
                        "rootPath": str(FIXTURE_DIR),
                        "relativePaths": [FIXTURE_IMAGE, FIXTURE_IMAGE],
                        "topK": 5,
                        "minScore": 0.0,
                    },
                },
            },
        ]

        responses = run_server_requests(requests)
        by_id = {item.get("id"): item for item in responses}

        image_resp = by_id[2]
        self.assertIn("result", image_resp)
        image_predictions = image_resp["result"]["predictions"]
        self.assertIsInstance(image_predictions, list)
        self.assertGreater(len(image_predictions), 0)
        self.assertIn("label", image_predictions[0])
        self.assertIn("score", image_predictions[0])
        self.assertNotIn("index", image_predictions[0])

        batch_resp = by_id[3]
        self.assertIn("result", batch_resp)
        batch_result = batch_resp["result"]
        self.assertEqual(batch_result["failed"], 0)
        self.assertEqual(batch_result["succeeded"], 2)
        self.assertEqual(len(batch_result["items"]), 2)
        for item in batch_result["items"]:
            self.assertTrue(item["ok"])
            self.assertGreater(len(item["predictions"]), 0)
            self.assertIn("label", item["predictions"][0])
            self.assertIn("score", item["predictions"][0])
            self.assertNotIn("index", item["predictions"][0])


if __name__ == "__main__":
    unittest.main()
