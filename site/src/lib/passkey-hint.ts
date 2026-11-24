/**
 * Pula a lista "escolha uma chave de acesso" do Android: guarda, neste aparelho, o identificador da credencial
 * (não é segredo, só diz ao aparelho QUAL chave usar) e o repassa ao pedir a biometria. Sem ele (primeiro uso, outro
 * aparelho) o seletor normal aparece e o identificador é guardado para as próximas vezes.
 */
const KEY = "apogeu-passkey-cred";

const toB64u = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)).buffer;

const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v: string | null) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* sem armazenamento */ } };

export const forgetPasskeyHint = () => write(null);

/** Executa `fn` (cadastro ou entrada por passkey) com o identificador da credencial sendo guardado e repassado. */
export async function withPasskeyHint<T>(fn: () => Promise<T>): Promise<T> {
  const creds = typeof navigator !== "undefined" ? navigator.credentials : undefined;
  if (!creds) return fn();
  const get = creds.get.bind(creds);
  const create = creds.create.bind(creds);
  creds.get = async (o?: CredentialRequestOptions) => {
    const pk = o?.publicKey;
    const id = read();
    const hinted = !!(pk && id && !pk.allowCredentials?.length);
    if (hinted) pk!.allowCredentials = [{ type: "public-key", id: fromB64u(id!), transports: ["internal", "hybrid"] }];
    try {
      const r = await get(o);
      if (r && "rawId" in r) write(toB64u((r as PublicKeyCredential).rawId));
      return r;
    } catch (e) {
      if (hinted) write(null); // credencial removida ou de outra conta: da próxima vez, o seletor normal
      throw e;
    }
  };
  creds.create = async (o?: CredentialCreationOptions) => {
    const r = await create(o);
    if (r && "rawId" in r) write(toB64u((r as PublicKeyCredential).rawId));
    return r;
  };
  try { return await fn(); } finally { delete (creds as { get?: unknown }).get; delete (creds as { create?: unknown }).create; }
}
