import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { Icon } from "@/components/ui";
import { MOBILE, NAV } from "@/components/nav";
import { SignOut } from "@/components/shell";

// Menu completo para o celular (a barra de abas mostra só as 4 seções principais).
export default function Mais() {
  return (
    <>
      <Topbar title="Mais" />
      <div className="content page-in">
        <div className="card">
          <div className="list">
            {NAV.filter(([, , href]) => !MOBILE.includes(href)).map(([icon, label, href]) => (
              <Link key={href} href={href} className="row" style={{ gridTemplateColumns: "36px 1fr auto", textDecoration: "none", minHeight: 52 }}>
                <span className="ico-box"><Icon name={icon} /></span><span>{label}</span><Icon name="chevright" size="sm" />
              </Link>
            ))}
            <Link href="/instalar" className="row install-link" style={{ gridTemplateColumns: "36px 1fr auto", textDecoration: "none", minHeight: 52 }}>
              <span className="ico-box"><Icon name="download" /></span><span>Instalar o app</span><Icon name="chevright" size="sm" />
            </Link>
          </div>
        </div>
        <div className="card mais-signout" style={{ marginTop: 12 }}><SignOut /></div>
      </div>
    </>
  );
}
