import type { Metadata } from "next";
import { connection } from "next/server";
import { LegalPage } from "@/components/legal-page";
import { controller, UPDATED_AT } from "@/lib/legal";

export const metadata: Metadata = { title: "Política de privacidade" };

export default async function Privacidade() {
  await connection();
  const c = controller();
  const contact = c.email ? <a className="link" href={`mailto:${c.email}`}>{c.email}</a> : "o e-mail informado por quem convidou você";
  return (
    <LegalPage title="Política de privacidade" updated={UPDATED_AT}>
      <p>O Apogeu organiza as suas finanças a partir dos dados que você autoriza o seu banco a compartilhar pelo Open Finance. Esta página explica, em linguagem simples, o que é tratado, para quê, onde fica e como você controla tudo. Ela segue a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).</p>

      <h2>Quem cuida dos seus dados</h2>
      <p>O controlador é {c.name}. Para qualquer pedido sobre os seus dados, fale por {contact}. Respondemos em até 15 dias.</p>

      <h2>Quais dados</h2>
      <ul>
        <li><b>Conta:</b> e-mail, senha (guardada só como hash pelo Supabase Auth) e o fator de 2FA.</li>
        <li><b>Financeiros, vindos do seu banco pela Pluggy:</b> contas, saldos, transações, cartões, faturas, investimentos e empréstimos. Nunca pedimos nem guardamos a senha do banco.</li>
        <li><b>Que você cadastra:</b> categorias, regras, anotações, tags, comprovantes, contas fixas, metas, orçamentos, bens e dívidas.</li>
        <li><b>De outras pessoas que aparecem nas transações:</b> nome e CPF/CNPJ de quem pagou ou recebeu. O documento fica mascarado na tela e cifrado (AES-256) no banco de dados; só aparece completo no relatório do IR que você mesmo baixa.</li>
        <li><b>Segurança:</b> registro de atividade (quem alterou o quê e quando) e os registros técnicos dos provedores.</li>
      </ul>

      <h2>Para que e com qual base legal</h2>
      <ul>
        <li>Prestar o serviço que você pediu: importar, categorizar e mostrar as suas finanças (execução de contrato, art. 7º, V).</li>
        <li>Proteger a sua conta, prevenir fraudes e manter o registro de atividade (legítimo interesse, art. 7º, IX).</li>
        <li>A conexão com cada banco depende do consentimento que você dá no próprio banco, pelo Open Finance, e pode ser revogado a qualquer momento.</li>
      </ul>
      <p>Não vendemos, não alugamos e não usamos os seus dados para publicidade. Não há rastreadores nem análise de comportamento. A categorização automática roda dentro do próprio banco de dados, sem enviar nada a serviços de IA de terceiros.</p>

      <h2>Com quem os dados são compartilhados</h2>
      <ul>
        <li><b>Pluggy</b> (Brasil): recebe a sua autorização do Open Finance e entrega os dados do banco. Tem política própria.</li>
        <li><b>Supabase</b> (banco de dados e login): servidores nos Estados Unidos (Virgínia).</li>
        <li><b>Vercel</b> (hospedagem do site): servidores nos Estados Unidos.</li>
        <li>No <b>modo casal</b>, as pessoas que o dono da conta convidar veem as mesmas finanças.</li>
      </ul>
      <p>Por isso há transferência internacional de dados (LGPD art. 33), feita com provedores que adotam cláusulas contratuais de proteção de dados e criptografia em trânsito e em repouso.</p>

      <h2>Por quanto tempo</h2>
      <ul>
        <li>Enquanto a sua conta existir. Você apaga quando quiser.</li>
        <li>Transações na lixeira: 30 dias, depois são apagadas de vez.</li>
        <li>Backups: até 8 cópias semanais. Algo apagado pode continuar em um backup por até cerca de 8 semanas.</li>
        <li>Registro de atividade: 12 meses.</li>
        <li>Ao excluir a conta, apagamos na hora dados, comprovantes, backups e registro de atividade, e revogamos as conexões com os bancos. Os provedores podem manter registros técnicos (como IP e horário) pelos prazos deles, e a Pluggy pode guardar dados conforme a política dela.</li>
      </ul>

      <h2>Seus direitos e como exercê-los</h2>
      <ul>
        <li><b>Ver e levar os dados:</b> Ajustes → Privacidade e dados → Baixar meus dados (JSON).</li>
        <li><b>Corrigir:</b> direto nas telas do Apogeu.</li>
        <li><b>Revogar o acesso a um banco:</b> Ajustes ou Conexões → Desconectar.</li>
        <li><b>Excluir tudo:</b> Ajustes → Excluir minha conta.</li>
        <li>Para os demais direitos do art. 18 da LGPD, ou para reclamar à ANPD, fale pelo contato acima.</li>
      </ul>

      <h2>Segurança</h2>
      <p>Login com senha e 2FA obrigatório; 2FA de novo para ações sensíveis; regras de acesso por casa no próprio banco de dados; criptografia dos documentos de terceiros; segredos só no servidor. Se acontecer um incidente que possa trazer risco ou dano relevante, avisamos você e a ANPD nos prazos da lei. Encontrou uma falha? Veja <a className="link" href="/.well-known/security.txt">/.well-known/security.txt</a>.</p>

      <h2>Cookies</h2>
      <p>Usamos só os cookies necessários para manter você conectado com segurança. Não há cookies de publicidade nem de análise, por isso não mostramos aviso de cookies. A preferência do modo privacidade fica só no seu navegador.</p>

      <h2>Menores de idade</h2>
      <p>O Apogeu é para maiores de 18 anos.</p>

      <h2>Mudanças</h2>
      <p>Se esta política mudar de forma relevante, avisamos dentro do Apogeu antes de valer.</p>
    </LegalPage>
  );
}
