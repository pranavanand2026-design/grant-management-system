"""Extractor for Boosting Female Founders (BFF) grant agreements.

BFF agreements are Commonwealth Simple Grant Agreements.  They occur as both
DOCX and PDF, so this parser locates labelled sections and table headers rather
than page locations or agreement-item numbers.
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

from . import ac
from .documents import clean, read_docx, read_docx_tables, read_text


def _section(text: str, labels: tuple[str, ...], stops: tuple[str, ...]) -> str:
    """Text between a heading (a label alone on its line) and the next stop.

    Stops match at the start of a line rather than the whole line, so a section
    ends correctly even when the following heading runs straight into a
    sentence (e.g. "In undertaking the Activity, the Grantee must ...").
    """
    start = next((match for label in labels
                  if (match := re.search(r"(?im)^\s*(?:" + label + r")\s*$", text))), None)
    if not start:
        return ""
    tail = text[start.end():]
    ends = [m.start() for label in stops if (m := re.search(r"(?im)^\s*(?:" + label + r")", tail))]
    return tail[:min(ends) if ends else len(tail)]


def _table_with(tables, *needles):
    for table in tables:
        header = " ".join(table[0]).lower()
        if all(needle.lower() in header for needle in needles):
            return table
    return []


def _money(value):
    return ac.parse_money(value)


def _dates(value):
    return ac.parse_date(value)


def _label_value(table, label):
    for row in table:
        for index, cell in enumerate(row[:-1]):
            if clean(cell).lower() == label.lower():
                return row[index + 1]
    return None


def _split_name_description(cell: str) -> tuple[str, str]:
    """Split a milestone cell into (title, description).

    In the executed BFF agreement the cell is one paragraph: the bold name
    ("Milestone 3 - Facility setup") then a line break then the description. When the
    reader preserves that break the split is exact; if it doesn't (a PDF, or a
    cell with no break) we fall back to the lower→upper-case seam between the
    two, which is where the name ends and the sentence-cased description begins.
    """
    lines = [l for l in (cell or "").split("\n") if l.strip()]
    if len(lines) >= 2:
        name, description = lines[0], " ".join(lines[1:])
    else:
        raw = clean(cell)
        seam = re.search(r"(?<=[a-z])(?=[A-Z])", raw)
        name = raw[:seam.start()] if seam else raw
        description = raw[seam.start():] if seam else ""
    # Drop the redundant "Milestone N -" prefix so the title is the name itself.
    title = re.sub(r"(?i)^\s*milestone\s*\d+\s*[-–:]\s*", "", clean(name)).strip()
    return title or clean(name), clean(description)


def _parse_milestones(table):
    if not table:
        return []
    milestones = []
    for row in table[1:]:
        if len(row) < 3 or not re.search(r"\d", row[0]):
            continue
        number_match = re.search(r"\d+", row[0])
        title, description = _split_name_description(row[1])
        milestones.append({
            "number": int(number_match.group()),
            "title": title or f"Milestone {number_match.group()}",
            "activities": [description] if description else ([title] if title else []),
            # BFF's executed agreement supplies outcomes at project level, not as
            # measurable outcomes against individual milestones.
            "measurable_outcomes": [],
            "planned_achievement_date": _dates(row[2]),
        })
    return milestones


def _reference_number(text: str):
    """The grant reference (e.g. BFF000123).

    The reference is printed many times; in the table of contents a page number
    is appended to the heading ("…000539" → "…0005393"). The clean value is the
    one that recurs, with the shortest form breaking ties — a trailing page
    digit only ever makes a candidate longer, never shorter.
    """
    tokens = [t.upper() for t in re.findall(r"\bBFF[A-Z]*\d+\b", text, re.I)]
    if not tokens:
        return None
    counts = Counter(tokens)
    return max(counts, key=lambda t: (counts[t], -len(t)))


def _parse_caps(table):
    rows = []
    for row in table[1:] if table else []:
        if len(row) >= 2 and re.search(r"\d{4}/\d{2}", row[0]):
            rows.append({"financial_year": clean(row[0]), "capped_amount": _money(row[1])})
    return rows


def _parse_budget(table):
    rows = []
    for row in table[1:] if table else []:
        if len(row) < 2:
            continue
        # The agreement's all-financial-years table has category then amount.
        category = clean(row[-2]) if len(row) >= 3 else clean(row[0])
        amount = _money(row[-1])
        if category and amount is not None:
            rows.append({"category": category, "year1": None, "year2": None,
                         "total": amount, "is_total": False})
    return rows


def _parse_reports(table):
    reports = []
    for row in table[1:] if table else []:
        if not row:
            continue
        padded = row + [""] * (5 - len(row))
        reports.append({
            "report_type": clean(padded[0]),
            "period_start_date": _dates(padded[1]),
            "period_end_date": _dates(padded[2]),
            "due_date": _dates(padded[4]) or clean(padded[4]) or None,
        })
    return reports


def _line_after(text: str, label: str):
    match = re.search(r"(?im)^\s*" + re.escape(label) + r"\s*$\s*^\s*(.+?)\s*$", text)
    return clean(match.group(1)) if match else None


def _text_milestones(text: str):
    """Milestone fallback for text-only sources (a PDF, or a DOCX with no
    milestone table). The DOCX path uses the table via ``_parse_milestones``,
    which keeps the name/description line break intact; here the two have
    already been flattened onto one line, so ``_split_name_description`` recovers
    the seam."""
    region = _section(text, (r"Activity Schedule",), (r"Payment of the Grant",))
    pattern = re.compile(
        r"(?ms)^\s*(\d{1,3})\s*$\s*^\s*(.+?)\s*$\s*^\s*(\d{1,2}/\d{1,2}/\d{4})\s*$")
    milestones = []
    for match in pattern.finditer(region):
        title, description = _split_name_description(match.group(2))
        milestones.append({
            "number": int(match.group(1)),
            "title": title,
            "activities": [description] if description else ([title] if title else []),
            # BFF's executed agreement supplies outcomes at project level,
            # not as measurable outcomes against individual milestones.
            "measurable_outcomes": [],
            "planned_achievement_date": _dates(match.group(3)),
        })
    return milestones


def _text_caps(text: str):
    region = _section(text, (r"Payment of the Grant",), (r"Invoicing", r"Reporting"))
    return [{"financial_year": fy, "capped_amount": _money(amount)}
            for fy, amount in re.findall(r"(?m)^\s*(\d{4}/\d{2})\s*$\s*^\s*(\$[\d,]+(?:\.\d+)?)\s*$", region)]


def _text_reports(text: str):
    region = _section(text, (r"Reporting",), (r"Party representatives and address for notices",))
    pattern = re.compile(
        r"(?ms)^\s*(Progress report|End of project report)\s*$\s*"
        r"^\s*(\d{1,2}/\d{1,2}/\d{4})\s*$\s*"
        r"^\s*(\d{1,2}/\d{1,2}/\d{4})\s*$\s*"
        r"^\s*(\d{1,2}/\d{1,2}/\d{4})\s*$")
    reports = [{"report_type": clean(m.group(1)), "period_start_date": _dates(m.group(2)),
                "period_end_date": _dates(m.group(3)), "due_date": _dates(m.group(4))}
               for m in pattern.finditer(region)]
    end_project = re.search(
        r"(?ims)^\s*End of project report\s*$\s*^\s*(\d{1,2}/\d{1,2}/\d{4})\s*$\s*^\s*(\d{1,2}/\d{1,2}/\d{4})\s*$",
        region)
    if end_project:
        reports.append({"report_type": "End of project report",
                        "period_start_date": _dates(end_project.group(1)),
                        "period_end_date": _dates(end_project.group(2)), "due_date": None})
    audit = re.search(r"(?im)^\s*Independent audit report\s*$\s*^\s*(\d{1,2}/\d{1,2}/\d{4})\s*$", region)
    if audit:
        reports.append({"report_type": "Independent audit report", "period_start_date": None,
                        "period_end_date": None, "due_date": _dates(audit.group(1))})
    return reports


def _text_budget(text: str):
    match = re.search(r"(?is)All financial years\s+Head of expenditure.*?(?=Figures in the above table)", text)
    if not match:
        return []
    rows = []
    for category, amount in re.findall(
            r"(?im)^\s*Project expenditure\s*$\s*^\s*(.+?)\s*$\s*^\s*(\$[\d,]+(?:\.\d+)?)\s*$", match.group()):
        rows.append({"category": clean(category), "year1": None, "year2": None,
                     "total": _money(amount), "is_total": False})
    total = re.search(r"(?im)^\s*All financial years total\s*$\s*^\s*(\$[\d,]+(?:\.\d+)?)\s*$", match.group())
    if total:
        rows.append({"category": "Total", "year1": None, "year2": None,
                     "total": _money(total.group(1)), "is_total": True})
    return rows


def extract(path: str) -> dict:
    suffix = Path(path).suffix.lower()
    text = read_text(path)
    if not re.search(r"Boosting\s+(?:Female|Building)\s+Founders|BFFGII", text, re.I):
        raise ValueError("This file does not appear to be a Boosting Female Founders grant agreement.")
    tables = read_docx(path)[1] if suffix == ".docx" else []
    # The milestone name and its description share one paragraph, split by a
    # soft line break; the rich reader keeps that break so the two never fuse.
    rich_tables = read_docx_tables(path) if suffix == ".docx" else []
    grantee_table = _table_with(tables, "Full legal name", "ABN")
    milestone_table = _table_with(rich_tables, "Milestone number", "Due date")
    caps_table = _table_with(tables, "Financial year", "Annual capped amount")
    reports_table = _table_with(tables, "Report type", "Due date")
    budget_table = _table_with(tables, "Head of expenditure", "Agreed project cost")

    title_block = _section(text, (r"Project title",), (r"Project scope and description", r"Project outcomes"))
    outcomes = _section(text, (r"Project outcomes",), (r"In undertaking the Activity", r"Duration of the Grant"))
    duration = _section(text, (r"Duration of the Grant",), (r"Activity Schedule", r"Payment of the Grant"))
    grant_amount = re.search(r"total amount of the Grant is\s*(\$[\d,]+(?:\.\d+)?)", text, re.I)
    percentage = re.search(r"up to\s*([\d.]+)\s*per cent", text, re.I)
    activity = re.search(r"Activity starts on\s+(.+?)\s+and ends on\s+(.+?)(?:,|\s+which)", duration, re.I)
    end = re.search(r"Agreement ends on\s+(.+?)(?:,|\s+which)", duration, re.I)

    flat = {
        "recipient": {"name": _label_value(grantee_table, "Full legal name of Grantee")
                                or _line_after(text, "Full legal name of Grantee"),
                      "abn": _label_value(grantee_table, "Australian Business Number (ABN) or other entity identifiers")
                              or _line_after(text, "Australian Business Number (ABN) or other entity identifiers")},
        "agreement_commencement_date": None,
        "agreement_end_date": _dates(end.group(1)) if end else None,
        "project_reference_number": _reference_number(text),
        "project_title": clean(title_block).split("\n")[0] if title_block else None,
        "project_start_date": _dates(activity.group(1)) if activity else None,
        "project_end_date": _dates(activity.group(2)) if activity else None,
        "maximum_funds": _money(grant_amount.group(1)) if grant_amount else None,
        "grant_percentage": float(percentage.group(1)) if percentage else None,
        "project_outcomes": clean(outcomes) or None,
        "milestones": _parse_milestones(milestone_table) or _text_milestones(text),
        "budget": _text_budget(text) or _parse_budget(budget_table),
        "annual_capped_amounts": _text_caps(text) or _parse_caps(caps_table),
        "initial_progress_payment": None,
        "retention_amount": None,
        "reports": _text_reports(text) or _parse_reports(reports_table),
    }
    flat["entities"] = ac.build_entities(flat)
    flat["entities"]["grant"]["grantType"] = "bff"
    flat["entities"]["grant"]["paymentTrigger"] = "milestone_completion"
    return flat
