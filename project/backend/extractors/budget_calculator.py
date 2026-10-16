"""
Parser for the government "Project Budget Calculator" XLSM workbook.

Two jobs:

1. The Summary sheet's quarterly eligible-expenditure grid, by category.
   This is application-time phasing and may differ from the executed
   agreement. Cross-validation reports differences; this parser only reads.

2. The apportionment rules — the percentages that convert raw accounting
   totals into eligible expenditure:
     - Labour: per-employee salary and % of time on project
     - Plant: per-asset purchase cost, total depreciation, running costs,
       and % of use. Eligible plant = (depreciation + running) x % use.
       The purchase cost itself is never eligible.
     - Contract: per-contractor name, purpose, planned payments.

Everything returned carries source "budget_calculator" and is advisory.

Public entry point:

    extract(xlsm_path: str) -> dict
"""

from __future__ import annotations

import datetime as _dt
import re
from typing import List, Optional

import openpyxl

SOURCE = "budget_calculator"

CATEGORY_LABELS = [
    "Labour Expenditure",
    "Contract Expenditure",
    "Plant Expenditure",
    "State of the Art Manufacturing",
    "Prototype Expenditure",
    "Other Expenditure",
]

# The Summary sheet's SMP/PMP row label differs from the agreement's.
CATEGORY_CANONICAL = {"State of the Art Manufacturing": "SMP/PMP Expenditure"}


def _iso(v) -> Optional[str]:
    if isinstance(v, (_dt.datetime, _dt.date)):
        return v.date().isoformat() if isinstance(v, _dt.datetime) else v.isoformat()
    return None


def _num(v) -> Optional[float]:
    if isinstance(v, (int, float)):
        return int(v) if float(v).is_integer() else round(float(v), 2)
    return None


def _clean(v) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


def _is_placeholder(name: str) -> bool:
    return not name or name.lower().startswith("insert ")


def _find_row(ws, col: int, predicate, start: int = 1, end: int = 200) -> Optional[int]:
    for ri in range(start, min(end, ws.max_row) + 1):
        if predicate(_clean(ws.cell(ri, col).value)):
            return ri
    return None


def _parse_summary(ws) -> dict:
    header_row = _find_row(ws, 6, lambda s: s == "Q1", start=1, end=40)
    if header_row is None:
        raise ValueError("Summary sheet quarterly grid not found.")

    # Quarter columns run rightward from F; each has a start date two rows
    # below the Q label and an end date four rows below. "Finalised" marks
    # the end of the real project period.
    quarter_cols = []
    for ci in range(6, ws.max_column + 1):
        label = _clean(ws.cell(header_row, ci).value)
        if not re.fullmatch(r"Q[1-4]", label):
            continue
        start = ws.cell(header_row + 1, ci).value
        end = ws.cell(header_row + 3, ci).value
        if _iso(start) is None or _iso(end) is None:
            continue
        quarter_cols.append({"col": ci, "start": _iso(start), "end": _iso(end)})

    rows = {}
    for label in CATEGORY_LABELS:
        ri = _find_row(ws, 2, lambda s, l=label: s.startswith(l[:20]), start=header_row, end=header_row + 15)
        if ri is not None:
            rows[label] = ri
    total_row = _find_row(ws, 2, lambda s: s.startswith("Total eligible expenditure"),
                          start=header_row, end=header_row + 15)

    quarters = []
    for qi, qc in enumerate(quarter_cols, start=1):
        by_category = {}
        for label, ri in rows.items():
            canonical = CATEGORY_CANONICAL.get(label, label)
            by_category[canonical] = _num(ws.cell(ri, qc["col"]).value) or 0
        total = _num(ws.cell(total_row, qc["col"]).value) if total_row else None
        quarters.append({
            "sequence": qi,
            "period_start": qc["start"],
            "period_end": qc["end"],
            "by_category": by_category,
            "total": total if total is not None else round(sum(by_category.values()), 2),
        })

    year_totals = {}
    for label, ri in rows.items():
        canonical = CATEGORY_CANONICAL.get(label, label)
        # Year total columns carry a date header where quarter columns do;
        # simplest reliable rule: the grid repeats [Q1..Q4, Year N]; the last
        # column overall is the grand total. Sum quarters per category instead
        # of trusting merged layout.
        year_totals[canonical] = round(
            sum(q["by_category"][canonical] for q in quarters), 2
        )

    return {"quarters": quarters, "category_totals": year_totals}


def _parse_labour(ws) -> List[dict]:
    header = _find_row(ws, 3, lambda s: s == "Employee Name", end=30)
    if header is None:
        return []
    stop = _find_row(ws, 5, lambda s: s.startswith("Total A"), start=header) or (header + 30)
    employees = []
    for ri in range(header + 1, stop):
        name = _clean(ws.cell(ri, 3).value)
        if _is_placeholder(name):
            continue
        employees.append({
            "name": name,
            "title": _clean(ws.cell(ri, 5).value) or None,
            "annual_salary": _num(ws.cell(ri, 8).value),
            "employed_from": _iso(ws.cell(ri, 9).value),
            "employed_to": _iso(ws.cell(ri, 10).value),
            "pct_time_on_project": _num(ws.cell(ri, 11).value),
        })
    return employees


def _parse_plant(ws) -> List[dict]:
    header = _find_row(ws, 3, lambda s: s.startswith("Description of plant"), end=30)
    if header is None:
        return []
    stop = _find_row(ws, 4, lambda s: s.startswith("Total A"), start=header) or (header + 30)
    assets = []
    for ri in range(header + 1, stop):
        name = _clean(ws.cell(ri, 3).value)
        if _is_placeholder(name):
            continue
        pct = _num(ws.cell(ri, 9).value)
        depreciation = _num(ws.cell(ri, 7).value)
        running = _num(ws.cell(ri, 8).value)
        eligible = None
        if pct is not None and depreciation is not None:
            eligible = round((depreciation + (running or 0)) * pct, 2)
        assets.append({
            "description": name,
            "acquisition": _clean(ws.cell(ri, 4).value) or None,
            "date_acquired": _iso(ws.cell(ri, 5).value),
            "purchase_cost": _num(ws.cell(ri, 6).value),
            "purchase_cost_eligible": False,
            "total_depreciation": depreciation,
            "total_running_costs": running,
            "pct_use_on_project": pct,
            "eligible_amount": eligible,
        })
    return assets


def _parse_contract(ws) -> List[dict]:
    contractors = []
    header = _find_row(ws, 3, lambda s: s == "Contractor Name", end=120)
    while header is not None:
        # Each section labels its payments column differently ("Planned
        # annual payments" vs "Planned total payments"); find it per section.
        payment_col = None
        for ci in range(4, 13):
            if _clean(ws.cell(header, ci).value).lower().startswith("planned"):
                payment_col = ci
                break
        stop = _find_row(ws, 4, lambda s: s.startswith("Total"), start=header) or (header + 12)
        for ri in range(header + 1, stop):
            name = _clean(ws.cell(ri, 3).value)
            if _is_placeholder(name):
                continue
            if any(c["name"] == name for c in contractors):
                continue
            contractors.append({
                "name": name,
                "purpose": _clean(ws.cell(ri, 4).value) or None,
                "planned_payments": _num(ws.cell(ri, payment_col).value) if payment_col else None,
            })
        header = _find_row(ws, 3, lambda s: s == "Contractor Name", start=stop + 1, end=200)
    return contractors


def extract(xlsm_path: str) -> dict:
    """
    Parse a Project Budget Calculator workbook. Raises ValueError when the
    workbook does not contain the expected Summary sheet.
    """
    try:
        wb = openpyxl.load_workbook(xlsm_path, data_only=True)
    except Exception as exc:
        raise ValueError("This file could not be read as an Excel workbook.") from exc

    if "Summary" not in wb.sheetnames:
        raise ValueError(
            "This workbook does not appear to be a Project Budget Calculator "
            "(no Summary sheet found)."
        )
    summary_ws = wb["Summary"]
    if not _find_row(summary_ws, 1, lambda s: s.startswith("Project Budget Calculator"), end=5):
        raise ValueError(
            "This workbook does not appear to be a Project Budget Calculator."
        )

    summary = _parse_summary(summary_ws)

    return {
        "source": SOURCE,
        "advisory": True,
        "company_name": _clean(summary_ws.cell(3, 3).value) or None,
        "project_start_date": _iso(summary_ws.cell(4, 3).value),
        "project_end_date": _iso(summary_ws.cell(5, 3).value),
        "total_project_cost": _num(summary_ws.cell(8, 3).value),
        "grant_percentage": _num(summary_ws.cell(9, 3).value),
        "grant_sought": _num(summary_ws.cell(10, 3).value),
        "quarters": summary["quarters"],
        "category_totals": summary["category_totals"],
        "employees": _parse_labour(wb["Labour Expenditure"]) if "Labour Expenditure" in wb.sheetnames else [],
        "assets": _parse_plant(wb["Plant Expenditure"]) if "Plant Expenditure" in wb.sheetnames else [],
        "contractors": _parse_contract(wb["Contract Expenditure"]) if "Contract Expenditure" in wb.sheetnames else [],
    }
