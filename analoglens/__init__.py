"""AnalogLens: rank Earth locations as analogs for Moon-base and Mars sites, and explain why.

Pipeline: tiles (geo) -> terrain features and embeddings (terrain, embed) -> similarity
index (index) -> per-dimension scores and ranking (scoring) -> explained cards (cards)
-> validation (validate) -> served by a small API (api).
"""
__version__ = "0.1.0"
