from pathlib import Path

from huggingface_hub import hf_hub_download

REPO_ID = "immich-app/buffalo_l"
ONNX_MODEL_FILES = (
    "detection/model.onnx",
    "recognition/model.onnx",
)


def main() -> None:
    cache_dir = (Path(__file__).resolve().parent / ".cache").resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Explicit ONNX whitelist: this script never downloads non-onnx assets.
    for filename in ONNX_MODEL_FILES:
        path = hf_hub_download(
            repo_id=REPO_ID,
            filename=filename,
            cache_dir=cache_dir,
            local_dir=cache_dir,
            local_dir_use_symlinks=False,
        )
        print(f"{filename} -> {path}")


if __name__ == "__main__":
    main()
