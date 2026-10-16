import { useEffect, useState } from "react";
import { TipLayer } from "@gf-ui";
import { loadStoredGrants, resetDemoData } from "./api.js";
import { NewGrantModal, openModal } from "./components/NewGrantModal.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { bump, session, state, useAppVersion } from "./store.js";
import { CalendarView } from "./views/CalendarView.jsx";
import { GrantView } from "./views/GrantView.jsx";
import { Portfolio } from "./views/Portfolio.jsx";
import { restoreReviewDraft, ReviewScreen, saveReviewDraft } from "./views/ReviewScreen.jsx";
import { initProvenance, SettingsView } from "./views/SettingsView.jsx";
import { EvidencePicker } from "./views/tabs/Evidence.jsx";

const RAIL_KEY = "grantflowRailCollapsed";

export default function App({ principal, onSignOut }) {
  useAppVersion();
  const [railCollapsed, setRailCollapsed] = useState(() => localStorage.getItem(RAIL_KEY) === "1");

  /* ---------------- boot ---------------- */
  useEffect(() => {
    initProvenance();
    loadStoredGrants();
    if (restoreReviewDraft()) bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- global keyboard ---------------- */
  useEffect(() => {
    /* Option/Alt+Shift+R clears every persisted grant after confirmation. */
    const onReset = async (e) => {
      if (!(e.altKey && e.shiftKey && e.code === "KeyR")) return;
      const a = document.activeElement;
      if (a && (a.isContentEditable || a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
      e.preventDefault();
      if (!confirm("Reset demo data?\n\nEvery uploaded grant — including its tags, attributions and evidence links — will be deleted.")) return;
      try {
        await resetDemoData();
      } catch (err) {
        alert("Backend unreachable — nothing was deleted.");
        return;
      }
      sessionStorage.clear();
      location.reload();
    };

    /* Cmd/Ctrl+Z undoes the last committed edit when focus is outside a
       field. Inside a field, native undo wins. */
    const onUndo = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const active = document.activeElement;
      const inEditable = active && (active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA");
      if (inEditable) return;
      if (state.view === "validate" && session.UNDO.length) {
        e.preventDefault();
        session.UNDO.pop().undo();
        saveReviewDraft();
        bump();
      } else if (state.view === "grant" && state.tab === "expenditure" && session.EXP_UNDO.length) {
        e.preventDefault();
        session.EXP_UNDO.pop().undo();
      } else if (state.view === "grant" && state.tab === "actuals" && state.actualsView === "tag" && session.TAG_UNDO.length) {
        // Only undo work belonging to the grant on screen.
        const last = session.TAG_UNDO[session.TAG_UNDO.length - 1];
        if (last.gid && last.gid !== state.grantId) return;
        e.preventDefault();
        session.TAG_UNDO.pop().undo();
      }
    };

    document.addEventListener("keydown", onReset);
    document.addEventListener("keydown", onUndo);
    return () => {
      document.removeEventListener("keydown", onReset);
      document.removeEventListener("keydown", onUndo);
    };
  }, []);

  const toggleRail = () => {
    const next = !railCollapsed;
    setRailCollapsed(next);
    localStorage.setItem(RAIL_KEY, next ? "1" : "0");
  };

  return (
    <div className={"app" + (railCollapsed ? " rail-collapsed" : "")}>
      <Sidebar
        onAddGrant={openModal}
        principal={principal}
        onSignOut={onSignOut}
      />
      <button className="rail-toggle" id="rail-toggle" type="button"
        aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={toggleRail}>‹</button>

      <main className="main" id="main">
        {state.view === "home" && <Portfolio onAddGrant={openModal} />}
        {state.view === "grant" && <GrantView />}
        {state.view === "calendar" && <CalendarView />}
        {state.view === "settings" && <SettingsView principal={principal} />}
        {state.view === "validate" && <ReviewScreen />}
      </main>

      <NewGrantModal />
      <EvidencePicker />
      <TipLayer />
    </div>
  );
}
