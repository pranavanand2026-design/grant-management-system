"""Grant-program registry and its stable extraction interface."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from . import ac, arena, bff, igp, mvp_venture


@dataclass(frozen=True)
class GrantProgram:
    key: str
    label: str
    extract: Callable[[str], dict[str, Any]]
    implemented: bool


PROGRAMS = {
    program.key: program
    for program in (
        GrantProgram("ac", "Accelerating Commercialisation (AC)", ac.extract, True),
        GrantProgram("bff", "Boosting Female Founders (BFF)", bff.extract, True),
        GrantProgram("arena", "ARENA", arena.extract, False),
        GrantProgram("igp", "Industry Growth Program (IGP)", igp.extract, False),
        GrantProgram("mvp_venture", "MVP Venture", mvp_venture.extract, False),
    )
}

# Compatibility exports for code that consumes the original registry shape.
EXTRACTORS = {key: program.extract for key, program in PROGRAMS.items()}
GRANT_TYPE_LABELS = {key: program.label for key, program in PROGRAMS.items()}
IMPLEMENTED_GRANT_TYPES = {
    key for key, program in PROGRAMS.items() if program.implemented
}


def get_extractor(grant_type: str):
    return PROGRAMS[grant_type].extract
