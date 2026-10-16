import { docLabel, docUrl } from "../lib/derive.js";

export function EvidenceDocuments({ documents = [] }) {
  return (
    <span className="out-docs">
      ✓{" "}
      {documents.map((document, index) => {
        const label = docLabel(document);
        const url = docUrl(document);
        return (
          <span key={`${label}-${index}`}>
            {index > 0 ? ", " : null}
            {url
              ? <a href={url} target="_blank" rel="noopener noreferrer">{label}</a>
              : label}
          </span>
        );
      })}
    </span>
  );
}
