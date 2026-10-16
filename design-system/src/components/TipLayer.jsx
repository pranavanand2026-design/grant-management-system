import { useEffect, useRef } from "react";
import { esc } from "../lib/format.js";

/**
 * TipLayer — the app's tooltip engine, mounted once. Any element carrying
 * `data-tip` (and optionally `data-tipsrc`) gets the floating tip on hover;
 * no per-node wiring. The delegated model
 * so tips work identically across React-rendered and HTML-string content.
 */
export function TipLayer() {
  const ref = useRef(null);

  useEffect(() => {
    const tip = ref.current;
    const onOver = (e) => {
      const t = e.target.closest && e.target.closest("[data-tip]");
      if (!t) { tip.hidden = true; return; }
      tip.innerHTML = esc(t.dataset.tip) +
        (t.dataset.tipsrc ? `<span class="tip-src">${esc(t.dataset.tipsrc)}</span>` : "");
      tip.hidden = false;
      const r = t.getBoundingClientRect();
      tip.style.left = Math.min(r.left, innerWidth - 320) + "px";
      tip.style.top = (r.bottom + 7) + "px";
    };
    const onScroll = () => { tip.hidden = true; };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  return <div ref={ref} className="tip" hidden />;
}
