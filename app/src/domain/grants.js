import { titleCase } from "../lib/format.js";
import { statementEntryFromExtract } from "../lib/funnel.js";

export function cleanReviewDraft(draft) {
  const clean = JSON.parse(JSON.stringify(draft));
  delete clean._manual;
  delete clean._collapsed;
  return clean;
}

export function buildGrantBundle({
  draft,
  displayName,
  hasAttachment,
  statement,
  statementFilename,
}) {
  const clean = cleanReviewDraft(draft);
  const bundle = {
    id: `grant_upload_${Date.now()}`,
    displayName: displayName.trim(),
    client: {
      ...clean.client,
      displayName: clean.client.displayName
        || titleCase((clean.client.name || "").replace(/\.$/, "")),
    },
    documents: {
      agreement: true,
      attachment: hasAttachment,
      statement: !!statement,
    },
    grant: clean.grant,
    completeness: clean.completeness,
    milestones: clean.milestones,
    budgetCategories: clean.budgetCategories,
    allocations: {},
    statements: [],
    attributions: {},
    directEntries: {},
    quarters: clean.quarters,
    reportingObligations: clean.reportingObligations,
    annualCaps: clean.annualCaps,
    evidenceRequirements: clean.evidenceRequirements,
    validationFindings: clean.validationFindings,
    attachmentSummary: clean.attachmentSummary,
  };

  if (statement) {
    bundle.statements.push(
      statementEntryFromExtract(
        statement,
        statementFilename,
        bundle.grant.projectEndDate,
      )
    );
  }
  return { bundle, clean };
}

export function mergeReviewedGrant(existing, reviewed, bundle) {
  return {
    ...existing,
    ...reviewed,
    ...bundle,
    id: existing.id,
    _dbId: existing._dbId,
    _rev: existing._rev,
    documents: existing.documents || bundle.documents,
    allocations: existing.allocations || {},
    statements: existing.statements || [],
    attributions: existing.attributions || {},
    directEntries: existing.directEntries || {},
  };
}
