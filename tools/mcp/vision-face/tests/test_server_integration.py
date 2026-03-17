import json
import subprocess
import unittest
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[4]
SERVER_PATH = REPO_ROOT / "tools/mcp/vision-face/server.py"
CONFIG_PATH = REPO_ROOT / "tools/mcp/vision-face/config.json"
VENV_PYTHON = REPO_ROOT / ".venv/bin/python"
TEST_ROOT = REPO_ROOT / "_local/test_root"


def run_server_requests(requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
    payload = "\n".join(json.dumps(item, ensure_ascii=False) for item in requests) + "\n"
    completed = subprocess.run(
        [str(VENV_PYTHON), str(SERVER_PATH), "--config", str(CONFIG_PATH)],
        cwd=REPO_ROOT,
        input=payload,
        text=True,
        capture_output=True,
        timeout=1800,
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


class VisionFaceServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not VENV_PYTHON.exists():
            raise unittest.SkipTest("missing .venv python")
        if not TEST_ROOT.exists():
            raise unittest.SkipTest("missing _local/test_root fixtures")

    def test_detect_cluster_and_list_people(self):
        db_path = TEST_ROOT / ".fauplay/faces.v1.sqlite"
        if db_path.exists():
            db_path.unlink()

        candidate_images = sorted((TEST_ROOT / "dir2").glob("*.jpg"))[:20]
        if len(candidate_images) == 0:
            self.fail("missing candidate images under _local/test_root/dir2")

        requests: list[dict[str, Any]] = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}]
        next_id = 2
        for image_path in candidate_images:
            requests.append(
                {
                    "jsonrpc": "2.0",
                    "id": next_id,
                    "method": "tools/call",
                    "params": {
                        "name": "vision.face",
                        "arguments": {
                            "rootPath": str(TEST_ROOT.resolve()),
                            "operation": "detectAsset",
                            "relativePath": image_path.relative_to(TEST_ROOT).as_posix(),
                        },
                    },
                }
            )
            next_id += 1

        cluster_id = next_id
        requests.append(
            {
                "jsonrpc": "2.0",
                "id": cluster_id,
                "method": "tools/call",
                "params": {
                    "name": "vision.face",
                    "arguments": {
                        "rootPath": str(TEST_ROOT.resolve()),
                        "operation": "clusterPending",
                        "limit": 500,
                    },
                },
            }
        )
        next_id += 1

        list_people_id = next_id
        requests.append(
            {
                "jsonrpc": "2.0",
                "id": list_people_id,
                "method": "tools/call",
                "params": {
                    "name": "vision.face",
                    "arguments": {
                        "rootPath": str(TEST_ROOT.resolve()),
                        "operation": "listPeople",
                        "page": 1,
                        "size": 50,
                    },
                },
            }
        )

        responses = run_server_requests(requests)
        by_id = {item.get("id"): item for item in responses}

        detect_results = [
            by_id[item_id]["result"]
            for item_id in range(2, cluster_id)
            if isinstance(by_id.get(item_id), dict) and "result" in by_id[item_id]
        ]
        total_detected = sum(int(item.get("detected", 0)) for item in detect_results)
        self.assertGreater(total_detected, 0)

        cluster_resp = by_id.get(cluster_id)
        self.assertIsNotNone(cluster_resp)
        self.assertIn("result", cluster_resp)
        cluster_result = cluster_resp["result"]
        self.assertGreater(int(cluster_result["processed"]), 0)
        self.assertGreaterEqual(int(cluster_result["assigned"]) + int(cluster_result["deferred"]), int(cluster_result["processed"]))

        people_resp = by_id.get(list_people_id)
        self.assertIsNotNone(people_resp)
        self.assertIn("result", people_resp)
        people_result = people_resp["result"]
        self.assertGreater(int(people_result["total"]), 0)


if __name__ == "__main__":
    unittest.main()
