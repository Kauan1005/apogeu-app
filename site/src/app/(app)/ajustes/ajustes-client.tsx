"use client";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCategory, createRule, deleteAccount, deleteCategory, deletePayee, deleteRule, disconnectBank, renameCategory, setPayeeCategory, setRuleActive,
} from "./actions";
import { CAT_COLOR, Icon } from "@/components/ui";

type State = null | { ok?: boolean; error?: string; message?: string; reauth?: boolean };
type Opt = { id: string; label: string; kind: string };
const COLORS = [["", "Sem cor (Demais)"], ["c1", "Azul"], ["c2", "Laranja"], ["c3", "Verde-água"], ["c4", "Amarelo"], ["c5", "Rosa"], ["c6", "Verde"]] as const;

function useReauth(next = "/ajustes") {
  const router = useRouter();
  return (r?: State) => { if (r?.reauth) { router.push(`/mfa?reauth=1&next=${encodeURIComponent(next)}`); return true; } return false; };
}

// ------------------------------------------------------------ categorias
export function CategoryForm({ parents }: { parents: Opt[] }) {
  const [parent, setParent] = useState("");
  // o React limpa o formulário depois de enviar; o seletor de "Dentro de" precisa voltar junto
  const [state, action, pending] = useActionState(async (prev: State, fd: FormData) => {
    const r = await createCategory(prev, fd);
    if (r.ok) setParent("");
    return r;
  }, null as State);
  return (
    <form action={action} className="grid" style={{ gap: 12, marginTop: 14 }}>
      <label className="f">Nome<input className="input" name="name" required minLength={2} maxLength={40} placeholder="Ex.: Delivery" /></label>
      <label className="f">Dentro de (opcional)
        <select className="input" name="parent_id" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">— categoria principal —</option>{parents.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      {!parent && (
        <div className="row-flex">
          <label className="f" style={{ flex: 1 }}>Tipo<select className="input" name="kind" defaultValue="expense"><option value="expense">Gasto</option><option value="income">Entrada</option></select></label>
          <label className="f" style={{ flex: 1 }}>Cor no gráfico<select className="input" name="color" defaultValue="">{COLORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
      )}
      {parent && <input type="hidden" name="kind" value="expense" />}
      <button className="btn primary" disabled={pending} style={{ justifySelf: "start" }}><Icon name="plus" size="sm" />Criar</button>
      {state?.error && <span className="err" role="alert">{state.error}</span>}
      {state?.ok && <span className="ok-msg" role="status">Categoria criada.</span>}
    </form>
  );
}

export function CategoryRow({ cat, uses, moveOptions }: { cat: { id: string; name: string; label: string; color: string | null; icon: string | null; parent: boolean; system: boolean; kind: string }; uses: number; moveOptions: Opt[] }) {
  const [mode, setMode] = useState<"" | "edit" | "delete">("");
  const [name, setName] = useState(cat.name);
  const [color, setColor] = useState(cat.color ?? "");
  const [moveTo, setMoveTo] = useState(moveOptions[0]?.id ?? "");
  const reauth = useReauth();
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className={`row${cat.parent ? " sub-cat" : ""}`} style={{ gridTemplateColumns: "36px minmax(0, 1fr) auto" }}>
      <span className="ico-box" style={{ color: CAT_COLOR(cat.color) }}><Icon name={cat.icon ?? "dots"} /></span>
      {mode === "edit" ? (
        <div className="row-flex" style={{ gap: 8 }}>
          <input className="input" aria-label="Nome da categoria" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} style={{ flex: "1 1 160px" }} />
          {!cat.parent && <select className="input" aria-label="Cor" value={color} onChange={(e) => setColor(e.target.value)}>{COLORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
          <button className="btn primary" disabled={pending} onClick={() => start(async () => { const r = await renameCategory(cat.id, name, color); if (r.error) setErr(r.error); else setMode(""); })}>Salvar</button>
          <button className="btn ghost" onClick={() => setMode("")}>Cancelar</button>
        </div>
      ) : mode === "delete" ? (
        <div className="row-flex" style={{ gap: 8 }}>
          <span className="t-sm ink2">Mover {uses} {uses === 1 ? "transação" : "transações"} para</span>
          <select className="input" aria-label="Categoria de destino" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>{moveOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          <button className="btn" style={{ color: "var(--critical-text)" }} disabled={pending} onClick={() => start(async () => { const r = await deleteCategory(cat.id, moveTo); if (!reauth(r) && r.error) setErr(r.error); })}>Apagar</button>
          <button className="btn ghost" onClick={() => setMode("")}>Cancelar</button>
        </div>
      ) : (
        <div><div>{cat.name}{cat.system && <span className="t-xs muted"> · padrão</span>}</div><div className="t-xs muted">{cat.kind === "income" ? "Entrada" : "Gasto"} · {uses} {uses === 1 ? "transação" : "transações"}</div></div>
      )}
      {mode === "" && (
        <div className="row-flex" style={{ gap: 4 }}>
          <button className="btn ghost" onClick={() => setMode("edit")}>Editar</button>
          {!cat.system && <button className="btn ghost icon" aria-label={`Apagar ${cat.label}`} onClick={() => setMode("delete")}><Icon name="trash" size="sm" /></button>}
        </div>
      )}
      {err && <span className="err" role="alert" style={{ gridColumn: "2 / -1" }}>{err}</span>}
    </div>
  );
}

// ------------------------------------------------------------ regras e destinatários
export function RuleForm({ categories }: { categories: Opt[] }) {
  const [state, action, pending] = useActionState(createRule, null as State);
  return (
    <form action={action} className="grid" style={{ gap: 12, marginTop: 14 }}>
      <div className="row-flex">
        <label className="f" style={{ flex: 1 }}>Quando<select className="input" name="field" defaultValue="description"><option value="description">a descrição</option><option value="counterpart_name">o destinatário</option></select></label>
        <label className="f" style={{ flex: 1 }}>&nbsp;<select className="input" name="op" aria-label="Condição" defaultValue="contains"><option value="contains">contém</option><option value="equals">é igual a</option></select></label>
      </div>
      <label className="f">Texto<input className="input" name="value" required minLength={2} maxLength={60} placeholder="Ex.: ifood" /></label>
      <label className="f">Categoria<select className="input" name="category_id" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label className="t-sm ink2" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="apply" defaultChecked />Aplicar agora às transações em revisão</label>
      <button className="btn primary" disabled={pending} style={{ justifySelf: "start" }}><Icon name="check" size="sm" />Salvar regra</button>
      {state?.error && <span className="err" role="alert">{state.error}</span>}
      {state?.message && <span className="ok-msg" role="status">{state.message}</span>}
    </form>
  );
}

export function RuleRow({ rule }: { rule: { id: string; name: string; source: string; active: boolean; category: string; color: string | null } }) {
  const [pending, start] = useTransition();
  const reauth = useReauth();
  const src = { manual: "criada por você", auto: "automática", suggested: "sugerida — aguardando" }[rule.source] ?? rule.source;
  return (
    <div className="row" style={{ gridTemplateColumns: "1fr auto", opacity: pending ? 0.6 : rule.active ? 1 : 0.55 }}>
      <div>
        <div>{rule.name} → <span className="row-flex" style={{ display: "inline-flex", gap: 6 }}><span className="dot" style={{ background: CAT_COLOR(rule.color) }} />{rule.category}</span></div>
        <div className="t-xs muted">{src}{rule.active ? "" : " · pausada"}</div>
      </div>
      <div className="row-flex" style={{ gap: 4 }}>
        <button className="btn ghost" disabled={pending} onClick={() => start(() => setRuleActive(rule.id, !rule.active))}>{rule.active && rule.source !== "suggested" ? "Pausar" : "Ativar"}</button>
        <button className="btn ghost icon" aria-label={`Apagar regra ${rule.name}`} disabled={pending} onClick={() => confirm("Apagar esta regra?") && start(async () => { reauth(await deleteRule(rule.id)); })}><Icon name="trash" size="sm" /></button>
      </div>
    </div>
  );
}

export function PayeeRow({ payee, categories }: { payee: { id: string; name: string; byDoc: boolean; category_id: string | null; created: string }; categories: Opt[] }) {
  const [pending, start] = useTransition();
  const reauth = useReauth();
  return (
    <div className="row payee-row" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 220px) auto", opacity: pending ? 0.6 : 1 }}>
      <div style={{ minWidth: 0 }}><div style={{ overflowWrap: "anywhere" }}>{payee.name}</div><div className="t-xs muted">{payee.byDoc ? "reconhecido pelo CPF/CNPJ" : "reconhecido pela descrição"} · desde {payee.created}</div></div>
      <select className="input" style={{ width: "100%", minWidth: 0 }} aria-label={`Categoria de ${payee.name}`} value={payee.category_id ?? ""} disabled={pending} onChange={(e) => start(() => setPayeeCategory(payee.id, e.target.value))}>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <button className="btn ghost icon" aria-label={`Esquecer ${payee.name}`} disabled={pending} onClick={() => confirm(`Esquecer ${payee.name}? As próximas transações dele voltam a ser categorizadas pelas outras camadas.`) && start(async () => { reauth(await deletePayee(payee.id)); })}><Icon name="x" size="sm" /></button>
    </div>
  );
}

// ------------------------------------------------------------ privacidade
export function DisconnectButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const reauth = useReauth("/conexoes");
  return (
    <>
      <button className="btn ghost" disabled={pending} onClick={() => confirm(`Desconectar ${name}? O banco deixa de enviar dados; o histórico continua aqui.`) && start(async () => {
        const r = await disconnectBank(id);
        if (!reauth(r) && r.error) setErr(r.error);
      })}>{pending ? "Desconectando…" : "Desconectar"}</button>
      {err && <span className="err" role="alert">{err}</span>}
    </>
  );
}

export function DeleteAccount() {
  const router = useRouter();
  const reauth = useReauth("/ajustes#privacidade");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const ready = text.trim().toUpperCase() === "EXCLUIR MINHA CONTA";
  return (
    <div className="row-flex" style={{ marginTop: 14, alignItems: "end" }}>
      <label className="f" style={{ flex: "1 1 260px" }}>Para confirmar, digite EXCLUIR MINHA CONTA<input className="input" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" /></label>
      <button className="btn" disabled={!ready || pending} style={{ height: 40, color: ready ? "var(--critical-text)" : undefined, borderColor: ready ? "var(--critical)" : undefined }}
        onClick={() => start(async () => {
          const r = await deleteAccount(text);
          if (reauth(r)) return;
          if (r.error) return setErr(r.error);
          router.replace("/login?excluida=1");
        })}>
        <Icon name="trash" size="sm" />{pending ? "Excluindo…" : "Excluir tudo"}
      </button>
      {err && <span className="err" role="alert">{err}</span>}
    </div>
  );
}
