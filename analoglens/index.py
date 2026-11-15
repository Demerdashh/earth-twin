"""Nearest-neighbour index over Earth tile embeddings.

cosine_all() scores every tile against a target (needed for full ranking); search() returns
the top k (FAISS when installed, numpy otherwise). to_unit() maps raw cosine to a 0-1 terrain
score calibrated on random Earth pairs: a typical unrelated pair scores 0, the top 0.5% of
pairs score 1. Raw cosines from different embedders are not comparable; calibrated ones are.
"""
from __future__ import annotations

import numpy as np


class AnalogIndex:
    def __init__(self, standardize: bool = True):
        self.standardize = standardize
        self.mu = self.sd = self.X = None
        self.ids: list[str] = []
        self.c_lo, self.c_hi = 0.0, 1.0
        self._faiss = None

    def _prep(self, feats: np.ndarray) -> np.ndarray:
        z = (np.asarray(feats, np.float32) - self.mu) / self.sd
        return z / (np.linalg.norm(z, axis=1, keepdims=True) + 1e-9)

    def build(self, feats: np.ndarray, ids, seed: int = 0, n_pairs: int = 20000):
        feats = np.asarray(feats, np.float32)
        if self.standardize:
            self.mu, self.sd = feats.mean(0), feats.std(0) + 1e-6
        else:
            self.mu, self.sd = np.zeros(feats.shape[1], np.float32), np.ones(feats.shape[1], np.float32)
        self.X = self._prep(feats)
        self.ids = list(ids)
        rng = np.random.default_rng(seed)
        i, j = rng.integers(0, len(feats), n_pairs), rng.integers(0, len(feats), n_pairs)
        keep = i != j
        sims = np.einsum("ij,ij->i", self.X[i[keep]], self.X[j[keep]])
        self.c_lo, self.c_hi = float(np.percentile(sims, 50)), float(np.percentile(sims, 99.5))
        try:
            import faiss

            self._faiss = faiss.IndexFlatIP(self.X.shape[1])
            self._faiss.add(self.X)
        except ImportError:
            self._faiss = None
        return self

    def cosine_all(self, query: np.ndarray) -> np.ndarray:
        return self.X @ self._prep(np.atleast_2d(query))[0]

    def to_unit(self, cosine: np.ndarray) -> np.ndarray:
        return np.clip((np.asarray(cosine) - self.c_lo) / (self.c_hi - self.c_lo + 1e-9), 0.0, 1.0)

    def search(self, query: np.ndarray, k: int = 20):
        q = self._prep(np.atleast_2d(query))
        k = min(k, len(self.ids))
        if self._faiss is not None:
            sims, idx = self._faiss.search(q, k)
            sims, idx = sims[0], idx[0]
        else:
            all_sims = self.X @ q[0]
            idx = np.argsort(-all_sims)[:k]
            sims = all_sims[idx]
        return [(self.ids[i], float(s)) for i, s in zip(idx, sims)]

    def save(self, path):
        np.savez_compressed(path, X=self.X, mu=self.mu, sd=self.sd, ids=np.array(self.ids),
                            calib=np.array([self.c_lo, self.c_hi]), standardize=self.standardize)

    @classmethod
    def load(cls, path):
        data = np.load(path, allow_pickle=False)
        idx = cls(bool(data["standardize"]))
        idx.X, idx.mu, idx.sd = data["X"], data["mu"], data["sd"]
        idx.ids = [str(s) for s in data["ids"]]
        idx.c_lo, idx.c_hi = (float(v) for v in data["calib"])
        try:
            import faiss

            idx._faiss = faiss.IndexFlatIP(idx.X.shape[1])
            idx._faiss.add(idx.X)
        except ImportError:
            pass
        return idx
