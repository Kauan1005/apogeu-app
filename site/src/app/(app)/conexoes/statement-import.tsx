"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui";
import { notify } from "@/components/notify";
import { brl } from "@/lib/format";
import { decodeStatement, looksInverted, numberDuplicates, parseAmount, parseStatement, type StmtParsed } from "@/lib/statement-import";
import { importStatementChunk } from "./import-actions";

const CHUNK = 150;
const fmtDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Importar extrato (OFX ou CSV) de banco ou cartão que o Open Finance não cobre. O arquivo é lido aqui no aparelho. */
export function StatementImport({ accountNames }: { accountNames: string[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<StmtParsed | null>(null);
  const [fileName, setFileName] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"bank" | "credit">("bank");
  const [invert, setInvert] = useState(false);
  const [balance, setBalance] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ inserted: number; updated: number; review: number; total: number } | null>(null);

  const reset = () => { setParsed(null); setFileName(""); setName(""); setKind("bank"); setInvert(false); setBalance(""); setErr(""); setProgress(0); if (input.current) input.current.value = ""; };

  const onFile = async (f: File | undefined) => {
    setErr(""); setResult(null);
    if (!f) return;
    if (f.size > 5_000_000) return setErr("Arquivo grande demais (máximo 5 MB).");
    try {
      const p = parseStatement(decodeStatement(await f.arrayBuffer()));
      if (p.rows.length > 5000) return setErr("Mais de 5.000 lançamentos num arquivo só. Divida por período.");
      const k = p.kind ?? "bank";
      setParsed(p); setFileName(f.name); setKind(k); setInvert(looksInverted(p.rows, k));
      setName((p.org ? p.org.slice(0, 40) : f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")).trim().slice(0, 60));
      setBalance(p.balanceCents != null ? (p.balanceCents / 100).toFixed(2).replace(".", ",") : "");
    } catch (e) { setParsed(null); setErr(e instanceof Error ? e.message : "Não consegui ler este arquivo."); }
  };

  const sign = invert ? -1 : 1;
  const rows = parsed?.rows ?? [];
  const inCents = rows.filter((r) => r.cents * sign > 0).reduce((a, r) => a + r.cents * sign, 0);
  const outCents = rows.filter((r) => r.cents * sign < 0).reduce((a, r) => a + r.cents * sign, 0);
  const dates = rows.map((r) => r.date).sort();

  const run = async () => {
    if (!parsed) return;
    setBusy(true); setErr(""); setProgress(0);
    const all = numberDuplicates(parsed.rows);
    const bal = kind === "bank" && balance.trim() ? parseAmount(balance) : null;
    const sum = { inserted: 0, updated: 0, review: 0, total: all.length };
    try {
      for (let i = 0; i < all.length; i += CHUNK) {
        const part = all.slice(i, i + CHUNK);
        const r = (await importStatementChunk({ accountName: name, kind, invert, rows: part, final: i + CHUNK >= all.length, balanceCents: bal, totalRows: all.length })) as
          { error: string } | { ok: true; inserted: number; updated: number; review: number; total: number };
        if ("error" in r) { setErr(r.error); return; }
        sum.inserted += r.inserted; sum.updated += r.updated; sum.review += r.review;
        setProgress(Math.min(all.length, i + CHUNK));
      }
      setResult(sum);
      notify(`${sum.inserted} lançamentos importados.`);
      reset();
      router.refresh();
    } catch { setErr("A importação falhou no meio. Tente de novo: o que já entrou não duplica."); }
    finally { setBusy(false); }
  };

  return (
    <div className="card stmt">
      <h3><Icon name="file" size="sm" />Importar extrato</h3>
      <p className="t-sm muted">Para banco ou cartão que o Open Finance não cobre. Baixe o extrato (OFX ou CSV) no app ou no site do banco e escolha o arquivo.</p>

      {!parsed && (
        <label className="btn stmt-pick" style={{ justifySelf: "start" }}>
          <Icon name="plus" size="sm" />Escolher arquivo
          <input ref={input} type="file" accept=".ofx,.csv,.txt,text/csv,application/x-ofx" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      )}
      {err && <span className="err" role="alert">{err}</span>}

      {parsed && (
        <div className="stmt-form">
          <div className="t-sm ink2" data-testid="stmt-summary">
            <b>{fileName}</b>: {rows.length} {rows.length === 1 ? "lançamento" : "lançamentos"} de {fmtDate(dates[0])} a {fmtDate(dates[dates.length - 1])}
            {parsed.skipped > 0 ? <span className="muted"> · {parsed.skipped} linhas ignoradas</span> : null}
          </div>
          <div className="stmt-totals t-sm">
            <span className="in num">Entradas {brl(inCents)}</span><span className="out num">Saídas {brl(Math.abs(outCents))}</span>
          </div>
          <div className="stmt-sample" aria-label="Primeiros lançamentos">
            {rows.slice(0, 4).map((r, i) => (
              <div className="row t-xs" key={i}><span className="muted num">{fmtDate(r.date).slice(0, 5)}</span><span className="stmt-desc">{r.desc}</span><span className={`num ${r.cents * sign > 0 ? "in" : "out"}`}>{brl(r.cents * sign, true)}</span></div>
            ))}
            {rows.length > 4 && <div className="t-xs muted">e mais {rows.length - 4}…</div>}
          </div>

          <label className="f">Nome da conta
            <input className="input" list="stmt-names" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Nubank cartão" />
            <datalist id="stmt-names">{accountNames.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <label className="f">Tipo
            <select className="input" value={kind} onChange={(e) => { const k = e.target.value as "bank" | "credit"; setKind(k); setInvert(looksInverted(parsed.rows, k)); }}>
              <option value="bank">Conta (corrente ou poupança)</option><option value="credit">Cartão de crédito</option>
            </select>
          </label>
          {kind === "bank" && (
            <label className="f">Saldo atual (opcional)
              <input className="input" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0,00" />
            </label>
          )}
          <label className="stmt-check">
            <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
            <span>Inverter entradas e saídas{invert ? <span className="muted"> (sugerido: neste arquivo as compras vêm como positivas)</span> : null}</span>
          </label>

          {busy && <div className="bar-track" role="progressbar" aria-valuenow={progress} aria-valuemax={rows.length}><div className="bar-fill" style={{ width: `${Math.round((progress / rows.length) * 100)}%`, background: "var(--ink-2)" }} /></div>}
          <div className="row-flex" style={{ gap: 8 }}>
            <button className="btn primary" disabled={busy || name.trim().length < 2} onClick={() => void run()}>{busy ? `Importando… ${progress}/${rows.length}` : `Importar ${rows.length} lançamentos`}</button>
            <button className="btn ghost" disabled={busy} onClick={reset}>Cancelar</button>
          </div>
        </div>
      )}

      {result && (
        <p className="t-sm ink2" role="status" data-testid="stmt-result">
          {result.inserted} novos{result.total - result.inserted > 0 ? `, ${result.total - result.inserted} já existiam` : ""}.
          {result.review > 0 ? <> {result.review} para revisar. <Link className="link" href="/revisar">Revisar agora</Link></> : null}
        </p>
      )}
    </div>
  );
}
