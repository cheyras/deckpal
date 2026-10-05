"""Is this venv able to train on this machine's GPU?

    python check_env.py

Prints the torch/CUDA build, confirms the GPU is visible and that its compute
capability is in the build's arch list (a 5080 is sm_120, which only CUDA 12.8+
wheels carry), and runs a real matmul + conv + backward on it.
"""
from __future__ import annotations

import sys


def main() -> int:
    import onnx
    import onnxruntime
    import onnx2torch  # noqa: F401
    import cv2
    import numpy
    import torch

    print(f"python {sys.version.split()[0]}  torch {torch.__version__}  CUDA build {torch.version.cuda}  cudnn {torch.backends.cudnn.version()}")
    print(f"onnx {onnx.__version__}  onnxruntime {onnxruntime.__version__}  opencv {cv2.__version__}  numpy {numpy.__version__}")
    if not torch.cuda.is_available():
        print("FAIL: torch.cuda.is_available() is False")
        return 1
    cap = torch.cuda.get_device_capability(0)
    arch = f"sm_{cap[0]}{cap[1]}"
    print(f"device {torch.cuda.get_device_name(0)}  capability {arch}  build arch list {torch.cuda.get_arch_list()}")
    if arch not in torch.cuda.get_arch_list():
        print(f"FAIL: this torch build has no {arch} kernels (need the cu128+ wheels)")
        return 1
    dev = torch.device("cuda")
    a = torch.randn(2048, 2048, device=dev)
    b = (a @ a.T).sum()
    conv = torch.nn.Conv2d(3, 16, 3).to(dev)
    x = torch.randn(8, 3, 256, 256, device=dev, requires_grad=True)
    conv(x).mean().backward()
    torch.cuda.synchronize()
    print(f"matmul + conv + backward ran on {x.grad.device} (checksum {float(b):.1f}); free/total memory "
          f"{torch.cuda.mem_get_info()[0] / 2**30:.1f}/{torch.cuda.mem_get_info()[1] / 2**30:.1f} GiB")
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
