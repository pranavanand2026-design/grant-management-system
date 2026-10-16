# Generic Grant Data Model Research

**Status:** Proof of concept design reference

## Purpose

This document defines a program neutral data model for managing government
grants. It intentionally contains no client records, grant references,
supplier names, employee names, source filenames, or real financial figures.

The model separates contractual facts from planning information and operational
records. This lets the interface explain where every important value came from
and prevents working estimates from being presented as contractual terms.

## Source authority

| Source | Typical content | Authority |
|---|---|---|
| Funding agreement | Parties, dates, funding limits, milestones, reporting obligations | Contractual |
| Program attachment | Planned activities, estimated costs, delivery schedule | Advisory |
| Budget workbook | Category phasing and cost assumptions | Advisory |
| Accounting export | Recorded expenditure transactions | Operational |
| Grant manager entry | Allocations, evidence requirements, review decisions | Manual |

Every field that is not contractual should carry a source marker and, where
useful, a timestamp and reviewer identifier.

## Core entities

### Client

Represents the grant recipient.

```json
{
  "id": "client_example",
  "name": "Example Recipient Pty Ltd",
  "abn": "00 000 000 000",
  "displayName": "Example Recipient"
}
```

### Grant

The root record for a funded project.

```json
{
  "id": "grant_example_001",
  "clientId": "client_example",
  "displayName": "Example Project",
  "grantType": "example_program",
  "projectReferenceNumber": "GRANT-001",
  "projectTitle": "Example commercialisation project",
  "projectStartDate": "2026-01-01",
  "projectEndDate": "2027-06-30",
  "maximumFunds": 250000,
  "grantPercentage": 50,
  "totalProjectCost": 500000,
  "source": "agreement",
  "reviewedBy": "user_example",
  "reviewedAt": "2026-01-15T10:00:00Z"
}
```

The grant record owns milestones, budget categories, reporting obligations,
annual caps, evidence requirements, and operational expenditure records.

### Milestone

Represents a contractual or planned delivery point.

```json
{
  "id": "milestone_example_1",
  "grantId": "grant_example_001",
  "number": 1,
  "title": "Pilot system commissioned",
  "plannedAchievementDate": "2026-09-30",
  "plannedAchievementDateSource": "agreement",
  "startDate": "2026-02-01",
  "startDateSource": "manual",
  "estimatedCost": 125000,
  "estimatedCostSource": "manual",
  "status": "in_progress"
}
```

Milestone status is derived from dates, activity completion, unresolved
findings, and evidence readiness. Recommended states are `upcoming`,
`in_progress`, `at_risk`, and `complete`.

### Activity

Represents work performed under a milestone.

```json
{
  "id": "activity_example_1",
  "milestoneId": "milestone_example_1",
  "sequence": 1,
  "description": "Install and commission pilot equipment",
  "undertakenBy": "Project delivery team",
  "complete": false,
  "completedAt": null
}
```

### BudgetCategory

Represents a contractual expenditure ceiling.

```json
{
  "id": "budget_category_example_labour",
  "grantId": "grant_example_001",
  "name": "Labour Expenditure",
  "year1": 150000,
  "year2": 100000,
  "total": 250000,
  "source": "agreement"
}
```

Contractual category totals should not be silently changed by planning data or
accounting transactions.

### BudgetAllocation

Connects planned expenditure to a milestone, activity, category, and period.

```json
{
  "id": "allocation_example_1",
  "grantId": "grant_example_001",
  "milestoneId": "milestone_example_1",
  "activityId": "activity_example_1",
  "budgetCategoryId": "budget_category_example_labour",
  "costItem": "Engineering labour",
  "amount": 50000,
  "periodStart": "2026-02-01",
  "periodEnd": "2026-06-30",
  "source": "manual"
}
```

The activity reference may be null when an allocation applies to a milestone
as a whole.

Recommended allocation sources are `attachment`, `manual`, and `inferred`.
Inferred allocations must be visually distinct and require review.

### ReportingObligation

Represents a report or acquittal required by the agreement.

```json
{
  "id": "report_example_1",
  "grantId": "grant_example_001",
  "reportType": "Progress Report",
  "dueDate": "2026-10-31",
  "periodStartDate": "2026-01-01",
  "periodEndDate": "2026-09-30",
  "status": "upcoming",
  "submittedAt": null,
  "source": "agreement"
}
```

Some agreements define a trigger rather than a fixed due date. The model
should preserve the trigger text instead of inventing a calendar date.

### AnnualCap

Represents a financial year funding limit.

```json
{
  "id": "annual_cap_example_2026",
  "grantId": "grant_example_001",
  "financialYear": "2026/27",
  "cappedAmount": 175000,
  "source": "agreement"
}
```

### Transaction

Represents a statement row or accounting system transaction.

```json
{
  "id": "transaction_example_1",
  "grantId": "grant_example_001",
  "externalTransactionId": "external_0001",
  "date": "2026-04-15",
  "description": "Example supplier invoice",
  "amount": 12000,
  "accountCode": "400",
  "matchedMilestoneId": "milestone_example_1",
  "matchedBudgetCategoryId": "budget_category_example_contract",
  "matchedAllocationId": "allocation_example_1",
  "matchStatus": "proposed",
  "matchConfidence": 0.85,
  "matchedBy": "rule:supplier",
  "confirmedBy": null
}
```

Recommended match states are `unmatched`, `proposed`, `confirmed`, and
`disputed`. Automated matching creates proposals only. A human confirmation is
required before a transaction contributes to compliance reporting.

### EvidenceRequirement

Defines what documentation is needed for an outcome, allocation, or report.

```json
{
  "id": "evidence_requirement_example_1",
  "grantId": "grant_example_001",
  "milestoneId": "milestone_example_1",
  "budgetCategoryId": "budget_category_example_contract",
  "description": "Supplier invoice and proof of payment",
  "required": true,
  "satisfied": false,
  "documents": []
}
```

Evidence requirements may be contractual, generated from program rules, or
defined by an authorised grant manager. Their source should be recorded.

### EvidenceDocument

Stores a pointer to evidence held in an approved document system.

```json
{
  "id": "evidence_document_example_1",
  "grantId": "grant_example_001",
  "requirementId": "evidence_requirement_example_1",
  "name": "supplier-invoice.pdf",
  "url": "https://example.sharepoint.com/evidence/supplier-invoice.pdf",
  "source": "sharepoint",
  "linkedAt": "2026-04-20T09:00:00Z"
}
```

The proof of concept stores links and audit metadata rather than copying
document contents into the grant record.

## Data invariants

The application should enforce the following rules:

1. Contractual fields always retain their source and cannot be silently
   replaced by advisory data.
2. A budget category allocation total must not exceed its contractual ceiling.
3. The total allocation should reconcile to the project cost or be clearly
   marked incomplete.
4. Planned and actual expenditure remain separate.
5. Automated transaction matches require human confirmation.
6. Evidence readiness is calculated from explicit requirements and linked
   documents.
7. Every update uses optimistic revision control to prevent stale overwrites.
8. Recipient access is limited to explicitly assigned grants and a restricted
   data projection.

## Frontend projections

The interface reads the same normalized model through several projections:

* **Portfolio:** Grant status, next deadline, unresolved issues, and funding
  summary.
* **Grant workspace:** Contract details, milestones, reporting obligations,
  allocations, actual expenditure, and evidence readiness.
* **Expenditure workflow:** Imported transaction review, eligibility tagging,
  milestone attribution, and category reconciliation.
* **Recipient portal:** Assigned deadlines, evidence requests, and upload
  history without internal financial or review data.
* **Calendar:** Dated reporting obligations across accessible grants.

## Grant onboarding workflow

1. Select the grant program.
2. Upload the funding agreement and optional planning documents.
3. Extract each source through the matching program parser.
4. Compare overlapping values and record validation findings.
5. Review the normalized record with a grant manager.
6. Create the grant only after the contractual fields are confirmed.
7. Complete missing planning information through approved attachments or
   manual entry.
8. Define allocations and evidence requirements.
9. Reconcile operational expenditure throughout the reporting period.

## Open design questions

* Which planning attachments are consistent enough to support repeatable
  extraction?
* Which evidence requirements come from program rules and which require grant
  manager judgement?
* How should one transaction be split across multiple milestones or
  categories?
* Which workflow decisions require a second reviewer?
* What retention, audit, and data residency requirements apply in production?
* Which fields may a recipient view or update?

## Privacy and fixture rules

Repository documentation, tests, demos, and examples must use synthetic data.

* Never commit client agreements, attachments, statements, invoices, ABNs,
  employee names, supplier names, grant references, or exact client figures.
* Keep private fixtures under the ignored `project/grants/` directory.
* Use neutral references such as `GRANT-001` and clearly fictional names.
* Prefer generated fixtures that contain no copied client wording.
* Scan the current tree and full Git history before every public release.
* Treat any accidental client data commit as an incident requiring containment,
  history cleanup, collaborator notification, and verification.
