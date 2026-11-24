import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient, mfaIsRecent, requireSession } from "@/lib/supabase/server";
import { monthRange } from "@/lib/format";

// Exporta as transações do mês em Excel ou CSV. Exige 2FA recente (dado sensível saindo do site).
export async function GET(req: Request) {
  const s = await requireSession();
  const url = new URL(req.url);
  if (!mfaIsRecent(s)) return NextResponse.redirect(new URL(`/mfa?reauth=1&next=${encodeURIComponent("/transacoes")}`, url));
  const m = monthRange(url.searchParams.get("mes") ?? undefined);
  const months = [1, 3, 6, 12].includes(Number(url.searchParams.get("periodo"))) ? Number(url.searchParams.get("periodo")) : 1;
  const first = monthRange(new Date(Date.UTC(m.year, m.month - (months - 1), 15)).toISOString().slice(0, 7));
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const db = await createClient();
  const { data } = await db
    .from("transactions")
    .select("occurred_at, description, description_raw, amount_cents, status, notes, categories(name), accounts(name), transaction_tags(tags(name))")
    .eq("household_id", s.householdId).is("deleted_at", null)
    .gte("occurred_at", first.start.toISOString()).lt("occurred_at", m.end.toISOString())
    .order("occurred_at");

  const rows = (data ?? []).map((t) => ({
    data: new Date(t.occurred_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    descricao: t.description,
    original: t.description_raw,
    categoria: (t.categories as unknown as { name: string } | null)?.name ?? "",
    conta: (t.accounts as unknown as { name: string } | null)?.name ?? "",
    valor: t.amount_cents / 100,
    situacao: t.status === "canceled" ? "cancelada" : t.status === "review" ? "revisar" : "ok",
    tags: ((t.transaction_tags ?? []) as unknown as { tags: { name: string } | null }[]).map((x) => x.tags?.name).filter(Boolean).join(", "),
    anotacao: t.notes ?? "",
  }));
  const name = months === 1 ? `apogeu-${m.key}` : `apogeu-${first.key}-a-${m.key}`;

  if (format === "csv") {
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // evita injeção de fórmula (OWASP)
      return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const head = "Data;Descrição;Descrição original;Categoria;Conta;Valor;Situação;Tags;Anotação";
    // o valor é número formatado por nós: não passa pelo filtro de fórmula (senão “-12,50” viraria texto)
    const body = rows.map((r) => [esc(r.data), esc(r.descricao), esc(r.original), esc(r.categoria), esc(r.conta), r.valor.toFixed(2).replace(".", ","), esc(r.situacao), esc(r.tags), esc(r.anotacao)].join(";"));
    return new NextResponse("﻿" + [head, ...body].join("\r\n"), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" },
    });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(m.label);
  ws.columns = [
    { header: "Data", key: "data", width: 18 }, { header: "Descrição", key: "descricao", width: 32 }, { header: "Descrição original", key: "original", width: 36 },
    { header: "Categoria", key: "categoria", width: 18 }, { header: "Conta", key: "conta", width: 18 }, { header: "Valor (R$)", key: "valor", width: 14, style: { numFmt: "#,##0.00;[Red]-#,##0.00" } },
    { header: "Situação", key: "situacao", width: 12 }, { header: "Tags", key: "tags", width: 20 }, { header: "Anotação", key: "anotacao", width: 30 },
  ];
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "I1" };
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "no-store" },
  });
}
