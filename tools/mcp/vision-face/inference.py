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


def read_config(config_path: Path) -> dict[str, Any]:
    if not config_path.exists() or not config_path.is_file():
        raise MCPError("MCP_TOOL_CALL_FAILED", f"config file not found: {config_path}")
    try:
        parsed = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as error:
        raise MCPError("MCP_TOOL_CALL_FAILED", f"failed to parse config file: {error}") from error
    if not isinstance(parsed, dict):
        raise MCPError("MCP_TOOL_CALL_FAILED", "config root must be an object")

    model_name = str(parsed.get("modelName") or "buffalo_l")
    model_repo = str(parsed.get("modelRepo") or f"immich-app/{model_name}")

    cache_raw = parsed.get("modelCacheDir")
    if isinstance(cache_raw, str) and cache_raw.strip():
        cache_dir = Path(cache_raw)
        if not cache_dir.is_absolute():
            cache_dir = (config_path.parent / cache_dir).resolve()
    else:
        cache_dir = (Path.home() / ".cache" / "fauplay" / "vision-face" / model_name).resolve()

    return {
        "modelName": model_name,
        "modelRepo": model_repo,
        "modelCacheDir": str(cache_dir),
        "minScore": float(parsed.get("minScore", 0.7)),
        "maxDistance": float(parsed.get("maxDistance", 0.5)),
        "minFaces": int(parsed.get("minFaces", 3)),
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

        self.loaded = False
        self.detector: Any = None
        self.recognizer: Any = None
        self.norm_crop: Any = None
        self.np: Any = None
        self.image_cls: Any = None

    def detect_asset(self, absolute_path: Path) -> list[dict[str, Any]]:
        self.ensure_loaded()
        assert self.np is not None
        assert self.image_cls is not None
        assert self.detector is not None
        assert self.recognizer is not None
        assert self.norm_crop is not None

        try:
            with self.image_cls.open(absolute_path) as img:
                rgb = self.np.array(img.convert("RGB"))
        except Exception as error:
            raise MCPError("MCP_INVALID_PARAMS", f"failed to decode image: {absolute_path}") from error

        # InsightFace expects BGR numpy arrays.
        bgr = self.np.ascontiguousarray(rgb[:, :, ::-1])
        bboxes, landmarks = self.detector.detect(bgr)
        if bboxes is None or landmarks is None or len(bboxes) == 0:
            return []

        cropped_faces = [self.norm_crop(bgr, landmark) for landmark in landmarks]
        embeddings = self.recognizer.get_feat(cropped_faces)

        results: list[dict[str, Any]] = []
        for bbox, embedding in zip(bboxes, embeddings):
            score = float(bbox[4])
            if score < self.min_score:
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
                }
            )
        return results

    def ensure_loaded(self) -> None:
        if self.loaded:
            return

        try:
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
