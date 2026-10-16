/* Lightweight external store for application, navigation, and session state. */

import { useSyncExternalStore } from "react";

export const DATA = { grants: [] };

export const state = {
  view: "home", grantId: null, tab: "overview", msDetail: null, calView: "list",
  actualsView: "list", pendingStatement: null, tagFilters: null,
};

/* Session-scoped working state that is not persisted with a grant. */
export const session = {
  PENDING: null,            // in-flight upload flow
  STORE_STATE: "loading",   // saved-grants fetch: "loading" | "done" | "error"
  DRAFT: null,              // review screen working copy
  EDITING_GRANT: null,      // original grant while its review form is open
  draftGrantName: "",
  UNDO: [],                 // review-screen undo
  EXP_UNDO: [],             // expenditure grid undo
  TAG_UNDO: [],             // tagging undo
  SP_CACHE: new Map(),      // g.id -> {root, children: Map, error, loading}
  SP_GRANTS: null,          // cached /sharepoint/grants payload
  SP_STATUS: null,          // last /sharepoint/status payload
  pendingFocus: null,
  reviewMounted: false,
  calMonth: null,           // set on first calendar render
  calSelected: null,
  NAV_BACK: [],             // app-level view history; excludes in-place edits
};

let version = 0;
const listeners = new Set();

export function bump() {
  version++;
  listeners.forEach((l) => l());
}
function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useAppVersion() {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/* ---------------- router ---------------- */
const NAV_KEYS = [
  "view", "grantId", "tab", "msDetail", "calView", "actualsView",
  "attributeFilter", "tagContextNote", "tagFilterOverride", "tagFilterOverrideNote",
];

function navSnapshot() {
  const snap = {};
  NAV_KEYS.forEach((key) => { snap[key] = state[key] ?? null; });
  return snap;
}

function rememberView() {
  const snap = navSnapshot();
  const last = session.NAV_BACK[session.NAV_BACK.length - 1];
  if (!last || JSON.stringify(last) !== JSON.stringify(snap)) session.NAV_BACK.push(snap);
  if (session.NAV_BACK.length > 40) session.NAV_BACK.shift();
}

export function show(view) {
  if (state.view !== view) rememberView();
  state.view = view;
  bump();
}
export function openGrant(id, tab, opts) {
  const nextTab = tab || "overview";
  const changing = state.view !== "grant" || state.grantId !== id
    || state.tab !== nextTab || state.msDetail != null || !!opts;
  if (changing) rememberView();
  state.grantId = id; state.tab = nextTab; state.msDetail = null; state.attributeFilter = null;
  Object.assign(state, opts || {});
  state.view = "grant";
  bump();
}

export function goBack() {
  const previous = session.NAV_BACK.pop();
  if (previous) {
    Object.assign(state, previous);
  } else {
    Object.assign(state, {
      view: "home", grantId: null, tab: "overview", msDetail: null,
      actualsView: "list", attributeFilter: null,
      tagContextNote: null, tagFilterOverride: null, tagFilterOverrideNote: null,
    });
  }
  bump();
}
export function currentGrant() {
  return DATA.grants.find((g) => g.id === state.grantId);
}

/* Shared file picker used by upload and evidence workflows. */
let hiddenInput = null;
export function pickFile(accept, onFile) {
  if (!hiddenInput) {
    hiddenInput = document.createElement("input");
    hiddenInput.type = "file";
    hiddenInput.hidden = true;
    document.body.appendChild(hiddenInput);
  }
  hiddenInput.accept = accept || "";
  hiddenInput.onchange = () => {
    const file = hiddenInput.files[0];
    hiddenInput.value = "";
    if (file) onFile(file);
  };
  hiddenInput.click();
}

/* Re-render a dense table without losing its scroll position. */
export function bumpKeepScroll() {
  const main = document.querySelector("#main");
  const y = main ? main.scrollTop : 0;
  bump();
  requestAnimationFrame(() => {
    const m = document.querySelector("#main");
    if (m) m.scrollTop = y;
    const openTr = document.querySelector(".rl-editor-tr");
    if (openTr) {
      const rect = openTr.getBoundingClientRect();
      if (rect.bottom > innerHeight - 20 || rect.top < 80) openTr.scrollIntoView({ block: "center" });
    }
  });
}
