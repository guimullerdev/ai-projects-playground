# Commit Streak

App de menu bar (macOS) que varre seus repositórios git locais e te lembra de
commitar antes do dia acabar. Ver [plan.md](./plan.md) para o raciocínio
completo por trás de cada decisão.

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

## v3 (este estado)

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

Ainda não tem: integração com GitHub (v4), relatório semanal, metas.

## Rodar em dev

```bash
npm install
npm start
```

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
  um pedaço 3×3 do próprio heatmap, com a rampa azul da tabela do
  [plan.md](./plan.md) e **uma célula vazia com anel** — o detalhe que define o
  app, já que aqui o assunto é a ausência e não só o que foi feito.
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
