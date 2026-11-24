import { LogoMark } from "@/components/brand";

/** Esqueleto mostrado na hora ao trocar de seção, enquanto o servidor prepara a tela. */
export default function Loading() {
  return (
    <>
      <header className="top" aria-hidden="true">
        <span className="top-logo"><LogoMark size={22} /></span>
        <span className="sk sk-title" />
      </header>
      <div className="content" role="status" aria-label="Carregando">
        <span className="sr-only">Carregando…</span>
        <div className="bento" aria-hidden="true">
          <div className="card kpi s3"><span className="sk sk-line" style={{ width: "50%" }} /><span className="sk sk-big" /></div>
          <div className="card kpi s3"><span className="sk sk-line" style={{ width: "60%" }} /><span className="sk sk-big" /></div>
          <div className="card kpi s3"><span className="sk sk-line" style={{ width: "45%" }} /><span className="sk sk-big" /></div>
          <div className="card kpi s3"><span className="sk sk-line" style={{ width: "55%" }} /><span className="sk sk-big" /></div>
          <div className="card s8"><span className="sk sk-line" style={{ width: "30%" }} /><span className="sk sk-block" /></div>
          <div className="card s4"><span className="sk sk-line" style={{ width: "40%" }} /><span className="sk sk-block" /></div>
        </div>
      </div>
    </>
  );
}
