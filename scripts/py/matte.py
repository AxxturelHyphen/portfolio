"""Local ML matting fallback for the cutout stage (build time only, never shipped, no hosted service).

Usage: python matte.py <model> <in.png> <out.png> [<in.png> <out.png> ...]
Writes one 8-bit greyscale alpha per input at the input's size. Models are rembg sessions (isnet-general-use,
birefnet-general, ...) cached in scripts/py/models/. Prints one JSON line with the provider that ran.
"""

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("U2NET_HOME", str(Path(__file__).parent / "models"))

import onnxruntime  # noqa: E402
from PIL import Image  # noqa: E402
from rembg import new_session, remove  # noqa: E402

PROVIDERS = ["CUDAExecutionProvider", "CPUExecutionProvider"]


def main(argv: list[str]) -> None:
    if len(argv) < 3 or len(argv) % 2 == 0:
        raise SystemExit(__doc__)
    onnxruntime.preload_dlls()
    session = new_session(argv[0], providers=PROVIDERS)
    provider = session.inner_session.get_providers()[0]
    pairs = argv[1:]
    for i in range(0, len(pairs), 2):
        img = Image.open(pairs[i]).convert("RGB")
        alpha = remove(img, session=session, only_mask=True, post_process_mask=False)
        alpha.convert("L").save(pairs[i + 1])
    print(json.dumps({"model": argv[0], "provider": provider, "count": len(pairs) // 2}))


if __name__ == "__main__":
    main(sys.argv[1:])
