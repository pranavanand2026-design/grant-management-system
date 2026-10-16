"""Opt-in checks for locally supplied synthetic agreement fixtures."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parents[1]
sys.path.insert(0, str(BACKEND))

import validation  # noqa: E402
from extractors import ac, bff, milestone_attachment  # noqa: E402

GRANTS = ROOT / "project/grants/input"
BFF_AGREEMENT = GRANTS / "Example BFF Grant Agreement.docx"
BFF_ATTACHMENT = GRANTS / "Example BFF Milestone Attachment.docx"
AC_AGREEMENT = GRANTS / "Example AC Grant Agreement.pdf"


@unittest.skipUnless(AC_AGREEMENT.exists(), "AC agreement fixture is not available")
class ACExtractorTests(unittest.TestCase):
    def test_ac_agreement(self):
        result = ac.extract(str(AC_AGREEMENT))
        entity = result["entities"]
        self.assertEqual(entity["grant"]["grantType"], "ac")
        self.assertEqual(entity["grant"]["projectReferenceNumber"], "AC-TEST-001")
        self.assertEqual(entity["client"]["name"], "EXAMPLE RECIPIENT PTY LTD")
        self.assertEqual(len(entity["milestones"]), 5)
        self.assertEqual(entity["grant"]["totalProjectCost"], 500000)
        self.assertEqual(len(entity["reportingObligations"]), 6)


@unittest.skipUnless(BFF_AGREEMENT.exists(), "BFF agreement fixture is not available")
class BFFExtractorTests(unittest.TestCase):
    def setUp(self):
        self.result = bff.extract(str(BFF_AGREEMENT))
        self.entity = self.result["entities"]

    def test_grant_header(self):
        self.assertEqual(self.entity["grant"]["grantType"], "bff")
        # A recurring reference must not absorb an adjacent page number.
        self.assertEqual(self.result["project_reference_number"], "GRANT-001")
        self.assertEqual(self.entity["client"]["name"], "EXAMPLE RECIPIENT PTY LTD")
        self.assertEqual(self.entity["grant"]["maximumFunds"], 250000)
        self.assertEqual(self.entity["grant"]["totalProjectCost"], 500000)
        self.assertEqual(len(self.entity["annualCaps"]), 3)

    def test_milestones_titles_and_dates(self):
        milestones = self.result["milestones"]
        self.assertEqual(len(milestones), 5)
        # Titles are the milestone names with the redundant "Milestone N -"
        # prefix removed; the description is kept as the activity, not fused.
        self.assertEqual(milestones[0]["title"], "Pilot equipment commissioned")
        self.assertEqual(milestones[2]["title"], "Market validation")
        self.assertTrue(milestones[0]["activities"][0].lower().startswith("commission"))
        self.assertEqual(milestones[0]["planned_achievement_date"], "2026-06-30")

    def test_project_outcomes_stops_before_boilerplate(self):
        outcomes = self.result["project_outcomes"]
        self.assertIsNotNone(outcomes)
        self.assertNotIn("In undertaking the Activity", outcomes)


@unittest.skipUnless(
    BFF_AGREEMENT.exists() and BFF_ATTACHMENT.exists(),
    "BFF workflow fixtures are not available",
)
class BFFAttachmentWorkflowTests(unittest.TestCase):
    def test_attachment_parses_in_the_standard_format(self):
        att = milestone_attachment.extract(str(BFF_ATTACHMENT))
        self.assertEqual(att["source"], "application_attachment")
        self.assertEqual(len(att["milestones"]), 5)
        self.assertEqual(att["total_estimated_cost"], 500000)
        first = att["milestones"][0]
        self.assertEqual(first["title"], "Pilot equipment commissioned")
        self.assertIsNotNone(first["start_date"])
        self.assertIsNotNone(first["estimated_cost"])
        self.assertTrue(first["measurable_outcomes"])

    def test_cross_validate_joins_agreement_and_attachment(self):
        agreement = bff.extract(str(BFF_AGREEMENT))
        attachment = milestone_attachment.extract(str(BFF_ATTACHMENT))
        out = validation.cross_validate(agreement, attachment)
        checks = {f["check"]: f for f in out["findings"]}

        # Same five milestones, and the attachment end dates equal the
        # agreement's contractual due dates.
        self.assertEqual(checks["milestone_count"]["severity"], "pass")
        self.assertEqual(checks["milestone_end_date"]["severity"], "pass")

        merged = out["merged"]
        self.assertTrue(all(m["startDate"] for m in merged["milestones"]))
        self.assertTrue(all(m["estimatedCost"] is not None for m in merged["milestones"]))
        self.assertTrue(merged["completeness"]["milestoneStartDates"]["present"])
        self.assertTrue(merged["completeness"]["milestoneEstimatedCosts"]["present"])
        # Allocation reconciles to the agreement's total project cost.
        self.assertEqual(merged["attachmentSummary"]["coverage"], "matches")


if __name__ == "__main__":
    unittest.main()
