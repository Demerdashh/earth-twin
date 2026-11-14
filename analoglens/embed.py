"""Turn elevation tiles into vectors whose cosine similarity means "shaped alike".

* DinoEmbedder: DINOv2 (self-supervised vision transformer) on relief_image(), averaged over
  four 90-degree rotations so a landform's compass direction does not matter. Needs torch
  and a one-time weight download from torch.hub (cache it before the event).
* DescriptorEmbedder: hand-built, scale-free shape descriptors. No downloads, runs anywhere,
  and doubles as the honest baseline for the ablation slide.

Use get_embedder("auto") to take DINOv2 when available and fall back otherwise.
"""
from __future__ import annotations

import warnings

import numpy as np

from .terrain import relief_image, shape_vector


class DescriptorEmbedder:
    name = "descriptors"
    standardize = True  # features have different units, so the index z-scores them

    def embed(self, tiles, res_m: float) -> np.ndarray:
        return np.stack([shape_vector(t, res_m) for t in tiles]).astype(np.float32)


class DinoEmbedder:
    name = "dinov2"
    standardize = False  # transformer features are compared as they are

    def __init__(self, model: str = "dinov2_vits14", device: str | None = None, rotations: int = 4,
                 batch_size: int = 32, image_size: int = 224):
        import torch
        import torch.nn.functional as F

        self.torch, self.F = torch, F
        if device is None:
            if torch.cuda.is_available():
                device = "cuda"
            elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"
        self.device = device
        self.model = torch.hub.load("facebookresearch/dinov2", model).to(device).eval()
        self.name = model
        self.rotations, self.batch_size, self.image_size = rotations, batch_size, image_size
        self.mean = torch.tensor([0.485, 0.456, 0.406], device=device).view(1, 3, 1, 1)
        self.std = torch.tensor([0.229, 0.224, 0.225], device=device).view(1, 3, 1, 1)

    def embed(self, tiles, res_m: float) -> np.ndarray:
        torch, F = self.torch, self.F
        images = np.stack([relief_image(np.rot90(t, k), res_m) for t in tiles for k in range(self.rotations)])
        feats = []
        with torch.no_grad():
            for i in range(0, len(images), self.batch_size):
                x = torch.from_numpy(images[i:i + self.batch_size]).to(self.device)
                x = x.permute(0, 3, 1, 2).float() / 255.0
                x = F.interpolate(x, size=(self.image_size, self.image_size), mode="bilinear", align_corners=False)
                x = (x - self.mean) / self.std
                feats.append(self.model(x).float().cpu().numpy())  # CLS embedding per image
        f = np.concatenate(feats).reshape(len(tiles), self.rotations, -1).mean(axis=1)
        return (f / (np.linalg.norm(f, axis=1, keepdims=True) + 1e-9)).astype(np.float32)


def get_embedder(kind: str = "auto", **kwargs):
    """kind: "auto" (DINOv2 if it loads, else descriptors), "dino", or "descriptors"."""
    if kind == "descriptors":
        return DescriptorEmbedder()
    if kind == "dino":
        return DinoEmbedder(**kwargs)
    try:
        return DinoEmbedder(**kwargs)
    except Exception as exc:  # torch missing, no internet for weights, out of memory...
        warnings.warn(f"DINOv2 unavailable ({exc.__class__.__name__}: {exc}); using descriptor embedder")
        return DescriptorEmbedder()
