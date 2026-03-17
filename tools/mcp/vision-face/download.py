from pathlib import Path
from huggingface_hub import hf_hub_download
root=Path('/home/kevin/Projects/fauplay')
cache=(root/'tools/mcp/vision-face/.cache').resolve()
cache.mkdir(parents=True, exist_ok=True)
for name in ['detection/model.onnx','recognition/model.onnx']:
    path=hf_hub_download(repo_id='immich-app/buffalo_l', filename=name, cache_dir=cache, local_dir=cache)
    print(name,'->',path)