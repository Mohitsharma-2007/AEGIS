"""Deterministic hash-bow embeddings (384-d), embedder id ``hash-bow-v1``.

Tokenise lowercase alphanumeric tokens, hash each token with SHA-256
(never Python's salted ``hash()``) into a bucket with a sign, accumulate,
then L2-normalise. Cosine similarity is a plain dot product on the
normalised vectors.
"""
from __future__ import annotations

import hashlib
import math
import re

DIM = 384
EMBEDDER_ID = "hash-bow-v1"

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenise(text: str) -> list[str]:
    return _TOKEN_RE.findall((text or "").lower())


def embed(text: str) -> list[float]:
    vec = [0.0] * DIM
    for tok in tokenise(text):
        digest = hashlib.sha256(tok.encode("utf-8")).digest()
        bucket = int.from_bytes(digest[:4], "little") % DIM
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vec[bucket] += sign
    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0.0:
        return vec
    return [v / norm for v in vec]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    return sum(x * y for x, y in zip(a, b))
