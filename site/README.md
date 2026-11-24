# Apogeu · código do site

Código da aplicação web do **Apogeu**, um site de finanças pessoais ligado ao **Open Finance**: importa as transações dos bancos, categoriza, projeta o fluxo de caixa e avisa o que vai vencer. É um projeto pessoal, em produção para uso próprio, em planos gratuitos.

> Esta pasta é uma **cópia pública e limpa** do código. Ficam de fora o histórico do git, as variáveis de ambiente, os scripts e as rotinas que operam o site publicado (backup externo, monitor, administração de acessos) e os testes que apontam para ele. As telas do README principal são protótipos com dados fictícios.

## Stack

| Parte | Tecnologia |
|---|---|
| Aplicação | Next.js 16 (App Router), React 19, TypeScript |
| Banco e login | Supabase: PostgreSQL com RLS, Auth com 2FA (TOTP) e passkey |
| Dados bancários | Open Finance via Pluggy (`pluggy-sdk`, `react-pluggy-connect`) |
| Validação | Zod |
| Planilhas e PDF | ExcelJS, pdf-lib |
| Notificações | Web Push |
| Hospedagem | Vercel (com cron), PWA e app Android (TWA, na pasta `android/` do repositório) |

## Como o código está organizado

```
src/
  app/            telas (Painel, Transações, Revisar, Contas a pagar, Cartões, Orçamentos,
                  Patrimônio, Relatórios, Conexões, Ajustes...) e rotas de API
  components/     interface: tabela, gráficos, entrada de valores, atalhos, modo offline
  lib/            regras de negócio, sem depender da tela:
    categorize.ts       categorização: regras e destinatários conhecidos, categoria do banco,
                        semelhança de texto; abaixo de 0,7 de confiança vai para "Revisar"
    ingest.ts           importação das transações, conciliação de contas e de transferências
    statement-import.ts importar extrato OFX e CSV
    pluggy.ts  webhook.ts  integração com o Open Finance e verificação dos avisos
    patrimonio.ts  savings.ts  refunds.ts  ir.ts  ir-pdf.ts   patrimônio, cofrinhos,
                        devoluções e resumo do Imposto de Renda em PDF
    crypto.ts  backup-export.ts   cifra de documentos e backup exportado já cifrado
    cron-auth.ts        autorização das rotinas agendadas
supabase/
  migrations/     25 migrações: esquema, RLS, funções e gatilhos do banco
  functions/      função de embeddings
tests/            14 suítes de ponta a ponta (API, telas, segurança, extrato, offline...)
```

## Decisões que valem destacar

- **A segurança fica no banco.** As tabelas têm RLS por "casa" (household): quem não é membro não lê nem escreve, mesmo chamando a API direto. As migrações incluem endurecimento de segurança, auditoria de ações e proteção contra mudar a própria casa.
- **A senha do banco nunca passa pelo app.** O acesso aos bancos é pelo consentimento oficial do Open Finance.
- **Rotas agendadas e webhooks exigem segredo.** A comparação do token é em tempo constante e, sem o token certo, a resposta é `403`. O simulador de Pix usado nos testes responde `404` em produção.
- **Cadastro controlado.** Só entra quem tem e-mail liberado ou código de convite, e o banco guarda só o hash do código.
- **Login em duas etapas** (TOTP e passkey) e ações sensíveis que pedem o código de novo.
- **Dinheiro sempre em centavos inteiros**, para não ter erro de arredondamento.
- **Categorização que aprende:** o que o sistema não tem certeza vira uma fila de revisão, e a correção sugere uma regra nova.

## Rodar localmente

Precisa de Node 20+, de um projeto Supabase seu e de uma conta Pluggy (o sandbox serve).

```bash
cd site
npm install
cp .env.example .env.local     # preencha com as suas chaves (nunca com as de produção)
npx supabase link --project-ref SEU_PROJETO
npx supabase db push           # aplica as migrações no seu projeto
npm run dev                    # http://localhost:3000
```

As variáveis esperadas estão em [`.env.example`](.env.example), só com os nomes. Os testes (`npm test`) usam um usuário de teste que o próprio `tests/create-test-user.mjs` cria no seu projeto e o `tests/delete-test-user.mjs` apaga depois; veja [`tests/README.md`](tests/README.md).

## O que não está aqui

- Nenhuma chave, segredo, `.env` ou dado pessoal. As chaves ficam só no servidor.
- O histórico de commits, os scripts e as rotinas que operam o site publicado.
- O APK assinado do app Android e a configuração de assinatura.
