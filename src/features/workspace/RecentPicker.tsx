import { useEffect, useRef, useState } from "react";
import { FileText, Search, X } from "lucide-react";
import type { DocumentWorkspace } from "./useDocumentWorkspace";

export function RecentPicker({ recents, busy, onOpen, onClose }: {
  recents: DocumentWorkspace["recents"];
  busy: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const matches = recents.filter(file => `${file.name} ${file.path}`.toLowerCase().includes(query.trim().toLowerCase()));
  const active = Math.min(selected, Math.max(0, matches.length - 1));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, query]);
  return (
    <div className="recent-picker-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="recent-picker" role="dialog" aria-modal="true" aria-label="Open recent file"
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
          if (event.key === "Tab") {
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input, button'));
            const index = controls.indexOf(document.activeElement as HTMLElement);
            event.preventDefault();
            controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
          }
        }}>
        <div className="recent-picker-search">
          <Search size={17} />
          <input ref={input} value={query} placeholder="Search recent files by name or path…"
            role="combobox" aria-label="Search recent files" aria-autocomplete="list" aria-expanded="true"
            aria-controls="recent-picker-list" aria-activedescendant={matches.length ? `recent-option-${active}` : undefined}
            onChange={event => { setQuery(event.target.value); setSelected(0); }}
            onKeyDown={event => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (matches.length) setSelected((active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (!busy && matches[active]) onOpen(matches[active].id);
              }
            }} />
          <button className="icon-button" aria-label="Close recent files" onClick={onClose}><X size={16} /></button>
        </div>
        <div ref={list} className="recent-picker-list" id="recent-picker-list" role="listbox" aria-label="Recent files" aria-busy={busy}>
          {matches.map((file, index) => (
            <div key={file.id} id={`recent-option-${index}`} role="option" aria-selected={index === active}
              aria-disabled={busy} className="recent-picker-option" title={file.path}
              onMouseMove={() => setSelected(index)} onClick={() => { if (!busy) onOpen(file.id); }}>
              <FileText size={17} /><span>{file.name}<small>{file.path}</small></span>
            </div>
          ))}
        </div>
        {!matches.length && <p className="recent-picker-empty" role="status">{recents.length ? "No matching recent files." : "No recent files yet. Open a PDF to get started."}</p>}
        <div className="recent-picker-hint">↑ ↓ to navigate · Enter to open · Esc to dismiss</div>
      </section>
    </div>
  );
}
