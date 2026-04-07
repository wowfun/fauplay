import json
from pathlib import Path
from typing import Any

from protocol import MCPError

SUPPORTED_PROVIDERS = [
    "CUDAExecutionProvider",
    "MIGraphXExecutionProvider",
    "OpenVINOExecutionProvider",
    "CoreMLExecutionProvider",
    "CPUExecutionProvider",
]
VIDEO_EXTENSIONS = {
    "avi",
    "flv",
    "m4v",
    "mkv",
    "mov",
    "mp4",
    "mpeg",
    "mpg",
    "ogg",
    "ts",
    "webm",
    "wmv",
}
DEFAULT_CONFIG_PATH = (Path(__file__).resolve().parent / "config.json").resolve()


def read_config_file(config_path: Path, *, required: bool) -> dict[str, Any]:
    if not config_path.exists() or not config_path.is_file():
        if not required:
            return {}
        raise MCPError("MCP_TOOL_CALL_FAILED", f"config file not found: {config_path}")
    try:
        parsed = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as error:
        raise MCPError("MCP_TOOL_CALL_FAILED", f"failed to parse config file: {error}") from error
    if not isinstance(parsed, dict):
        raise MCPError("MCP_TOOL_CALL_FAILED", "config root must be an object")
    return parsed


def read_config(config_path: Path) -> dict[str, Any]:
    resolved_config_path = config_path.expanduser().resolve()
    parsed = read_config_file(resolved_config_path, required=True)

    model_name = str(parsed.get("modelName") or "buffalo_l")
    model_repo = str(parsed.get("modelRepo") or f"immich-app/{model_name}")

    cache_raw = parsed.get("modelCacheDir")
    if isinstance(cache_raw, str) and cache_raw.strip():
        cache_dir = Path(cache_raw.strip())
        if not cache_dir.is_absolute():
            cache_dir = (resolved_config_path.parent / cache_dir).resolve()
    else:
        cache_dir = (Path.home() / ".cache" / "fauplay" / "vision-face" / model_name).resolve()

    return {
        "modelName": model_name,
        "modelRepo": model_repo,
        "modelCacheDir": str(cache_dir),
        "minScore": float(parsed.get("minScore", 0.7)),
        "maxDistance": float(parsed.get("maxDistance", 0.5)),
        "minFaces": int(parsed.get("minFaces", 3)),
        "videoShortIntervalMs": int(parsed.get("videoShortIntervalMs", parsed.get("videoSampleIntervalMs", 3000))),
        "videoShortMaxDurationMs": int(parsed.get("videoShortMaxDurationMs", 60000)),
        "videoMaxFrames": int(parsed.get("videoMaxFrames", 20)),
        "videoMinScore": float(parsed.get("videoMinScore", 0.8)),
        "videoDedupeMaxDistance": float(parsed.get("videoDedupeMaxDistance", 0.4)),
        "videoMaxFacesPerAsset": int(parsed.get("videoMaxFacesPerAsset", 20)),
        "clusterNewFacesNightly": bool(parsed.get("clusterNewFacesNightly", True)),
        "forceCpu": bool(parsed.get("forceCpu", False)),
        "allowModelDownload": bool(parsed.get("allowModelDownload", False)),
    }


class ImmichFaceInference:
    def __init__(self, config: dict[str, Any]):
        self.model_name = str(config["modelName"])
        self.model_repo = str(config["modelRepo"])
        self.model_cache_dir = Path(str(config["modelCacheDir"]))
        self.min_score = float(config["minScore"])
        self.force_cpu = bool(config.get("forceCpu", False))
        self.allow_model_download = bool(config.get("allowModelDownload", True))
        self.video_short_interval_ms = max(1000, int(config.get("videoShortIntervalMs", 3000)))
        self.video_short_max_duration_ms = max(1000, int(config.get("videoShortMaxDurationMs", 60000)))
        self.video_max_frames = max(1, int(config.get("videoMaxFrames", 20)))
        self.video_min_score = max(0.0, float(config.get("videoMinScore", 0.8)))
        self.video_dedupe_max_distance = max(0.0, float(config.get("videoDedupeMaxDistance", 0.4)))
        self.video_max_faces_per_asset = max(1, int(config.get("videoMaxFacesPerAsset", 20)))

        self.loaded = False
        self.cv2: Any = None
        self.detector: Any = None
        self.recognizer: Any = None
        self.norm_crop: Any = None
        self.np: Any = None
        self.image_cls: Any = None

    def detect_asset(self, absolute_path: Path) -> list[dict[str, Any]]:
        extension = absolute_path.suffix.lower().lstrip(".")
        if extension in VIDEO_EXTENSIONS:
            return self.detect_video_asset(absolute_path)
        return self.detect_image_asset(absolute_path)

    def detect_image_asset(self, absolute_path: Path) -> list[dict[str, Any]]:
        self.ensure_loaded()
        assert self.np is not None
        assert self.image_cls is not None

        try:
            with self.image_cls.open(absolute_path) as img:
                rgb = self.np.array(img.convert("RGB"))
        except Exception as error:
            raise MCPError("MCP_INVALID_PARAMS", f"failed to decode image: {absolute_path}") from error

        # InsightFace expects BGR numpy arrays.
        bgr = self.np.ascontiguousarray(rgb[:, :, ::-1])
        return self.detect_frame(bgr, media_type="image", frame_ts_ms=None)

    def detect_video_asset(self, absolute_path: Path) -> list[dict[str, Any]]:
        self.ensure_loaded()
        assert self.cv2 is not None

        capture = self.cv2.VideoCapture(str(absolute_path))
        if not capture.isOpened():
            raise MCPError("MCP_INVALID_PARAMS", f"failed to decode video: {absolute_path}")

        results: list[dict[str, Any]] = []
        decoded_frames = 0
        stop_on_first_read_failure = not self.has_trusted_video_duration(capture)
        try:
            for frame_ts_ms in self.build_video_sample_timestamps(capture):
                frame = self.read_video_frame(capture, frame_ts_ms)
                if frame is None:
                    if stop_on_first_read_failure:
                        break
                    continue
                decoded_frames += 1
                results.extend(self.detect_frame(frame, media_type="video", frame_ts_ms=frame_ts_ms))
        finally:
            capture.release()

        if decoded_frames == 0:
            raise MCPError("MCP_INVALID_PARAMS", f"failed to decode video: {absolute_path}")

        return self.dedupe_video_faces(results)

    def detect_frame(self, bgr: Any, *, media_type: str, frame_ts_ms: int | None) -> list[dict[str, Any]]:
        assert self.detector is not None
        assert self.recognizer is not None
        assert self.norm_crop is not None

        bboxes, landmarks = self.detector.detect(bgr)
        if bboxes is None or landmarks is None or len(bboxes) == 0:
            return []

        cropped_faces = [self.norm_crop(bgr, landmark) for landmark in landmarks]
        embeddings = self.recognizer.get_feat(cropped_faces)

        results: list[dict[str, Any]] = []
        min_score = self.video_min_score if media_type == "video" else self.min_score
        for bbox, embedding in zip(bboxes, embeddings):
            score = float(bbox[4])
            if score < min_score:
                continue
            results.append(
                {
                    "boundingBox": {
                        "x1": float(bbox[0]),
                        "y1": float(bbox[1]),
                        "x2": float(bbox[2]),
                        "y2": float(bbox[3]),
                    },
                    "score": score,
                    "embedding": [float(item) for item in embedding.tolist()],
                    "mediaType": media_type,
                    "frameTsMs": int(frame_ts_ms) if frame_ts_ms is not None else None,
                }
            )
        return results

    def build_video_sample_timestamps(self, capture: Any) -> list[int]:
        assert self.cv2 is not None

        duration_ms = self.get_trusted_video_duration_ms(capture)
        if duration_ms is not None:
            if duration_ms <= self.video_short_max_duration_ms:
                return self.build_short_video_sample_timestamps(duration_ms)
            return self.build_long_video_sample_timestamps(duration_ms)

        return self.build_fallback_video_sample_timestamps()

    def get_trusted_video_duration_ms(self, capture: Any) -> int | None:
        assert self.cv2 is not None

        fps = float(capture.get(self.cv2.CAP_PROP_FPS) or 0.0)
        frame_count = int(capture.get(self.cv2.CAP_PROP_FRAME_COUNT) or 0)
        if fps <= 0 or frame_count <= 0:
            return None

        duration_ms = int(round((frame_count / fps) * 1000.0))
        if duration_ms <= 0:
            return None

        return duration_ms

    def has_trusted_video_duration(self, capture: Any) -> bool:
        return self.get_trusted_video_duration_ms(capture) is not None

    def build_short_video_sample_timestamps(self, duration_ms: int) -> list[int]:
        timestamps: list[int] = []
        current_ts_ms = 0
        while len(timestamps) < self.video_max_frames and current_ts_ms <= duration_ms:
            timestamps.append(current_ts_ms)
            current_ts_ms += self.video_short_interval_ms
        return timestamps or [0]

    def build_long_video_sample_timestamps(self, duration_ms: int) -> list[int]:
        return [
            int(round(duration_ms * (index / self.video_max_frames)))
            for index in range(self.video_max_frames)
        ]

    def build_fallback_video_sample_timestamps(self) -> list[int]:
        timestamps: list[int] = []
        current_ts_ms = 0
        next_interval_ms = 1000
        while len(timestamps) < self.video_max_frames:
            timestamps.append(current_ts_ms)
            current_ts_ms += next_interval_ms
            next_interval_ms += 1000
        return timestamps

    def read_video_frame(self, capture: Any, frame_ts_ms: int) -> Any | None:
        assert self.cv2 is not None

        target_ts_ms = max(0, int(frame_ts_ms))
        capture.set(self.cv2.CAP_PROP_POS_MSEC, float(target_ts_ms))
        ok, frame = capture.read()
        if ok and frame is not None:
            return frame

        fps = float(capture.get(self.cv2.CAP_PROP_FPS) or 0.0)
        if fps > 0:
            frame_index = max(0, int(round((target_ts_ms / 1000.0) * fps)))
            capture.set(self.cv2.CAP_PROP_POS_FRAMES, float(frame_index))
            ok, frame = capture.read()
            if ok and frame is not None:
                return frame

        return None

    def dedupe_video_faces(self, face_payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
        representatives: list[dict[str, Any]] = []
        for candidate in face_payloads:
            best_match_index: int | None = None
            best_distance = float("inf")
            for index, representative in enumerate(representatives):
                distance = self.cosine_distance(candidate["embedding"], representative["embedding"])
                if distance <= self.video_dedupe_max_distance and distance < best_distance:
                    best_match_index = index
                    best_distance = distance
            if best_match_index is None:
                representatives.append(candidate)
                continue
            if self.is_better_video_representative(candidate, representatives[best_match_index]):
                representatives[best_match_index] = candidate

        capped = self.cap_video_faces_per_asset(representatives)
        capped.sort(
            key=lambda item: (
                int(item.get("frameTsMs") or 0),
                -float(item.get("score") or 0.0),
            )
        )
        return capped

    def cap_video_faces_per_asset(self, face_payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len(face_payloads) <= self.video_max_faces_per_asset:
            return face_payloads

        return sorted(
            face_payloads,
            key=lambda item: (
                -float(item.get("score") or 0.0),
                -self.bounding_box_area(item.get("boundingBox")),
                int(item.get("frameTsMs") or 0),
            ),
        )[: self.video_max_faces_per_asset]

    @staticmethod
    def is_better_video_representative(candidate: dict[str, Any], existing: dict[str, Any]) -> bool:
        candidate_score = float(candidate.get("score") or 0.0)
        existing_score = float(existing.get("score") or 0.0)
        if candidate_score != existing_score:
            return candidate_score > existing_score

        candidate_area = ImmichFaceInference.bounding_box_area(candidate.get("boundingBox"))
        existing_area = ImmichFaceInference.bounding_box_area(existing.get("boundingBox"))
        if candidate_area != existing_area:
            return candidate_area > existing_area

        candidate_ts = int(candidate.get("frameTsMs") or 0)
        existing_ts = int(existing.get("frameTsMs") or 0)
        return candidate_ts < existing_ts

    @staticmethod
    def bounding_box_area(box: Any) -> float:
        if not isinstance(box, dict):
            return 0.0
        x1 = float(box.get("x1") or 0.0)
        y1 = float(box.get("y1") or 0.0)
        x2 = float(box.get("x2") or 0.0)
        y2 = float(box.get("y2") or 0.0)
        return max(0.0, x2 - x1) * max(0.0, y2 - y1)

    @staticmethod
    def cosine_distance(left: list[float], right: list[float]) -> float:
        dot = 0.0
        left_norm = 0.0
        right_norm = 0.0
        size = min(len(left), len(right))
        for index in range(size):
            left_value = float(left[index])
            right_value = float(right[index])
            dot += left_value * right_value
            left_norm += left_value * left_value
            right_norm += right_value * right_value

        if left_norm <= 0 or right_norm <= 0:
            return 1.0

        similarity = min(1.0, max(-1.0, dot / ((left_norm ** 0.5) * (right_norm ** 0.5))))
        return 1.0 - similarity

    def ensure_loaded(self) -> None:
        if self.loaded:
            return

        try:
            import cv2
            import numpy as np
            import onnxruntime as ort
            from huggingface_hub import snapshot_download
            from PIL import Image

            from vendor.arcface_onnx import ArcFaceONNX
            from vendor.face_align import norm_crop
            from vendor.retinaface import RetinaFace
        except Exception as error:
            raise MCPError("FACE_ML_UNAVAILABLE", f"missing python dependencies: {error}") from error

        detection_path = self.find_model_path(self.model_cache_dir, "detection")
        recognition_path = self.find_model_path(self.model_cache_dir, "recognition")
        if detection_path is None or recognition_path is None:
            self.model_cache_dir.mkdir(parents=True, exist_ok=True)
            if not self.allow_model_download:
                raise MCPError(
                    "FACE_ML_UNAVAILABLE",
                    (
                        f"missing model files in {self.model_cache_dir}; "
                        "expected detection/model.onnx and recognition/model.onnx"
                    ),
                )
            try:
                snapshot_download(
                    repo_id=self.model_repo,
                    cache_dir=self.model_cache_dir,
                    local_dir=self.model_cache_dir,
                )
            except Exception as error:
                raise MCPError("FACE_ML_UNAVAILABLE", f"failed to download model '{self.model_repo}': {error}") from error
            detection_path = self.find_model_path(self.model_cache_dir, "detection")
            recognition_path = self.find_model_path(self.model_cache_dir, "recognition")
            if detection_path is None or recognition_path is None:
                raise MCPError(
                    "FACE_ML_UNAVAILABLE",
                    (
                        f"invalid model layout under {self.model_cache_dir}; "
                        "expected detection/model.onnx and recognition/model.onnx"
                    ),
                )

        available_providers = set(ort.get_available_providers())
        if self.force_cpu:
            providers = ["CPUExecutionProvider"]
        else:
            providers = [item for item in SUPPORTED_PROVIDERS if item in available_providers]
        if not providers:
            providers = ["CPUExecutionProvider"]

        try:
            detection_session = ort.InferenceSession(str(detection_path), providers=providers)
            recognition_session = ort.InferenceSession(str(recognition_path), providers=providers)
            detector = RetinaFace(session=detection_session)
            detector.prepare(ctx_id=0, det_thresh=self.min_score, input_size=(640, 640))
            recognizer = ArcFaceONNX(str(recognition_path), session=recognition_session)
        except Exception as error:
            raise MCPError("FACE_ML_UNAVAILABLE", f"failed to load model sessions: {error}") from error

        self.cv2 = cv2
        self.detector = detector
        self.recognizer = recognizer
        self.norm_crop = norm_crop
        self.np = np
        self.image_cls = Image
        self.loaded = True

    @staticmethod
    def find_model_path(model_root: Path, model_type: str) -> Path | None:
        direct = model_root / model_type / "model.onnx"
        if direct.is_file():
            return direct

        with_name = model_root / "models" / model_type / "model.onnx"
        if with_name.is_file():
            return with_name

        candidates = list(model_root.rglob(f"{model_type}/model.onnx"))
        if not candidates:
            return None
        candidates.sort(key=lambda path: len(path.parts))
        return candidates[0]
