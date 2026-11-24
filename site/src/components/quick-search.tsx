"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, Money } from "./ui";
import { NAV } from "./nav";
import { normalizeDesc } from "@/lib/format";
import { quickSearch, type SearchHit } from "@/app/(app)/actions";

type Item = { key: string; title: string; sub: string; href: string; icon: string; cents?: number };
const OPEN = "apogeu-search";

/** Botão de lupa (útil no celular, onde não há Ctrl+F). */
export function SearchButton() {
  return (
    <button className="btn icon" aria-label="Buscar (Ctrl+F)" title="Buscar · Ctrl+F" onClick={() => window.dispatchEvent(new Event(OPEN))}>
      <Icon name="search" />
    </button>
  );
}

/**
 * Busca rápida: Ctrl+F (ou Ctrl+K) abre; procura telas, categorias, contas e transações.
 * Com a busca aberta, Ctrl+F de novo fecha e deixa o navegador fazer a busca normal na página.
 */
export function QuickSearch() {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const show = () => { setOpen(true); setQ(""); setHits([]); setSel(0); };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || (k !== "f" && k !== "k")) return;
      if (ref.current?.open) { if (k === "f") { ref.current.close(); return; } e.preventDefault(); return; } // 2º Ctrl+F: busca do navegador
      if (document.querySelector("dialog[open]")) return; // outra janela aberta: não atrapalha
      e.preventDefault();
      show();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN, show);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN, show); };
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try { const r = await quickSearch(term); if (alive) { setHits(r); setSel(0); } } catch { /* sessão caiu: ignora */ }
      if (alive) setLoading(false);
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const term = normalizeDesc(q.trim());
  const pages: Item[] = term
    ? NAV.filter(([, label]) => normalizeDesc(label).includes(term)).map(([icon, label, href]) => ({ key: href, title: label, sub: "Tela", href, icon }))
    : NAV.slice(0, 6).map(([icon, label, href]) => ({ key: href, title: label, sub: "Tela", href, icon }));
  const items: Item[] = [
    ...pages,
    ...(q.trim().length >= 2 ? hits : []).map((h) => ({ key: `${h.kind}-${h.id}`, title: h.title, sub: h.sub, href: h.href, cents: h.cents, icon: h.kind === "cat" ? "tag" : h.kind === "acc" ? "landmark" : "table" })),
  ];
  const go = (it?: Item) => { if (!it) return; setOpen(false); router.push(it.href); };

  return (
    <dialog ref={ref} className="modal qs" aria-label="Busca rápida" onClose={() => setOpen(false)}
      onClick={(e) => { if (e.target === ref.current) setOpen(false); }}>
      {open && (
        <>
          <label className="qs-field">
            <Icon name="search" size="sm" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar transação, valor, categoria, conta ou tela"
              aria-label="Buscar" aria-controls="qs-list" aria-activedescendant={items[sel] ? `qs-${sel}` : undefined} role="combobox" aria-expanded="true"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setSel((v) => Math.min(items.length - 1, v + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setSel((v) => Math.max(0, v - 1)); }
                else if (e.key === "Enter") { e.preventDefault(); go(items[sel]); }
              }} />
            <kbd className="desk-only-inline">Esc</kbd>
          </label>
          <ul id="qs-list" role="listbox" className="qs-list">
            {items.map((it, k) => (
              <li key={it.key} id={`qs-${k}`} role="option" aria-selected={k === sel} className={k === sel ? "on" : ""}
                onMouseMove={() => setSel(k)} onClick={() => go(it)}>
                <Icon name={it.icon} size="sm" />
                <span className="qs-t">{it.title}</span>
                <span className="qs-s">{it.sub}</span>
                {it.cents !== undefined && <Money cents={it.cents} sign color />}
              </li>
            ))}
            {q.trim().length >= 2 && !loading && !items.length && <li className="qs-empty">Nada encontrado.</li>}
          </ul>
        </>
      )}
    </dialog>
  );
}
