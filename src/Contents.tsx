import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
export type ContentEntry = {
  title: string;
  page: number | null;
  depth: number;
};
export async function readContents(
  pdf: PDFDocumentProxy,
): Promise<ContentEntry[]> {
  const entries: ContentEntry[] = [];
  const visit = async (
    items: NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>,
    depth: number,
  ) => {
    for (const item of items) {
      let page: number | null = null;
      try {
        const dest =
          typeof item.dest === "string"
            ? await pdf.getDestination(item.dest)
            : item.dest;
        if (dest?.length)
          page =
            (typeof dest[0] === "number"
              ? dest[0]
              : await pdf.getPageIndex(dest[0])) + 1;
      } catch {
        /* Unsupported destinations remain visible as headings. */
      }
      entries.push({ title: item.title, page, depth });
      await visit(item.items || [], depth + 1);
    }
  };
  await visit((await pdf.getOutline()) || [], 0);
  return entries;
}
export default function Contents({
  pdf,
  go,
}: {
  pdf: PDFDocumentProxy;
  go: (page: number) => void;
}) {
  const [entries, setEntries] = useState<ContentEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError("");
    readContents(pdf)
      .then((value) => {
        if (!cancelled) setEntries(value);
      })
      .catch(() => {
        if (!cancelled)
          setError("Unable to read this document’s table of contents.");
      });
    return () => {
      cancelled = true;
    };
  }, [pdf]);
  return (
    <div className="navigation-list">
      {error ? (
        <p>{error}</p>
      ) : entries === null ? (
        <p>Loading contents…</p>
      ) : entries.length ? (
        entries.map((entry, i) => (
          <button
            key={i}
            disabled={!entry.page}
            style={{ paddingLeft: 12 + entry.depth * 12 }}
            onClick={() => entry.page && go(entry.page)}
          >
            <span>{entry.title}</span>
            <small>{entry.page || ""}</small>
          </button>
        ))
      ) : (
        <>
          <p>
            This PDF has no embedded table of contents. Use pages or add your
            own bookmarks.
          </p>
          {Array.from({ length: pdf.numPages }, (_, i) => (
            <button key={i} onClick={() => go(i + 1)}>
              <span>Page {i + 1}</span>
              <small>{i + 1}</small>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
