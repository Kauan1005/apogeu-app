# Testes do Apogeu

Rodam com um **usuário de teste** (nunca com a sua conta). Cada rodada usa nomes únicos e apaga o que criou.

## Preparar (uma vez)

Crie `.env.test.local` (já ignorado pelo git) com:

```
TEST_EMAIL=teste@fluxo.test
TEST_PASSWORD=...
TEST_TOTP_SECRET=...        # segredo base32 do 2FA do usuário de teste
```

Os testes de clique precisam do Edge ou do Chrome instalados (ou `PW_BROWSER=caminho/do/navegador`).

## Rodar

```
npm run dev          # em outro terminal
npm test             # API + páginas + cliques (site local)
npm run test:api     # só API e páginas
npm run test:ui      # só os cliques
npm run test:fase3   # patrimônio, PDF do IR, convite do modo casal e backups (usa a chave secreta para limpar)
npm run test:cadastro # criar conta com código de convite e conta Meu Pluggy própria
npm run test:extras  # bloqueio por inatividade, ícones, celular sem rolagem lateral, acessibilidade (axe)
npm run test:security # RLS, CSP, webhooks, 2FA recente
npm run test:novidades # novidades do dia a dia: cofrinhos, regras, refugos, metas, push, backup externo
npm run test:mfa     # hábitos e 2FA opcional (liga e desliga, com o banco obedecendo)
npm run test:aparencia # Painel resumo, mini-gráficos, tema claro, transição entre telas
npm run test:aporte  # aporte sugerido quando o salário cai
npm run test:extrato # importar extrato OFX e CSV
npm run test:offline # abrir sem internet
npm run test:novos   # logos dos bancos, Revisar deslizando, filtros salvos, Perguntar por voz
node --env-file=.env.local --env-file=.env.test.local tests/create-test-user.mjs   # cria o usuário de teste
node --env-file=.env.local --env-file=.env.test.local tests/delete-test-user.mjs   # APAGA o usuário de teste (faça sempre depois)
```

O simulador de Pix só existe fora de produção, por isso `npm test` roda contra o site local.

> Rode as suítes **uma de cada vez** (elas compartilham o usuário de teste). Depois de mexer em `next.config.ts`, reinicie o `npm run dev`.
> Para testar o site publicado: `