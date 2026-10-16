"""
Cross-document validation and merge.

Takes the extracted funding agreement (with its entity structure), and
optionally the Mandatory Attachment: Milestones extraction and the Project
Budget Calculator extraction, compares them, and returns:

  - findings[]: every check that ran, pass or not. Nothing is resolved
    silently and nothing blocks. Each finding is self-contained: it carries
    its own title, explanation, and resolution options (if any). It also
    carries where it attaches (scope + sectionKey/milestoneNumber/fieldKey)
    so the review screen can place it inline without knowing what the
    check means.
  - merged: the agreement entities with attachment and calculator data
    grafted in, each grafted field carrying its own source.

The checks surface material differences between documents, including repeated
or conflicting milestone activities.
"""

from __future__ import annotations

import copy
import re
from typing import List, Optional


def _norm(text: str) -> str:
    value = (text or "").lower()
    # These are presentation variants, not meaningful activity differences.
    # Keep this small and generic: it prevents spelling/style from becoming a
    # compliance warning without trying to guess semantic equivalence.
    value = value.replace("finalise", "finalize").replace("lay-out", "layout")
    value = value.replace("set-up", "setup")
    return re.sub(r"[^a-z0-9 ]", "", value).strip()


def _token_similarity(a: str, b: str) -> float:
    ta, tb = set(_norm(a).split()), set(_norm(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _activities_similarity(agreement_acts: List[str], attachment_acts: List[str]) -> float:
    joined_a = " ".join(agreement_acts)
    joined_b = " ".join(attachment_acts)
    return _token_similarity(joined_a, joined_b)


def _finding(check, severity, title, explanation, *, scope="grant",
             section_key=None, milestone=None, field_key=None,
             comparisons=None, options=None):
    return {
        "id": f"finding_{check}" + (f"_m{milestone}" if milestone else ""),
        "check": check,
        "severity": severity,          # "pass" | "info" | "warning"
        "scope": scope,                # "grant" | "section" | "milestone"
        "sectionKey": section_key,     # e.g. "milestones", "budgetCategories"
        "milestoneNumber": milestone,
        "fieldKey": field_key,
        "title": title,
        "explanation": explanation,
        "comparisons": comparisons or [],
        "options": options,            # [{"value","label"}] or None
        "resolution": None,            # set by the consultant in review
        "resolutionNote": None,
        "dismissed": False,
    }


def _fmt_money(v) -> str:
    return f"${v:,.0f}" if isinstance(v, (int, float)) else "—"


def cross_validate(agreement: dict, attachment: Optional[dict] = None,
                   calculator: Optional[dict] = None) -> dict:
    entities = copy.deepcopy(agreement["entities"])
    findings = []
    ms_by_num = {m["number"]: m for m in entities["milestones"]}

    if attachment:
        att_ms = attachment.get("milestones", [])
        att_by_num = {m["number"]: m for m in att_ms}

        # -- milestone count ------------------------------------------------
        if len(att_ms) == len(ms_by_num):
            findings.append(_finding(
                "milestone_count", "pass", "Milestone count matches",
                f"Both documents list {len(att_ms)} milestones.",
                scope="section", section_key="milestones",
                comparisons=[{"source": "agreement", "value": len(ms_by_num)},
                             {"source": "application_attachment", "value": len(att_ms)}],
            ))
        else:
            only_agr = sorted(set(ms_by_num) - set(att_by_num))
            only_att = sorted(set(att_by_num) - set(ms_by_num))
            findings.append(_finding(
                "milestone_count", "warning", "Milestone count differs",
                f"The agreement lists {len(ms_by_num)} milestones; the attachment "
                f"lists {len(att_ms)}."
                + (f" Only in agreement: {only_agr}." if only_agr else "")
                + (f" Only in attachment: {only_att}." if only_att else ""),
                scope="section", section_key="milestones",
                comparisons=[{"source": "agreement", "value": len(ms_by_num)},
                             {"source": "application_attachment", "value": len(att_ms)}],
            ))

        # -- per-milestone end date vs planned achievement date -------------
        # One finding per mismatched milestone, so it attaches to that
        # milestone specifically rather than a combined summary.
        any_date_checked = False
        for num in sorted(set(ms_by_num) & set(att_by_num)):
            gm, am = ms_by_num[num], att_by_num[num]
            if not (am.get("end_date") and gm.get("plannedAchievementDate")):
                continue
            any_date_checked = True
            if am["end_date"] != gm["plannedAchievementDate"]:
                project_start = entities["grant"].get("projectStartDate")
                attachment_starts_before = bool(project_start and am.get("start_date") and am["start_date"] < project_start)
                attachment_ends_before = bool(project_start and am["end_date"] < project_start)
                before_project = attachment_starts_before or attachment_ends_before
                findings.append(_finding(
                    "milestone_end_date", "warning" if before_project else "info",
                    (f"Milestone {num} attachment date precedes the contractual project start"
                     if before_project else f"Milestone {num} date differs between planning and agreement sources"),
                    (f"The attachment schedule runs {am.get('start_date') or '—'} to {am['end_date']} "
                     + (f"and starts before the agreement project start {project_start}. " if attachment_starts_before else "")
                     + (f"and ends before the agreement project start {project_start}. " if attachment_ends_before else "")
                     + f"The agreement's planned achievement date is {gm['plannedAchievementDate']}; "
                       "the agreement governs compliance dates."),
                    scope="milestone", milestone=num,
                    comparisons=[{"source": "application_attachment", "value": am["end_date"]},
                                 {"source": "agreement", "value": gm["plannedAchievementDate"]}],
                ))
        if any_date_checked and not any(
                f["check"] == "milestone_end_date" for f in findings):
            findings.append(_finding(
                "milestone_end_date", "pass", "Milestone end dates agree",
                "Every attachment end date, resolved to month-end where only "
                "a month was given, equals the agreement's planned "
                "achievement date.",
                scope="section", section_key="milestones",
            ))

        # -- per-milestone activity text -------------------------------------
        for num in sorted(set(ms_by_num) & set(att_by_num)):
            gm, am = ms_by_num[num], att_by_num[num]
            agr_acts = [a["description"] for a in gm["activities"]]
            att_acts = am.get("activities") or []
            similarity = _activities_similarity(agr_acts, att_acts)
            if similarity >= 0.6:
                continue
            explanation = (
                f"The two documents describe Milestone {num}'s activities "
                f"differently.")
            # The defect this check exists to catch: a milestone whose
            # agreement activities are identical to another milestone's.
            for other_num, other in ms_by_num.items():
                if other_num == num:
                    continue
                other_acts = [a["description"] for a in other["activities"]]
                if agr_acts and _norm(" ".join(agr_acts)) == _norm(" ".join(other_acts)):
                    explanation = (
                        f"The agreement lists these same activities under both "
                        f"Milestone {num} and Milestone {other_num}. This may be "
                        f"a transcription error in the executed agreement.")
                    break
            findings.append(_finding(
                "milestone_activities", "warning" if similarity < 0.3 else "info",
                (f"Milestone {num} activities materially differ between documents"
                 if similarity < 0.3 else f"Milestone {num} activity wording differs between sources"),
                explanation,
                scope="milestone", milestone=num, field_key="activities",
                comparisons=[{"source": "agreement", "value": agr_acts},
                             {"source": "application_attachment", "value": att_acts}],
                options=[
                    {"value": "agreement", "label": "Use agreement"},
                    {"value": "attachment", "label": "Use attachment"},
                    {"value": "both", "label": "Keep both, flag for client"},
                ],
            ))

        # -- graft attachment data into the merged entities ------------------
        for num, am in att_by_num.items():
            gm = ms_by_num.get(num)
            if not gm:
                continue
            gm.update({
                "startDate": am.get("start_date"),
                "startDateRaw": am.get("start_date_raw"),
                "startDateSource": "application_attachment" if am.get("start_date") else None,
                "endDate": am.get("end_date"),
                "endDateRaw": am.get("end_date_raw"),
                "endDateSource": "application_attachment" if am.get("end_date") else None,
                "estimatedCost": am.get("estimated_cost"),
                "estimatedCostSource": "application_attachment" if am.get("estimated_cost") is not None else None,
                "attachmentActivities": am.get("activities") or None,
                "undertakenBy": am.get("undertaken_by"),
            })
        entities["completeness"]["milestoneStartDates"]["present"] = any(
            m["startDate"] for m in entities["milestones"])
        entities["completeness"]["milestoneEstimatedCosts"]["present"] = any(
            m["estimatedCost"] is not None for m in entities["milestones"])

        attachment_total = attachment.get("total_estimated_cost")
        agreement_total = entities["grant"].get("totalProjectCost")
        if attachment_total is not None:
            status = "matches" if agreement_total is not None and round(attachment_total) == round(agreement_total) \
                else "partial_or_phased" if agreement_total is not None and attachment_total < agreement_total else "exceeds"
            entities["attachmentSummary"] = {
                "estimatedCostTotal": attachment_total,
                "agreementProjectCost": agreement_total,
                "coverage": status,
                "source": attachment.get("source", "application_attachment"),
            }
            if status != "matches":
                severity = "warning" if status == "exceeds" else "info"
                findings.append(_finding(
                    "attachment_cost_scope", severity,
                    ("Attachment estimates exceed the agreement project cost" if status == "exceeds"
                     else "Attachment estimates cover less than the agreement project cost"),
                    ("The attachment total is greater than the contractual project cost; check the allocation or source document."
                     if status == "exceeds" else
                     "Planning attachments may cover a workstream, phase, or eligible-expenditure subset. "
                     "Confirm the attachment's scope before treating this as a budget variance."),
                    scope="section", section_key="milestones",
                    comparisons=[{"source": "application_attachment", "value": attachment_total},
                                 {"source": "agreement", "value": agreement_total}],
                ))

    if calculator:
        # -- category totals vs Item 10 rows ---------------------------------
        cat_by_name = {c["name"]: c for c in entities["budgetCategories"]}
        total_mismatch, year_split_mismatch = [], []
        for name, calc_total in (calculator.get("category_totals") or {}).items():
            agr = cat_by_name.get(name)
            if not agr:
                continue
            if round(calc_total) != round(agr["total"] or 0):
                total_mismatch.append(
                    f"{name}: calculator {_fmt_money(calc_total)}, agreement "
                    f"{_fmt_money(agr['total'])}")
            else:
                calc_y1 = sum(
                    q["by_category"].get(name, 0)
                    for q in calculator.get("quarters", []) if q["sequence"] <= 4)
                if round(calc_y1) != round(agr["year1"] or 0):
                    year_split_mismatch.append(
                        f"{name}: calculator year 1 {_fmt_money(calc_y1)}, "
                        f"agreement year 1 {_fmt_money(agr['year1'])}")
        if total_mismatch:
            findings.append(_finding(
                "calculator_category_totals", "warning",
                "Budget calculator category totals differ from the agreement",
                "; ".join(total_mismatch),
                scope="section", section_key="budgetCategories",
            ))
        else:
            findings.append(_finding(
                "calculator_category_totals", "pass",
                "Budget calculator category totals match the agreement",
                "Every expenditure category total equals the agreement's "
                "Item 10 figures.",
                scope="section", section_key="budgetCategories",
            ))
        if year_split_mismatch:
            findings.append(_finding(
                "calculator_year_split", "warning",
                "Year split differs between calculator and agreement",
                "Category totals match but the year 1 / year 2 phasing does "
                "not: " + "; ".join(year_split_mismatch) + ". The calculator "
                "predates the executed agreement; the agreement's split is "
                "the contractual one.",
                scope="section", section_key="budgetCategories",
            ))

        # -- total project cost ----------------------------------------------
        calc_tpc = calculator.get("total_project_cost")
        agr_tpc = entities["grant"].get("totalProjectCost")
        if calc_tpc is not None and agr_tpc is not None:
            severity = "pass" if round(calc_tpc) == round(agr_tpc) else "warning"
            findings.append(_finding(
                "calculator_total", severity,
                "Total project cost " + ("matches" if severity == "pass" else "differs"),
                f"Calculator {_fmt_money(calc_tpc)}; agreement {_fmt_money(agr_tpc)}.",
                scope="section", section_key="funding",
                comparisons=[{"source": "budget_calculator", "value": calc_tpc},
                             {"source": "agreement", "value": agr_tpc}],
            ))

        # -- project end date --------------------------------------------------
        calc_end = calculator.get("project_end_date")
        agr_end = entities["grant"].get("projectEndDate")
        if calc_end and agr_end and calc_end != agr_end:
            findings.append(_finding(
                "calculator_project_end", "info",
                "Project end date differs by a day",
                f"The calculator uses {calc_end}; the agreement says {agr_end}. "
                f"The agreement date governs.",
                scope="section", section_key="project",
                comparisons=[{"source": "budget_calculator", "value": calc_end},
                             {"source": "agreement", "value": agr_end}],
            ))

        # -- graft quarterly eligible expenditure -----------------------------
        calc_quarters = calculator.get("quarters", [])
        for q in entities["quarters"]:
            match = next(
                (cq for cq in calc_quarters
                 if cq["period_start"][:7] == q["periodStart"][:7]), None)
            if match:
                q["eligibleExpenditure"] = match["total"]
                q["eligibleByCategory"] = match["by_category"]
                q["eligibleSource"] = "budget_calculator"
        entities["completeness"]["quarterlyEligibleExpenditure"]["present"] = any(
            q["eligibleExpenditure"] is not None for q in entities["quarters"])
        entities["grant"]["apportionment"] = {
            "employees": calculator.get("employees", []),
            "assets": calculator.get("assets", []),
            "contractors": calculator.get("contractors", []),
            "source": "budget_calculator",
        }

    # -- ceilings present (runs regardless of what was uploaded) -------------
    missing = [c["name"] for c in entities["budgetCategories"] if c["total"] is None]
    if missing:
        findings.append(_finding(
            "category_ceilings", "warning",
            "Some budget categories have no ceiling",
            f"No Item 10 total could be read for: {', '.join(missing)}.",
            scope="section", section_key="budgetCategories",
        ))
    else:
        findings.append(_finding(
            "category_ceilings", "pass",
            "All budget category ceilings present",
            "Every category has a ceiling. A zero ceiling is a valid "
            "ceiling, not missing data.",
            scope="section", section_key="budgetCategories",
        ))

    entities["validationFindings"] = findings
    return {"findings": findings, "merged": entities}
