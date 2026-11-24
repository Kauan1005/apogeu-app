import "server-only";

// Identificação do controlador e canal de contato (LGPD art. 9º e Res. CD/ANPD nº 2/2022, art. 11 §1º).
// Configure FLUXO_CONTROLLER_NAME e FLUXO_CONTACT_EMAIL no ambiente; nada de CPF ou endereço na página.
export const TERMS_VERSION = "2026-11-18";
export const UPDATED_AT = "18 de novembro de 2026";

export function controller() {
  const name = process.env.FLUXO_CONTROLLER_NAME?.trim() || "o administrador do Apogeu (pessoa física)";
  const email = process.env.FLUXO_CONTACT_EMAIL?.trim() || "";
  return { name, email, configured: !!process.env.FLUXO_CONTACT_EMAIL };
}
