import type { Metadata } from "next";
import Link from "next/link";
import { statSync } from "node:fs";
import { join } from "node:path";
import { Brand } from "@/components/brand";
import { InstallGuide } from "./install-client";

export const metadata: Metadata = { title: "Instalar o app" };

export default function Instalar() {
  let size = "1 MB";
  try { size = `${(statSync(join(process.cwd(), "public", "apogeu.apk")).size / 1048576).toFixed(1).replace(".", ",")} MB`; } catch { /* sem o arquivo no build */ }
  return (
    <main className="legal">
      <div className="row-flex"><Link className="brand" href="/" style={{ padding: 0 }}><Brand /></Link><span className="sp" /><Link className="link t-sm" href="/">Voltar ao Apogeu</Link></div>
      <h1>Instalar o app</h1>
      <p className="muted t-sm">Grátis, no Android e no iPhone.</p>
      <InstallGuide apkSize={size} />
    </main>
  );
}
