# Adding a grant program

A new program should change extraction code and fixtures, not grant-management
screens.

## Contract

Each agreement extractor exposes:

```python
def extract(path: str) -> dict:
    ...
```

It returns both source-oriented extraction data and an `entities` object. The
`entities` object must normalize the program into these shared sections:

```text
client
grant
completeness
milestones[]
budgetCategories[]
annualCaps[]
reportingObligations[]
quarters[]
evidenceRequirements[]
```

Fields not present in the source remain `None` or empty collections. Do not
infer dates, amounts, ceilings, or evidence requirements merely to complete a
layout.

## Steps

1. Add `project/backend/extractors/<program>.py`.
2. Parse using durable labels, table headings, and section boundaries rather
   than page positions.
3. Map the result into the normalized `entities` contract.
4. Add one `GrantProgram` entry in `extractors/__init__.py`.
5. Add private source fixtures locally and focused golden assertions under
   `project/backend/tests/`.
6. Exercise `/extract`, `/cross-validate`, review, grant creation, and every
   grant tab.
7. Add program-specific validation only when a rule genuinely differs from
   the shared cross-document rules.

The frontend program selector reads `/grant-types`; no selector code change is
required.

## Extraction requirements

- Return ISO dates.
- Return numeric amounts without display formatting.
- Preserve original source text where review requires it.
- Add source markers to normalized values.
- Raise `ValueError` when a document does not match the expected program.
- Raise `NotImplementedError` only for a registered program that is visible
  but not available.
- Keep file I/O in shared document readers where possible.
- Never store uploads from inside an extractor.

## Testing

At minimum, verify:

- Recipient identity and project reference
- Project dates and maximum funding
- Milestone count, titles, activities, outcomes, and due dates
- Category ceilings and project-cost reconciliation
- Reporting obligations
- Missing-field behavior
- A document that should be rejected
- Cross-validation with each supported companion document
