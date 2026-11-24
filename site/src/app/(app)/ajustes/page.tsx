import { createClient, createServiceClient, requireSession } from "@/lib/supabase/server";
import { listBackups } from "@/lib/backup";
import { canManageConnection, householdPeople } from "@/lib/people";
import { recentActivity } from "@/lib/activity";
import { CancelCode, PluggyCredentialsForm, SignupCodeButton } from "./access-client";
import { getCategories } from "@/lib/queries";
import { dateBR } from "@/lib/format";
import { Topbar } from "@/components/topbar";
import { BankTile, CAT_COLOR, Icon } from "@/components/ui";
import { CategoryForm, CategoryRow, DeleteAccount, DisconnectButton, PayeeRow, RuleForm, RuleRow } from "./ajustes-client";
import { BackupDownload, BackupNow, InviteForm, MemberActions } from "./people-client";
import { PasskeyBox, TwoFactorSwitch } from "./security-client";
import { ThemePicker } from "./theme-picker";
import { OfflineToggle } from "./offline-toggle";
import type { Theme } from "./theme";
import { cookies } from "next/headers";

export default async function Ajustes() {
  const s = await requireSession();
  const tv = (await cookies()).get("apogeu-theme")?.value;
  const theme: Theme = tv === "light" || tv === "auto" ? tv : "dark";
  const db = await createClient();
  const [cats, { data: rules }, { data: payees }, { data: conns }, { count: txCount }] = await Promise.all([
    getCategories(db, s.householdId),
    db.from("rules").select("id, name, conditions, category_id, source, active, created_at").eq("household_id", s.householdId).order("created_at", { ascending: false }),
    db.from("payees").select("id, key, display_name, category_id, created_at").eq("household_id", s.householdId).order("created_at", { ascending: false }).limit(300),
    db.from("connections").select("id, institution, last_synced_at, consent_expires_at, created_by").eq("household_id", s.householdId),
    db.from("transactions").select("id", { count: "exact", head: true }).eq("household_id", s.householdId),
  ]);
  // nome legível do destinatário: o salvo, senão a descrição mais recente com essa chave
  const unnamed = (payees ?? []).filter((p) => !p.display_name).map((p) => p.key);
  const names = new Map<string, string>();
  if (unnamed.length) {
    const { data: named } = await db.from("transactions").select("payee_key, description, counterpart_name").eq("household_id", s.householdId).in("payee_key", unnamed).order("occurred_at", { ascending: false }).limit(1000);
    for (const t of named ?? []) if (!names.has(t.payee_key)) names.set(t.payee_key, t.counterpart_name ?? t.description);
  }
  const usage = new Map<string, number>();
  const { data: used } = await db.from("transactions").select("category_id").eq("household_id", s.householdId).not("category_id", "is", null).limit(10000);
  for (const u of used ?? []) usage.set(u.category_id, (usage.get(u.category_id) ?? 0) + 1);
  const opts = cats.filter((c) => c.kind !== "transfer").map((c) => ({ id: c.id, label: c.label, kind: c.kind }));
  const parents = cats.filter((c) => !c.parent_id && c.kind !== "transfer").map((c) => ({ id: c.id, label: c.name, kind: c.kind }));
  const catLabel = (id: string | null) => cats.find((c) => c.id === id)?.label ?? "—";

  // pessoas com acesso (e-mails vêm do Auth, só pelo servidor) e backups
  const admin = createServiceClient();
  const people = await householdPeople(admin, s.householdId);
  const activity = await recentActivity(db, s.householdId, people, s.userId);
  const [{ data: hh }, { data: cred }, { data: codes }] = await Promise.all([
    admin.from("households").select("uses_app_pluggy").eq("id", s.householdId).single(),
    admin.from("pluggy_credentials").select("client_id_hint, updated_at").eq("household_id", s.householdId).maybeSingle(),
    db.from("signup_codes").select("id, hint, created_at, expires_at, used_at").eq("household_id", s.householdId).order("created_at", { ascending: false }).limit(20),
  ]);
  const nowIso = new Date().toISOString();
  const backups = await listBackups(admin, s.householdId);
  const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  return (
    <>
      <Topbar title="Ajustes" />
      <div className="content page-in grid">
        <nav className="row-flex" aria-label="Seções">
          <a className="chip" href="#categorias">Categorias</a><a className="chip" href="#regras">Regras e destinatários</a><a className="chip" href="#pessoas">Pessoas com acesso</a><a className="chip" href="#acesso">Meu Pluggy e convites</a><a className="chip" href="#atividade">Atividade</a><a className="chip" href="#backups">Backups</a><a className="chip" href="#privacidade">Privacidade e dados</a>
        </nav>

        {/* ---------------- categorias */}
        <section id="categorias" className="bento" style={{ scrollMarginTop: 24 }}>
          <div className="card s8">
            <h3><Icon name="tag" size="sm" />Categorias<span className="sp" /><span className="t-xs muted">subcategorias somam na categoria principal nos gráficos e orçamentos</span></h3>
            <div className="list" style={{ marginTop: 8 }}>
              {cats.filter((c) => c.kind !== "transfer").map((c) => (
                <CategoryRow key={c.id} cat={{ id: c.id, name: c.name, label: c.label, color: c.color, icon: c.icon, parent: !!c.parent_id, system: c.is_system, kind: c.kind }}
                  uses={usage.get(c.id) ?? 0} moveOptions={opts.filter((o) => o.kind === c.kind && o.id !== c.id)} />
              ))}
            </div>
          </div>
          <div className="card s4">
            <h3><Icon name="plus" size="sm" />Nova categoria</h3>
            <CategoryForm parents={parents} />
          </div>
        </section>

        {/* ---------------- regras e destinatários */}
        <section id="regras" className="bento" style={{ scrollMarginTop: 24 }}>
          <div className="card s8">
            <h3><Icon name="check" size="sm" />Regras<span className="sp" /><span className="t-xs muted">valem antes de qualquer outra camada</span></h3>
            <div className="list" style={{ marginTop: 8 }}>
              {(rules ?? []).map((r) => (
                <RuleRow key={r.id} rule={{ id: r.id, name: r.name, source: r.source, active: r.active, category: catLabel(r.category_id), color: cats.find((c) => c.id === r.category_id)?.color ?? null }} />
              ))}
              {!rules?.length && <p className="ink2 t-sm" style={{ padding: "12px 0" }}>Nenhuma regra ainda. Elas também são sugeridas sozinhas depois de 3 correções iguais.</p>}
            </div>
          </div>
          <div className="card s4">
            <h3><Icon name="plus" size="sm" />Nova regra</h3>
            <RuleForm categories={opts} />
          </div>
          <div className="card s12">
            <h3><Icon name="inbox" size="sm" />Destinatários aprendidos<span className="sp" /><span className="t-xs muted">criados quando você corrige com “lembrar destinatário”</span></h3>
            <div className="list" style={{ marginTop: 8 }}>
              <Collapsed n={8} label="destinatários" items={(payees ?? []).map((p) => (
                <PayeeRow key={p.id} payee={{ id: p.id, name: p.display_name ?? names.get(p.key) ?? (p.key.startsWith("doc:") ? "Destinatário sem nome" : p.key.replace(/^d:/, "")), byDoc: p.key.startsWith("doc:"), category_id: p.category_id, created: dateBR(p.created_at) }} categories={opts} />
              ))} />
              {!payees?.length && <p className="ink2 t-sm" style={{ padding: "12px 0" }}>Nenhum destinatário aprendido ainda.</p>}
            </div>
          </div>
        </section>

        {/* ---------------- modo casal */}
        <section id="pessoas" className="bento" style={{ scrollMarginTop: 24 }}>
          <div className="card s7">
            <h3><Icon name="users" size="sm" />Pessoas com acesso<span className="sp" /><span className="t-xs muted">todos veem e editam as mesmas finanças</span></h3>
            <div className="list" style={{ marginTop: 8 }}>
              {people.map((p) => (
                <div className="row" key={p.id} style={{ gridTemplateColumns: "36px 1fr auto" }}>
                  <span className="ico-box"><Icon name={p.role === "owner" ? "lock" : "users"} size="sm" /></span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ overflowWrap: "anywhere" }}>{p.email}{p.id === s.userId && <span className="muted"> (você)</span>}</div>
                    <div className="t-xs muted">{p.role === "owner" ? "Dono da conta" : "Convidado"} · {p.active ? `desde ${dateBR(p.since, { day: "2-digit", month: "2-digit", year: "numeric" })}` : "aguardando o primeiro acesso"}</div>
                  </div>
                  {s.role === "owner" && p.role !== "owner" ? <MemberActions userId={p.id} email={p.email} pendingFirstAccess={!p.active} /> : <span />}
                </div>
              ))}
            </div>
          </div>
          <div className="card s5">
            <h3><Icon name="plus" size="sm" />Convidar alguém</h3>
            {s.role === "owner" ? (
              <>
                <p className="ink2 t-sm" style={{ marginTop: 10 }}>Para o modo casal: a pessoa recebe um link, cria a própria senha e o próprio 2FA. Nenhum e-mail é enviado pelo Apogeu; você manda o link.</p>
                <InviteForm />
              </>
            ) : <p className="ink2 t-sm" style={{ marginTop: 10 }}>Só o dono da conta pode convidar ou remover pessoas.</p>}
          </div>
        </section>

        {/* ---------------- conta Meu Pluggy e códigos para criar conta */}
        <section id="acesso" className="bento" style={{ scrollMarginTop: 24 }}>
          <div className="card s6">
            <h3><Icon name="link" size="sm" />Conta Meu Pluggy</h3>
            {hh?.uses_app_pluggy ? (
              <p className="ink2 t-sm" style={{ marginTop: 10 }}>Esta casa usa a conta Meu Pluggy do administrador do site (limite de 5 bancos, só desta casa).</p>
            ) : (
              <>
                <p className="ink2 t-sm" style={{ marginTop: 10 }}>
                  Os seus bancos chegam pela sua conta Meu Pluggy (grátis, até 5 bancos). Crie em meu.pluggy.ai, gere a aplicação no painel e cole aqui o client_id e o client_secret.
                  Eles ficam cifrados e só o servidor usa; ninguém da casa consegue ver de novo.
                </p>
                <p className="t-sm" style={{ marginTop: 8 }}>{cred ? <><Icon name="check" size="sm" /> Configurada: client_id terminando em <span className="mono">{cred.client_id_hint}</span>, desde {dateBR(cred.updated_at, { day: "2-digit", month: "2-digit", year: "numeric" })}.</> : <span style={{ color: "var(--warning)" }}><Icon name="alert" size="sm" /> Ainda não configurada: sem ela não dá para conectar bancos.</span>}</p>
                {s.role === "owner" ? <PluggyCredentialsForm configured={!!cred} /> : <p className="t-xs muted" style={{ marginTop: 8 }}>Só o dono da conta cadastra.</p>}
              </>
            )}
          </div>
          <div className="card s6">
            <h3><Icon name="users" size="sm" />Convites para criar conta</h3>
            <p className="ink2 t-sm" style={{ marginTop: 10 }}>Para alguém ter o próprio Apogeu, com finanças separadas e a própria conta Meu Pluggy. Diferente de “Convidar alguém” (modo casal), que divide estas finanças.</p>
            {s.role === "owner" ? <SignupCodeButton /> : <p className="t-xs muted" style={{ marginTop: 8 }}>Só o dono da conta gera códigos.</p>}
            <div className="list" style={{ marginTop: 10 }}>
              {(codes ?? []).map((c) => {
                const status = c.used_at ? `usado em ${dateBR(c.used_at)}` : c.expires_at < nowIso ? "vencido" : `ativo até ${dateBR(c.expires_at)}`;
                return (
                  <div className="row" key={c.id} style={{ gridTemplateColumns: "1fr auto" }}>
                    <div><span className="mono">••••-••••-••{c.hint.slice(2)}</span> <span className="t-xs muted">· {status}</span></div>
                    {!c.used_at && c.expires_at >= nowIso && s.role === "owner" ? <CancelCode id={c.id} hint={c.hint} /> : <span />}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---------------- atividade (quem fez o quê) */}
        <section id="atividade" className="bento" style={{ scrollMarginTop: 24 }}>
          <div className="card s12">
            <h3><Icon name="clock" size="sm" />Atividade recente<span className="sp" /><span className="t-xs muted">quem fez cada alteração · últimas 30</span></h3>
            <div className="list" style={{ marginTop: 8 }}>
              <Collapsed n={8} label="registros" items={activity.map((a, i) => (
                <div className="row" key={i} style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                  <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><b style={{ fontWeight: 500 }}>{a.who}</b> <span className="ink2">{a.what}</span></div>
                  <span className="t-xs muted num">{dateBR(a.at, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))} />
              {!activity.length && <p className="ink2 t-sm" style={{ padding: "12px 0" }}>Nenhuma alteração registrada ainda.</p>}
            </div>
          </div>
        </section>

        {/* ---------------- backups */}
        <section id="backups" className="bento" style={{ scrollMarginTop: 24 }}>
          <div className="card s12">
            <h3><Icon name="database" size="sm" />Backups<span className="sp" /><span className="t-xs muted">automático toda semana · guarda os 8 últimos</span></h3>
            <p className="ink2 t-sm" style={{ marginTop: 10, maxWidth: 760 }}>Cópia compactada (JSON) de todos os dados da casa e dos comprovantes, num cofre privado que só o servidor grava. Como o cofre fica no mesmo projeto, baixe uma cópia uma vez por mês e guarde fora daqui (o painel lembra). Baixar pede o código do 2FA se o último tiver mais de 15 minutos.</p>
            <details className="admin-note"><summary className="t-xs muted">Para o administrador</summary><p className="t-xs muted" style={{ marginTop: 8, maxWidth: 760 }}>Para restaurar: <span className="mono">node --env-file=.env.local scripts/restore-backup.mjs arquivo.json.gz</span>. Os CPFs/CNPJs completos só voltam com a mesma chave DOC_ENC_KEY: guarde-a no seu gerenciador de senhas.</p></details>
            <div className="list" style={{ marginTop: 8 }}>
              {backups.map((b) => (
                <div className="row" key={b.name} style={{ gridTemplateColumns: "36px 1fr auto auto" }}>
                  <span className="ico-box"><Icon name="database" size="sm" /></span>
                  <div><div>{dateBR(b.name.slice(0, 10) + "T12:00:00", { day: "2-digit", month: "2-digit", year: "numeric" })}</div><div className="t-xs muted">{b.name.includes("-manual-") ? "feito por você" : "automático"}</div></div>
                  <span className="t-sm muted num">{kb(b.size)}</span>
                  <BackupDownload name={b.name} />
                </div>
              ))}
              {!backups.length && <p className="ink2 t-sm" style={{ padding: "12px 0" }}>Nenhum backup ainda. O primeiro sai na próxima rodada diária ou agora, pelo botão.</p>}
            </div>
            <BackupNow />
          </div>
        </section>

        {/* ---------------- aparência */}
        <section id="aparencia" className="bento" style={{ scrollMarginTop: 24 }}>
          <div className="card s12">
            <h3><Icon name="eye" size="sm" />Aparência e uso</h3>
            <div className="grid" style={{ gap: 8, marginTop: 14 }}>
              <ThemePicker current={theme} />
              <p className="t-sm muted">Automático segue o tema do aparelho.</p>
            </div>
            <div style={{ marginTop: 22 }}><OfflineToggle /></div>
          </div>
        </section>

        {/* ---------------- segurança */}
        <section id="seguranca" className="bento" style={{ scrollMarginTop: 24 }}>
          <div className="card s12">
            <h3><Icon name="lock" size="sm" />Segurança</h3>
            <div className="grid" style={{ gap: 22, marginTop: 14 }}>
              <TwoFactorSwitch on={!s.mfaOptional} />
              <PasskeyBox skips={s.passkeySkips} twoFactorOn={!s.mfaOptional} aal2={s.aal === "aal2"} />
            </div>
          </div>
        </section>

        {/* ---------------- privacidade */}
        <section id="privacidade" className="bento" style={{ scrollMarginTop: 24 }}>
          <div className="card s12 row-flex" style={{ gap: 16 }}>
            <Icon name="lock" size="sm" /><span className="ink2 t-sm" style={{ flex: "1 1 320px" }}>Como os seus dados são tratados, onde ficam e por quanto tempo.</span>
            <a className="btn ghost" href="/privacidade" target="_blank" rel="noopener">Política de privacidade</a>
            <a className="btn ghost" href="/termos" target="_blank" rel="noopener">Termos de uso</a>
          </div>
          <div className="card s12 row-flex install-link" style={{ gap: 16 }}>
            <Icon name="download" size="sm" /><span className="ink2 t-sm" style={{ flex: "1 1 320px" }}>Use o Apogeu como app no celular, no Android ou no iPhone.</span>
            <a className="btn ghost" href="/instalar">Instalar o app</a>
          </div>
          <div className="card s6">
            <h3><Icon name="download" size="sm" />Exportar todos os meus dados</h3>
            <p className="ink2 t-sm" style={{ marginTop: 10 }}>Um arquivo JSON com tudo o que o Apogeu guarda sobre você: {txCount ?? 0} transações, categorias, regras, contas, metas, orçamentos e o registro de auditoria. Pede o código do 2FA se ele foi digitado há mais de 15 minutos.</p>
            <a className="btn" href="/api/export/all" style={{ marginTop: 14 }}><Icon name="download" size="sm" />Baixar meus dados (JSON)</a>
          </div>
          <div className="card s6">
            <h3><Icon name="link" size="sm" />Conexões com bancos</h3>
            <p className="ink2 t-sm" style={{ marginTop: 10 }}>Desconectar revoga o consentimento na Pluggy: o banco para de enviar dados. O histórico já importado continua aqui.</p>
            <div className="list" style={{ marginTop: 8 }}>
              {(conns ?? []).map((c) => (
                <div className="row" key={c.id} style={{ gridTemplateColumns: "36px 1fr auto" }}>
                  <BankTile institution={c.institution} />
                  <div><div>{c.institution ?? "Instituição"}</div><div className="t-xs muted">{c.consent_expires_at ? `consentimento até ${dateBR(c.consent_expires_at, { day: "2-digit", month: "2-digit", year: "numeric" })}` : "sem data de expiração"}</div></div>
                  {canManageConnection(c, s) ? <DisconnectButton id={c.id} name={c.institution ?? "esta instituição"} /> : <span className="t-xs muted">de {people.find((p) => p.id === c.created_by)?.email ?? "outra pessoa"}</span>}
                </div>
              ))}
              {!conns?.length && <span className="ink2 t-sm">Nenhum banco conectado.</span>}
            </div>
          </div>
          <div className="card s12" style={{ borderColor: "rgba(208,59,59,.35)" }}>
            <h3 style={{ color: "var(--critical-text)" }}><Icon name="alert" size="sm" />{s.role === "owner" ? "Excluir minha conta e todos os dados" : "Sair e excluir o meu login"}</h3>
            {s.role !== "owner" ? <p className="ink2 t-sm" style={{ marginTop: 10, maxWidth: 760 }}>Remove o seu acesso e apaga o seu login. As finanças da casa continuam com o dono da conta.</p> : <p className="ink2 t-sm" style={{ marginTop: 10, maxWidth: 760 }}>
              Revoga todas as conexões com bancos, apaga comprovantes, transações, categorias, regras, metas e o registro de auditoria, e remove o seu login.
              {people.length > 1 && " Também apaga o acesso das pessoas que você convidou."}
              <b style={{ fontWeight: 500 }}> Não há como desfazer.</b> Baixe os seus dados antes, se quiser guardar.
            </p>}
            <DeleteAccount />
          </div>
        </section>
        <div className="t-xs muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="dot" style={{ background: CAT_COLOR(null) }} />Seus dados ficam no seu projeto Supabase, protegidos por RLS e 2FA.
        </div>
      </div>
    </>
  );
}

/** Lista longa: mostra as primeiras n e guarda o resto num "Ver todos" (sem poluir a página). */
function Collapsed({ items, n, label }: { items: React.ReactNode[]; n: number; label: string }) {
  if (items.length <= n) return <>{items}</>;
  return (
    <>
      {items.slice(0, n)}
      <details className="more-list">
        <summary>Ver todos os {items.length} {label}</summary>
        {items.slice(n)}
      </details>
    </>
  );
}
