# Commit Streak

App de menu bar (macOS) que varre seus repositórios git locais e te lembra de
commitar antes do dia acabar.

## v1

- Scanner: descobre repos em `~/Documents/Github` (configurável), lê
  `git log --all --no-merges` por autor, dedupe global por hash.
- Cache incremental em `~/Library/Application Support/commit-streak/`.
- Tray de menu bar com três estados (●/○/⊙) + streak no título.
- Notificações escalonadas (19h / 21h30 / 23h) — nenhuma dispara se você já
  commitou hoje.
- Popover com streak atual, maior streak e os commits de hoje.

## v2

- Janela completa (menu da tray → "Abrir janela completa", ou link no popover).
- KPI row: streak atual, maior streak, dias c/ commit (365), cobertura, dias
  perdidos no mês.
- Heatmap de 53 semanas com a rampa validada pela skill de dataviz, célula
  zero com anel, tooltip no hover, navegação por setas.
- Toggle de tabela (mesmos dados, acessível) e de tema (sistema/claro/escuro).

## v3

- **Detecção de trabalho pendente** (`main/pending.js`): dirty worktree,
  commits à frente do upstream, stash — por repo.
- **Painel de lacunas**: dias vazios agrupados por quebra de streak, mais
  recente primeiro, com o trabalho pendente que plausivelmente explica cada
  lacuna (data do commit/dirty/stash caindo dentro do intervalo).
- Ações por lacuna: **abrir no editor** (VS Code, com fallback pro Finder) e
  **marcar como folga** — nunca um botão que forja `GIT_AUTHOR_DATE`.
- Popover mostra a mesma lista de pendências quando hoje ainda está vazio.
- Lista de repositórios com toggle de "contabilizar" (persiste em
  `config.ignoredDirRepos`, dispara rescan).

## v4 (este estado, parcial)

- **Meta semanal** em vez de corrente diária — ver [Meta semanal](#meta-semanal).
- **Relatório semanal** na janela completa: uma linha por semana (segunda→domingo,
  mais recente primeiro) com dias com commit, total de commits, repos e — se houver
  meta — se ela bateu. Em cima, o resumo: média de dias por semana, melhor semana,
  quantas bateram a meta e a tendência das últimas 4 semanas fechadas contra as 4
  anteriores. A janela (4, 8, 12, 26 ou 52 semanas) fica no seletor da própria
  seção e é guardada em `config.reportWeeks`.

  Semana em andamento aparece marcada e **nunca** conta como meta perdida nem
  entra na média — só semanas fechadas. Dia de folga sai do denominador, então a
  coluna lê "2 de 5", não "2 de 7".

Ainda não tem: integração com GitHub (v4).

## Rodar em dev

```bash
npm install
npm start
```

## Testes

```bash
npm test
```

`node --test` embutido, sem dependência nova — o repo não tem build step e os
testes também não precisam de um. São 64, em `test/`:

- `scanner.test.js` — a lógica pura: virada do dia às 4h, dedupe por hash,
  streak com folga no meio, lacunas agrupadas, KPIs, meta semanal, estados das
  células do heatmap.
- `weekly-report.test.js` — as regras do relatório: semana incompleta fora da
  média e nunca marcada como meta perdida, folga saindo do denominador,
  tendência só com 8 semanas fechadas.
- `store.test.js` — a poda das flags de notificação: o que sai, o que fica na
  borda exata da janela, e que ela não encosta no resto do `data.json`.
- `scanner.git.test.js` — descoberta de repos e leitura do `git log` contra
  repositórios de verdade criados num diretório temporário (com
  `GIT_AUTHOR_DATE` fixo, pra não depender de que horas são agora). Sem mock de
  `execFile`: o que pode quebrar aqui é o contrato com o git.

O que os testes cobrem são **decisões de produto**, não detalhes de
implementação. Se um deles quebrar, a pergunta certa é "eu mudei de ideia sobre
isso?", não "como faço o teste passar?".

## Empacotar

```bash
npm run dist
```

Gera `dist/Commit Streak-<versão>-arm64.dmg` e o `.app` em `dist/mac-arm64/`.
Configuração no campo `build` do [package.json](./package.json), a mesma receita
do `claude-statusbar` e do `cambio-ai`:

- **`LSUIElement: 1`** — app de barra de menu desde o lançamento, sem ícone no
  dock. É o que faltava pro `showDockIcon: false` não ser a única linha de
  defesa.
- **Ícone gerado por script** ([`scripts/make-app-icon.js`](./scripts/make-app-icon.js)):
  um pedaço 3×3 do próprio heatmap, com a mesma rampa azul da grade e **uma
  célula vazia com anel** — o detalhe que define o app, já que aqui o assunto é
  a ausência e não só o que foi feito.
- **Não é assinado**: sem Developer ID, o `.app` fica com a assinatura ad-hoc do
  binário do Electron. Primeira abertura vinda do `.dmg` por botão direito ›
  Abrir, ou `xattr -dr com.apple.quarantine "/Applications/Commit Streak.app"`.

Empacotado, o app passa a se ver como qualquer outro repo da máquina: o
`config.json` continua em `~/Library/Application Support/commit-streak/`.

## Configuração

Na primeira execução, `~/Library/Application Support/commit-streak/config.json`
é criado com valores default (autor detectado do `git config` global, raiz
`~/Documents/Github`, dia lógico começando às 4h). Edite o arquivo e reinicie
o app pra aplicar.

### Meta semanal

`"weeklyGoal": 4` troca a corrente diária por "4 dias por semana" — pra muita
gente é meta mais saudável que streak ininterrupto. Com `0` (o default) nada
muda: o app segue sendo só o streak.

Com meta configurada:

- o popover ganha uma linha (`Meta da semana: 3 de 4 dias`) e a janela completa,
  um tile a mais;
- a semana começa na **segunda**, como as linhas do heatmap;
- **dia de folga não conta como oportunidade** — se faltam 2 dias e 1 é folga, o
  app já diz que a meta está em risco, em vez de cobrar um dia que você marcou
  como livre;
- **meta batida cala os lembretes do resto da semana.** O ícone continua
  dizendo a verdade sobre hoje (`○`, não commitei), mas as notificações param:
  quem escolheu quatro dias por semana não quer ser cobrado no quinto.
