/* Attaching evidence to a measurable outcome. A grant with a linked
   SharePoint folder attaches real files through the picker overlay; the
   bare-filename path is the fallback for everything else. */

import { saveGrantIfPersisted } from "../api.js";
import { bump, pickFile, state } from "../store.js";

export function attachEvidenceFile(g, req) {
  pickFile("", (file) => {
    req.documents.push(file.name);
    req.satisfied = true;
    saveGrantIfPersisted(g);
    bump();
  });
}

export function attachEvidence(g, req) {
  if (g.spFolderPath) { state.evPicker = { g, req }; bump(); return; }
  attachEvidenceFile(g, req);
}
