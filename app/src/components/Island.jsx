import { useLayoutEffect, useRef } from "react";

/* Hosts interaction-heavy DOM renderers inside the React view tree. */
export function Island({ build, deps = [], className }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const node = ref.current;
    node.innerHTML = "";
    build(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <div className={className} ref={ref} />;
}
