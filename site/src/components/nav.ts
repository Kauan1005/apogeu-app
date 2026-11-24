// Itens da navegação (arquivo sem "use client" para ser usado por páginas do servidor também).
export const NAV = [
  ["dashboard", "Painel", "/"],
  ["table", "Transações", "/transacoes"],
  ["inbox", "Revisar", "/revisar"],
  ["calendar", "Contas a pagar", "/contas"],
  ["card", "Cartões", "/cartoes"],
  ["target", "Orçamentos e metas", "/orcamentos"],
  ["refresh", "Assinaturas", "/assinaturas"],
  ["scale", "Patrimônio", "/patrimonio"],
  ["file", "Relatórios", "/relatorios"],
  ["search", "Perguntar", "/perguntar"],
  ["link", "Conexões", "/conexoes"],
  ["settings", "Ajustes", "/ajustes"],
] as const;

/** No celular a barra de abas mostra só estas; o resto fica em "Mais". */
export const MOBILE = ["/", "/transacoes", "/revisar", "/contas"];
/** Rótulos curtos para a barra de abas do celular. */
export const SHORT: Record<string, string> = { "/contas": "Contas" };
