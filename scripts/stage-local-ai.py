#!/usr/bin/env python3
"""Stage verified model and native runtime files for an offline installer.
Run on the build machine, not on the customer's computer.
"""
import argparse
import hashlib
import pathlib
import shutil
import urllib.request

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model-url", required=True)
    p.add_argument("--model-sha256", required=True)
    p.add_argument("--runtime-dir", required=True, type=pathlib.Path)
    p.add_argument("--model-license", required=True, type=pathlib.Path)
    p.add_argument("--runtime-license", required=True, type=pathlib.Path)
    p.add_argument("--output", required=True, type=pathlib.Path)
    a = p.parse_args()
    if not a.model_url.startswith("https://"):
        p.error("Model URL must use HTTPS")
    if len(a.model_sha256) != 64 or any(c not in "0123456789abcdefABCDEF" for c in a.model_sha256):
        p.error("Expected a pinned SHA-256 digest")
    runtime = a.runtime_dir
    if not any((runtime / n).is_file() for n in ("llama-server", "llama-server.exe")):
        p.error("Runtime directory must contain llama-server and its native dependencies")
    a.output.mkdir(parents=True, exist_ok=True)
    model = a.output / "model.gguf"
    temp = a.output / "model.gguf.partial"
    try:
        if not model.exists() or digest(model) != a.model_sha256.lower():
            with urllib.request.urlopen(a.model_url, timeout=60) as src, temp.open("wb") as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
            if digest(temp) != a.model_sha256.lower():
                raise ValueError("Model SHA-256 mismatch")
            with temp.open("rb") as f:
                if f.read(4) != b"GGUF":
                    raise ValueError("Not a GGUF model")
            temp.replace(model)
        shutil.copytree(runtime, a.output / "runtime", dirs_exist_ok=True)
        shutil.copyfile(a.model_license, a.output / "MODEL-LICENSE.txt")
        shutil.copyfile(a.runtime_license, a.output / "RUNTIME-LICENSE.txt")
    finally:
        temp.unlink(missing_ok=True)

if __name__ == "__main__":
    main()
