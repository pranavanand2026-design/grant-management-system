"""
Extractor for the government "Mandatory Attachment: Project Milestones"
DOCX template.

The template is a fixed 5-column table: Milestone | Title & key activities |
Start date | End date | Estimated cost. It is filled at application time and
is the origin of milestone start dates, end dates, and estimated costs — none
of which appear in the funding agreement. The document itself says estimated
costs are "sought for assessment purposes only", so everything here is
advisory, never contractual.

Dates arrive in two shapes: exact dd/mm/yyyy with inconsistent zero padding
("01/08/2020", "1/02/2021") and month-year only ("Mar 2021"). A month-only
value resolves to the first day for a start date and the last day for an end
date, and the raw string is always kept alongside the resolved date so the
interface never pretends to know a day it was not given.

Public entry point:

    extract(docx_path: str) -> dict
"""

from __future__ import annotations

import calendar
import re
import zipfile
from datetime import datetime
from typing import List, Optional
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_W = "{%s}" % W_NS

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

SOURCE = "application_attachment"


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").replace("\xa0", " ").strip()


def _para_text(p) -> str:
    return "".join(t.text or "" for t in p.iter(_W + "t"))


def _cell_paragraphs(tc) -> List[str]:
    return [_clean(_para_text(p)) for p in tc.iter(_W + "p") if _clean(_para_text(p))]


def resolve_date(raw: str, is_end: bool) -> dict:
    """
    Return {"raw", "date", "precision"} for a template date cell.

    dd/mm/yyyy (any zero padding) -> exact date, precision "day".
    "Mar 2021"                    -> first/last day of month, precision "month".
    Anything else                 -> date None, precision None.
    """
    raw = _clean(raw)
    out = {"raw": raw or None, "date": None, "precision": None}
    if not raw:
        return out

    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", raw)
    if m:
        day, month, year = (int(g) for g in m.groups())
        try:
            out["date"] = datetime(year, month, day).date().isoformat()
            out["precision"] = "day"
        except ValueError:
            pass
        return out

    m = re.fullmatch(r"([A-Za-z]{3,9})\.?\s+(\d{4})", raw)
    if m:
        month = _MONTHS.get(m.group(1)[:3].lower())
        year = int(m.group(2))
        if month:
            day = calendar.monthrange(year, month)[1] if is_end else 1
            out["date"] = datetime(year, month, day).date().isoformat()
            out["precision"] = "month"
    return out


def _parse_money(text: str) -> Optional[float]:
    m = re.search(r"\$?\s*([\d,]+(?:\.\d+)?)", text or "")
    if not m:
        return None
    value = float(m.group(1).replace(",", ""))
    return int(value) if value.is_integer() else value


def _parse_title_cell(paragraphs: List[str]) -> dict:
    """
    The "Title & key activities" cell packs four things into one cell:
    "Title: ...", "Activities:" + bullets, "Activities undertaken by: ...",
    and "Expected measurable outcome(s):" + bullets. Split them apart.
    """
    title = None
    activities: List[str] = []
    undertaken_by = None
    outcomes: List[str] = []
    section = None

    for p in paragraphs:
        low = p.lower()
        if low.startswith("title:"):
            title = _clean(p[len("title:"):])
            section = "title"
            continue
        if low.startswith("activities undertaken by"):
            undertaken_by = _clean(p.split(":", 1)[1]) if ":" in p else None
            section = "undertaken"
            continue
        if low.startswith("activities"):
            section = "activities"
            rest = _clean(p.split(":", 1)[1]) if ":" in p else ""
            if rest:
                activities.append(rest.lstrip("-–• "))
            continue
        if low.startswith("expected measurable outcome"):
            section = "outcomes"
            rest = _clean(p.split(":", 1)[1]) if ":" in p else ""
            if rest:
                outcomes.append(rest.lstrip("-–• "))
            continue

        stripped = p.lstrip("-–• ")
        if section == "activities":
            activities.append(stripped)
        elif section == "outcomes":
            outcomes.append(stripped)
        elif section == "title" and title is not None:
            title = _clean(title + " " + p)

    # Some programs use the same five-column milestone template but omit the
    # AC-specific "Title:" / "Activities:" labels. Preserve those attachments
    # too: first paragraph is the title, remaining paragraphs are activities.
    if title is None and paragraphs:
        title = paragraphs[0]
        activities = [p.lstrip("-–• ") for p in paragraphs[1:] if p]

    return {
        "title": title,
        "activities": [a for a in activities if a],
        "undertaken_by": undertaken_by,
        "measurable_outcomes": [o for o in outcomes if o],
    }


def extract(docx_path: str) -> dict:
    """
    Extract the milestone table from a Mandatory Attachment: Project
    Milestones DOCX. Raises ValueError if the document does not contain the
    expected 5-column table.
    """
    try:
        with zipfile.ZipFile(docx_path) as z:
            root = ET.fromstring(z.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError) as exc:
        raise ValueError("This file does not appear to be a Word document.") from exc

    tables = root.findall(".//" + _W + "tbl")
    table = None
    for tbl in tables:
        rows = tbl.findall(_W + "tr")
        if not rows:
            continue
        header = [_clean(" ".join(_cell_paragraphs(tc))) for tc in rows[0].findall(_W + "tc")]
        if len(header) == 5 and header[0].lower().startswith("milestone"):
            table = rows
            break
    if table is None:
        raise ValueError(
            "This file does not appear to be a Mandatory Attachment: Project "
            "Milestones template (5-column milestone table not found)."
        )

    milestones = []
    total_estimated_cost = None
    for tr in table[1:]:
        cells = [_cell_paragraphs(tc) for tc in tr.findall(_W + "tc")]
        if len(cells) < 5:
            continue
        num_text = _clean(" ".join(cells[0]))
        title_text = _clean(" ".join(cells[1]))
        if title_text.upper().startswith("TOTAL"):
            total_estimated_cost = _parse_money(" ".join(cells[4]))
            continue
        if not num_text.isdigit():
            continue

        parsed = _parse_title_cell(cells[1])
        start = resolve_date(" ".join(cells[2]), is_end=False)
        end = resolve_date(" ".join(cells[3]), is_end=True)
        milestones.append({
            "number": int(num_text),
            "title": parsed["title"],
            "activities": parsed["activities"],
            "undertaken_by": parsed["undertaken_by"],
            "measurable_outcomes": parsed["measurable_outcomes"],
            "start_date": start["date"],
            "start_date_raw": start["raw"],
            "start_date_precision": start["precision"],
            "end_date": end["date"],
            "end_date_raw": end["raw"],
            "end_date_precision": end["precision"],
            "estimated_cost": _parse_money(" ".join(cells[4])),
        })

    if not milestones:
        raise ValueError("The milestone table contains no milestone rows.")

    return {
        "source": SOURCE,
        "advisory": True,
        "milestones": milestones,
        "total_estimated_cost": total_estimated_cost,
    }
