import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { LegalPage } from "@/components/legal-page";
import { controller, UPDATED_AT } from "@/lib/legal";

export const metadata: Metadata = { title: "Termos de uso" };

export default async function Termos() {
  await connection();
  const c = controller();
  return (
    <LegalPage title="Termos de uso" updated={UPDATED_AT}>
      <p>Estes termos valem para quem usa o Apogeu. Ao criar a conta ou aceitar um convite, você concorda com eles e com a <Link className="link" href="/privacidade">política de privacidade</Link>.</p>

      <h2>O que é o Apogeu</h2>
      <p>Um organizador de finanças pessoais, gratuito, mantido por {c.name}. O acesso é só por convite e pode ser encerrado a qualquer momento, com aviso para você exportar os seus dados antes.</p>

      <h2>O que o Apogeu não é</h2>
      <ul>
        <li>Não é banco nem instituição financeira, e não movimenta dinheiro: pagamentos acontecem sempre no app do seu banco.</li>
        <li>Não dá recomendação de investimento nem consultoria financeira.</li>
        <li>O resumo para o Imposto de Renda é uma ajuda para organizar informações. Ele não substitui os informes oficiais dos bancos e empregadores, um contador ou as orientações da Receita Federal. Confira cada valor antes de declarar.</li>
        <li>As categorias automáticas podem errar; revise o que for importante.</li>
      </ul>

      <h2>Suas responsabilidades</h2>
      <ul>
        <li>Ter 18 anos ou mais.</li>
        <li>Manter a senha e o app autenticador (2FA) só com você.</li>
        <li>Conectar apenas contas das quais você é titular ou que tem autorização para acessar.</li>
        <li>Se usar a sua própria conta Meu Pluggy, cuidar das credenciais dela e seguir os termos da Pluggy.</li>
        <li>No modo casal, convidar só pessoas de confiança: elas veem e alteram as mesmas finanças.</li>
      </ul>

      <h2>Disponibilidade</h2>
      <p>O Apogeu é oferecido como está, sem garantia de funcionamento contínuo. Os dados dependem dos bancos e da Pluggy e podem chegar com atraso ou falhar. Mantemos backups semanais, mas recomendamos baixar uma cópia de tempos em tempos.</p>

      <h2>Encerramento</h2>
      <p>Você pode excluir a conta quando quiser, em Ajustes. Se o acesso for encerrado por nós, avisamos antes para que você possa exportar tudo.</p>

      <h2>Contato</h2>
      <p>{c.email ? <>Dúvidas: <a className="link" href={`mailto:${c.email}`}>{c.email}</a>.</> : "Dúvidas: fale com quem convidou você."}</p>
    </LegalPage>
  );
}
