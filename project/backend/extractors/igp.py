"""
Structured-data extractor for Industry Growth Program (IGP) grant
agreements.

Not implemented yet. IGP uses its own agreement template, distinct from
the AC Commonwealth template in `ac.py`, so this needs its own anchors and
parsing once we have sample agreements to work from.

Public entry point:

    extract(pdf_path: str) -> dict
"""

from __future__ import annotations


def extract(pdf_path: str) -> dict:
    raise NotImplementedError("IGP grant extraction is not implemented yet.")
