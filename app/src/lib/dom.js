/* Small DOM helpers for interaction-heavy financial tables and timelines. */

export const $ = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* Keyboard activation for row-as-button elements. */
export function onActivate(node, handler) {
  node.onclick = handler;
  node.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      handler(e);
    }
  };
}
