import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[4]
SERVER_PATH = REPO_ROOT / "tools/mcp/vision-face/server.py"
DEFAULT_CONFIG_PATH = REPO_ROOT / "tools/mcp/vision-face/config.json"
DEFAULT_GATEWAY_MCP_CONFIG_PATH = REPO_ROOT / "src/config/mcp.json"
VENV_PYTHON = REPO_ROOT / ".venv/bin/python"
TEST_ROOT = REPO_ROOT / "_local/test_root"
GATEWAY_PATH = REPO_ROOT / "scripts/gateway/index.mjs"
NODE_BINARY = shutil.which("node")
GATEWAY_PORT = "33210"
VISION_FACE_DIR = REPO_ROOT / "tools/mcp/vision-face"
if str(VISION_FACE_DIR) not in sys.path:
    sys.path.insert(0, str(VISION_FACE_DIR))

from inference import ImmichFaceInference  # noqa: E402


def run_server_requests(requests: list[dict[str, Any]], config_path: Path) -> list[dict[str, Any]]:
    payload = "\n".join(json.dumps(item, ensure_ascii=False) for item in requests) + "\n"
    completed = subprocess.run(
        [str(VENV_PYTHON), str(SERVER_PATH), "--config", str(config_path)],
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


@contextmanager
def temp_config_copy(overrides: dict[str, Any] | None = None):
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir) / "config.json"
        config = json.loads(DEFAULT_CONFIG_PATH.read_text(encoding="utf-8"))
        if overrides:
            config.update(overrides)
        model_cache_dir = config.get("modelCacheDir")
        if isinstance(model_cache_dir, str) and model_cache_dir.strip():
            cache_path = Path(model_cache_dir.strip())
            if not cache_path.is_absolute():
                config["modelCacheDir"] = str((DEFAULT_CONFIG_PATH.parent / cache_path).resolve())
        tmp_path.write_text(json.dumps(config), encoding="utf-8")
        yield tmp_path


def build_video_from_image(image_path: Path, video_path: Path, *, frame_count: int = 6, fps: float = 1.0) -> None:
    import cv2

    frame = cv2.imread(str(image_path))
    if frame is None:
        raise AssertionError(f"failed to read image frame: {image_path}")

    height, width = frame.shape[:2]
    writer = cv2.VideoWriter(
        str(video_path),
        cv2.VideoWriter_fourcc(*"MJPG"),
        fps,
        (width, height),
    )
    if not writer.isOpened():
        raise AssertionError(f"failed to create video writer: {video_path}")
    try:
        for _ in range(frame_count):
            writer.write(frame)
    finally:
        writer.release()


def json_request(method: str, url: str, payload: dict[str, Any] | None = None) -> Any:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(url, data=data, method=method)
    if payload is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urlopen(request, timeout=120) as response:
            body = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise AssertionError(f"http {error.code} for {url}: {detail}") from error
    except URLError as error:
        raise AssertionError(f"request failed for {url}: {error}") from error

    return json.loads(body) if body else {}


def write_gateway_mcp_override(
    home_dir: Path,
    enabled_servers: set[str] | None = None,
    vision_face_config_path: Path | None = None,
) -> None:
    config = json.loads(DEFAULT_GATEWAY_MCP_CONFIG_PATH.read_text(encoding="utf-8"))
    servers = config.get("servers")
    if not isinstance(servers, dict) or len(servers) == 0:
        raise AssertionError("missing gateway MCP server config")

    enabled = enabled_servers or {"vision-face"}
    override_servers = {}
    for name in servers:
        entry: dict[str, Any] = {"disabled": name not in enabled}
        if name == "vision-face" and vision_face_config_path is not None:
            entry["args"] = ["tools/mcp/vision-face/server.py", "--config", str(vision_face_config_path)]
        override_servers[name] = entry

    override = {"servers": override_servers}

    global_dir = home_dir / ".fauplay" / "global"
    global_dir.mkdir(parents=True, exist_ok=True)
    (global_dir / "mcp.json").write_text(json.dumps(override), encoding="utf-8")


@contextmanager
def gateway_process(home_dir: Path, vision_face_config_path: Path | None = None):
    if not NODE_BINARY:
        raise unittest.SkipTest("missing node")
    write_gateway_mcp_override(home_dir, vision_face_config_path=vision_face_config_path)
    env = os.environ.copy()
    env["HOME"] = str(home_dir)
    env["FAUPLAY_GATEWAY_PORT"] = GATEWAY_PORT
    process = subprocess.Popen(
        [NODE_BINARY, str(GATEWAY_PATH)],
        cwd=REPO_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        deadline = time.time() + 30
        health_url = f"http://127.0.0.1:{GATEWAY_PORT}/v1/health"
        while time.time() < deadline:
            try:
                payload = json_request("GET", health_url)
            except AssertionError:
                time.sleep(0.5)
                continue
            if payload.get("status") == "ok":
                break
            time.sleep(0.5)
        else:
            if process.poll() is not None:
                stderr = process.stderr.read() if process.stderr is not None else ""
                stdout = process.stdout.read() if process.stdout is not None else ""
                raise AssertionError(f"gateway did not become healthy: stdout={stdout} stderr={stderr}")
            raise AssertionError("gateway did not become healthy within 30s")

        yield f"http://127.0.0.1:{GATEWAY_PORT}"
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
        if process.stdout is not None:
            process.stdout.close()
        if process.stderr is not None:
            process.stderr.close()


class FakeCv2:
    CAP_PROP_FPS = 1
    CAP_PROP_FRAME_COUNT = 2


class FakeVideoCapture:
    def __init__(self, *, fps: float, frame_count: int):
        self.fps = fps
        self.frame_count = frame_count

    def get(self, prop: int) -> float:
        if prop == FakeCv2.CAP_PROP_FPS:
            return self.fps
        if prop == FakeCv2.CAP_PROP_FRAME_COUNT:
            return float(self.frame_count)
        return 0.0


def sampling_inference(config_overrides: dict[str, Any] | None = None) -> ImmichFaceInference:
    config: dict[str, Any] = {
        "modelName": "buffalo_l",
        "modelRepo": "immich-app/buffalo_l",
        "modelCacheDir": ".cache",
        "minScore": 0.7,
        "forceCpu": False,
        "allowModelDownload": False,
        "videoShortIntervalMs": 3000,
        "videoShortMaxDurationMs": 60000,
        "videoMaxFrames": 20,
        "videoMinScore": 0.8,
        "videoDedupeMaxDistance": 0.4,
        "videoMaxFacesPerAsset": 20,
    }
    if config_overrides:
        config.update(config_overrides)
    inference = ImmichFaceInference(config)
    inference.cv2 = FakeCv2
    return inference


class VisionFaceServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not VENV_PYTHON.exists():
            raise unittest.SkipTest("missing .venv python")
        if not TEST_ROOT.exists():
            raise unittest.SkipTest("missing _local/test_root fixtures")

    def test_video_sampling_timestamps_are_duration_adaptive(self):
        inference = sampling_inference()

        short_timestamps = inference.build_video_sample_timestamps(FakeVideoCapture(fps=1, frame_count=60))
        self.assertEqual(short_timestamps, [index * 3000 for index in range(20)])

        long_timestamps = inference.build_video_sample_timestamps(FakeVideoCapture(fps=1, frame_count=120))
        self.assertEqual(long_timestamps, [index * 6000 for index in range(20)])

        fallback_timestamps = inference.build_video_sample_timestamps(FakeVideoCapture(fps=0, frame_count=0))
        self.assertEqual(fallback_timestamps[:6], [0, 1000, 3000, 6000, 10000, 15000])
        self.assertEqual(len(fallback_timestamps), 20)

    def test_video_face_cap_prefers_high_quality_representatives(self):
        inference = sampling_inference({"videoMaxFacesPerAsset": 2})
        faces = [
            {"score": 0.80, "frameTsMs": 0, "boundingBox": {"x1": 0, "y1": 0, "x2": 10, "y2": 10}},
            {"score": 0.95, "frameTsMs": 3000, "boundingBox": {"x1": 0, "y1": 0, "x2": 5, "y2": 5}},
            {"score": 0.95, "frameTsMs": 1000, "boundingBox": {"x1": 0, "y1": 0, "x2": 20, "y2": 20}},
        ]

        capped = inference.cap_video_faces_per_asset(faces)
        self.assertEqual([item["frameTsMs"] for item in capped], [1000, 3000])

    def select_detectable_image(self, config_path: Path) -> tuple[Path, int]:
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

        responses = run_server_requests(requests, config_path)
        by_id = {item.get("id"): item for item in responses}
        for index, image_path in enumerate(candidate_images, start=2):
            detected = int(by_id.get(index, {}).get("result", {}).get("detected", 0))
            if detected > 0:
                return image_path, detected

        self.fail("failed to find a detectable face image")

    def test_detect_cluster_and_list_people(self):
        with temp_config_copy({"videoMinScore": 0.7}) as config_path:
            image_path, _ = self.select_detectable_image(config_path)

            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp_root = Path(tmp_dir)
                home_dir = tmp_root / "home"
                home_dir.mkdir(parents=True, exist_ok=True)

                relative_path = image_path.relative_to(TEST_ROOT).as_posix()
                with gateway_process(home_dir, config_path) as base_url:
                    detect_result = json_request(
                        "POST",
                        f"{base_url}/v1/faces/detect-asset",
                        {
                            "rootPath": str(TEST_ROOT.resolve()),
                            "relativePath": relative_path,
                            "runCluster": True,
                        },
                    )
                    self.assertGreater(int(detect_result.get("created", 0)), 0)
                    self.assertIn("cluster", detect_result)
                    self.assertGreater(int(detect_result["cluster"].get("assigned", 0)), 0, detect_result)

                    asset_faces = json_request(
                        "POST",
                        f"{base_url}/v1/faces/list-asset-faces",
                        {
                            "rootPath": str(TEST_ROOT.resolve()),
                            "relativePath": relative_path,
                        },
                    )
                    self.assertGreater(int(asset_faces.get("total", 0)), 0)
                    first_face = asset_faces["items"][0]
                    self.assertEqual(first_face.get("mediaType"), "image")
                    self.assertIsNone(first_face.get("frameTsMs"))

                    people_result = json_request(
                        "POST",
                        f"{base_url}/v1/faces/list-people",
                        {
                            "page": 1,
                            "size": 50,
                        },
                    )
                    self.assertGreater(int(people_result.get("total", 0)), 0)

    def test_gateway_list_people_matches_unnamed_person_aliases(self):
        with temp_config_copy({"videoMinScore": 0.7}) as config_path:
            image_path, _ = self.select_detectable_image(config_path)

            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp_root = Path(tmp_dir)
                home_dir = tmp_root / "home"
                home_dir.mkdir(parents=True, exist_ok=True)

                relative_path = image_path.relative_to(TEST_ROOT).as_posix()
                with gateway_process(home_dir, config_path) as base_url:
                    detect_result = json_request(
                        "POST",
                        f"{base_url}/v1/faces/detect-asset",
                        {
                            "rootPath": str(TEST_ROOT.resolve()),
                            "relativePath": relative_path,
                            "runCluster": True,
                        },
                    )
                    self.assertGreater(int(detect_result.get("cluster", {}).get("assigned", 0)), 0, detect_result)

                    people_result = json_request(
                        "POST",
                        f"{base_url}/v1/faces/list-people",
                        {
                            "page": 1,
                            "size": 50,
                        },
                    )
                    person = people_result["items"][0]
                    person_id = str(person["personId"])
                    person_id_prefix = person_id[:8]

                    json_request(
                        "POST",
                        f"{base_url}/v1/faces/rename-person",
                        {
                            "personId": person_id,
                            "name": "",
                        },
                    )

                    for query in (
                        "未命名",
                        f"未命名 {person_id_prefix}",
                        f"人物 {person_id_prefix}",
                        f"(未命名 {person_id_prefix})",
                    ):
                        filtered_result = json_request(
                            "POST",
                            f"{base_url}/v1/faces/list-people",
                            {
                                "page": 1,
                                "size": 50,
                                "query": query,
                            },
                        )
                        self.assertGreater(int(filtered_result.get("total", 0)), 0, filtered_result)
                        self.assertTrue(
                            any(item.get("personId") == person_id for item in filtered_result["items"]),
                            filtered_result,
                        )

    def test_gateway_single_unknown_video_run_cluster_defers(self):
        with temp_config_copy({"videoMinScore": 0.7}) as config_path:
            image_path, _ = self.select_detectable_image(config_path)

            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp_root = Path(tmp_dir)
                home_dir = tmp_root / "home"
                home_dir.mkdir(parents=True, exist_ok=True)
                root_path = tmp_root / "root"
                root_path.mkdir(parents=True, exist_ok=True)
                video_path = root_path / "video-single.avi"
                build_video_from_image(image_path, video_path)

                with gateway_process(home_dir, config_path) as base_url:
                    detect_result = json_request(
                        "POST",
                        f"{base_url}/v1/faces/detect-asset",
                        {
                            "rootPath": str(root_path.resolve()),
                            "relativePath": video_path.name,
                            "runCluster": True,
                        },
                    )
                    self.assertGreater(int(detect_result.get("created", 0)), 0)
                    self.assertIn("cluster", detect_result)
                    self.assertGreater(int(detect_result["cluster"].get("processed", 0)), 0)
                    self.assertEqual(int(detect_result["cluster"].get("assigned", 0)), 0, detect_result)
                    self.assertEqual(int(detect_result["cluster"].get("createdPersons", 0)), 0, detect_result)

                    people_result = json_request(
                        "POST",
                        f"{base_url}/v1/faces/list-people",
                        {
                            "page": 1,
                            "size": 50,
                        },
                    )
                    self.assertEqual(int(people_result.get("total", 0)), 0, people_result)

                    faces_payload = json_request(
                        "POST",
                        f"{base_url}/v1/faces/list-asset-faces",
                        {
                            "rootPath": str(root_path.resolve()),
                            "relativePath": video_path.name,
                        },
                    )
                    self.assertGreater(int(faces_payload.get("total", 0)), 0)
                    self.assertTrue(all(item.get("status") == "deferred" for item in faces_payload["items"]))

    def test_gateway_video_run_cluster_matches_existing_person(self):
        with temp_config_copy({"videoMinScore": 0.7}) as config_path:
            image_path, _ = self.select_detectable_image(config_path)

            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp_root = Path(tmp_dir)
                home_dir = tmp_root / "home"
                home_dir.mkdir(parents=True, exist_ok=True)
                root_path = tmp_root / "root"
                root_path.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(image_path, root_path / "person.jpg")
                build_video_from_image(image_path, root_path / "person-video.avi")

                with gateway_process(home_dir, config_path) as base_url:
                    image_detect = json_request(
                        "POST",
                        f"{base_url}/v1/faces/detect-asset",
                        {
                            "rootPath": str(root_path.resolve()),
                            "relativePath": "person.jpg",
                            "runCluster": True,
                        },
                    )
                    self.assertGreater(int(image_detect.get("created", 0)), 0)
                    self.assertGreater(int(image_detect.get("cluster", {}).get("assigned", 0)), 0, image_detect)

                    video_detect = json_request(
                        "POST",
                        f"{base_url}/v1/faces/detect-asset",
                        {
                            "rootPath": str(root_path.resolve()),
                            "relativePath": "person-video.avi",
                            "runCluster": True,
                        },
                    )
                    self.assertGreater(int(video_detect.get("created", 0)), 0)
                    self.assertGreater(int(video_detect.get("cluster", {}).get("assigned", 0)), 0, video_detect)

                    tags_payload = json_request(
                        "POST",
                        f"{base_url}/v1/data/tags/file",
                        {
                            "rootPath": str(root_path.resolve()),
                            "relativePath": "person-video.avi",
                        },
                    )
                    file_payload = tags_payload.get("file") or {}
                    tags = file_payload.get("tags") or []
                    self.assertTrue(any(tag.get("source") == "vision.face" and tag.get("key") == "person" for tag in tags))

    def test_legacy_video_cluster_strong_evidence_path(self):
        with temp_config_copy({"videoMinScore": 0.7}) as config_path:
            image_path, _ = self.select_detectable_image(config_path)

            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp_root = Path(tmp_dir)
                home_dir = tmp_root / "home"
                home_dir.mkdir(parents=True, exist_ok=True)
                root_path = tmp_root / "root"
                root_path.mkdir(parents=True, exist_ok=True)

                relative_paths = ["video-a.avi", "video-b.avi", "video-c.avi"]
                for index, relative_path in enumerate(relative_paths):
                    build_video_from_image(image_path, root_path / relative_path, frame_count=6 + index)

                with gateway_process(home_dir, config_path) as base_url:
                    for relative_path in relative_paths[:2]:
                        detect_result = json_request(
                            "POST",
                            f"{base_url}/v1/faces/detect-asset",
                            {
                                "rootPath": str(root_path.resolve()),
                                "relativePath": relative_path,
                                "runCluster": False,
                            },
                        )
                        self.assertGreater(int(detect_result.get("created", 0)), 0)

                    final_detect = json_request(
                        "POST",
                        f"{base_url}/v1/faces/detect-asset",
                        {
                            "rootPath": str(root_path.resolve()),
                            "relativePath": relative_paths[2],
                            "runCluster": True,
                        },
                    )
                    self.assertGreater(int(final_detect.get("created", 0)), 0)
                    self.assertIn("cluster", final_detect)
                    self.assertGreater(int(final_detect["cluster"].get("processed", 0)), 0)
                    self.assertGreater(int(final_detect["cluster"].get("assigned", 0)), 0, final_detect)

                    faces_payload = json_request(
                        "POST",
                        f"{base_url}/v1/faces/list-asset-faces",
                        {
                            "rootPath": str(root_path.resolve()),
                            "relativePath": relative_paths[2],
                        },
                    )
                    self.assertGreater(int(faces_payload.get("total", 0)), 0)
                    first_face = faces_payload["items"][0]
                    self.assertEqual(first_face.get("mediaType"), "video")
                    self.assertIsInstance(first_face.get("frameTsMs"), int)
                    self.assertTrue(any(item.get("personId") for item in faces_payload["items"]), faces_payload)

                    crop_request = Request(
                        f"{base_url}/v1/faces/crops/{first_face['faceId']}?size=96&padding=0.2",
                        method="GET",
                    )
                    with urlopen(crop_request, timeout=120) as response:
                        self.assertEqual(response.headers.get_content_type(), "image/jpeg")
                        self.assertGreater(len(response.read()), 0)

    def test_detect_video_asset_returns_deduped_faces(self):
        with temp_config_copy({"videoMinScore": 0.7}) as config_path:
            image_path, image_detected = self.select_detectable_image(config_path)

            with tempfile.TemporaryDirectory() as tmp_dir:
                root_path = Path(tmp_dir)
                video_path = root_path / "face-video.avi"
                build_video_from_image(image_path, video_path)

                requests = [
                    {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
                    {
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "tools/call",
                        "params": {
                            "name": "vision.face",
                            "arguments": {
                                "rootPath": str(root_path.resolve()),
                                "operation": "detectAsset",
                                "relativePath": video_path.name,
                            },
                        },
                    },
                ]

                responses = run_server_requests(requests, config_path)
                by_id = {item.get("id"): item for item in responses}
                detect_result = by_id[2]["result"]
                self.assertGreater(int(detect_result["detected"]), 0)
                self.assertLessEqual(int(detect_result["detected"]), image_detected)
                self.assertTrue(all(item.get("mediaType") == "video" for item in detect_result["faces"]))
                self.assertTrue(all(isinstance(item.get("frameTsMs"), int) for item in detect_result["faces"]))

if __name__ == "__main__":
    unittest.main()
