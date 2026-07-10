# Commit Streak — Plano

## Objetivo

App de menu bar pro macOS que lê os **meus commits locais**, me lembra de commitar antes do dia acabar, e mostra num calendário quais dias ficaram vazios — junto com o que dá pra fazer a respeito.

Fica em `apps/` (não em `pocs/`) porque a ideia é deixar rodando todo dia, no login, indefinidamente. Um POC de heatmap eu olho uma vez; isso aqui só funciona se estiver ligado em segundo plano por meses.

## Por que existe

O problema não é falta de trabalho — é trabalho que fica no working tree. Termino de mexer em algo às 23h, não commito, e o dia some. Uma semana depois eu não faço ideia de quais dias foram vazios de verdade e quais foram "tinha código pronto, faltou `git commit`".

Duas funções, então:

1. **Antes**: cutucar enquanto ainda dá tempo (o lembrete só vale se chegar às 19h, não no dia seguinte).
2. **Depois**: mostrar as lacunas com contexto suficiente pra eu saber se aquele dia vazio ainda tem conserto.

## Stack: Electron, e por quê

HTML+CSS+JS estático no navegador **não resolve**, e vale explicitar por que antes de alguém (eu, daqui a três meses) sugerir "podia ser só uma página":

| Preciso de | Página no navegador | Electron |
|---|---|---|
| Ler `.git` das pastas locais | impossível (sandbox) | `child_process` + `git log` |
| Notificação nativa do macOS | só com a aba aberta e permissão | `Notification` do sistema |
| Rodar em segundo plano sempre | não | menu bar, sem janela |
| Abrir no login | não | `app.setLoginItemSettings` |

A alternativa sem Electron seria a API do GitHub — mas ela só enxerga o que foi **pushado pro GitHub**. Commit local não pushado, repo de trabalho em outro remote, repo que só existe na máquina: tudo invisível. E é justamente o commit local não pushado que o app precisa ver pra dizer "seu dia não está vazio, você só não pushou".

**Decisão: Electron, app de menu bar, sem janela principal no dock.** O renderer continua sendo HTML + CSS + JS puro, sem framework nem build step — mesmo padrão do resto do repo. O Electron entra pelo acesso ao sistema, não por complexidade de UI.

## De onde vêm os dados

### Descoberta de repositórios

Config guarda uma lista de pastas raiz (default: `~/Documents/Github`). O scanner varre cada uma até `maxdepth 3` procurando `.git`, pulando `node_modules`, `vendor`, `.build` e uma lista de ignorados. Repos encontrados entram numa lista visível na UI, cada um com um toggle — repo de trabalho que eu não quero contabilizar fica desligado sem sair da lista.

### Leitura dos commits

Por repo:

```bash
git -C <repo> log --all --no-merges \
  --author="gui.muller13@gmail.com" --author="<outro email>" \
  --since="13 months ago" --date=short \
  --pretty=format:'%H%x09%ad%x09%s'
```

Detalhes que importam:

- **`--all`**: commit em branch de feature conta igual. Sem isso, quem trabalha em branch e só mergeia na sexta aparece com a semana vazia.
- **`--author` repetido**: OR entre identidades. Uso e-mail pessoal e e-mail de trabalho; sem os dois a metade do gráfico some.
- **`--date=short` (author date)**: a data em que **eu** escrevi, no fuso em que eu estava. Committer date muda em rebase e amend — o gráfico ficaria se reescrevendo sozinho. Author date sobrevive a rebase.
- **Dedupe por hash, global** (não por repo): o mesmo commit aparece em clones diferentes e em worktrees. Sem dedupe, um repo clonado duas vezes dobra o dia.
- **`--no-merges`**: merge commit é contabilidade, não trabalho. Configurável, mas default desligado.

O resultado vira um único mapa `{ "2026-09-13": [{ repo, hash, msg }, ...] }`. Toda a UI lê desse mapa.

### O "dia" não termina à meia-noite

Commit às 01:30 de terça, depois de virar a noite na segunda, **pertence à segunda** na minha cabeça. Então existe um `dayStartHour` configurável (default `04:00`): qualquer commit antes dessa hora é contado no dia anterior. Sem isso, quem trabalha tarde quebra streak dormindo.

### Dias de folga

Config de `restDays` (default: nenhum). Dia marcado como folga **não quebra o streak** e **não gera notificação** — aparece no calendário com um tratamento próprio (célula neutra, hachurada). Se não existir essa válvula, o app vira máquina de culpa no domingo e eu desinstalo na segunda semana.

## Alertas

### Quando dispara

Escala ao longo do dia, tudo configurável:

| Horário | Tom | Texto |
|---|---|---|
| 13:00 | silencioso (só muda o ícone) | — |
| 19:00 | normal | "Nenhum commit hoje ainda. Streak de 12 dias em jogo." |
| 21:30 | normal | "Faltam 2h30. Você tem mudanças não commitadas em `ai-projects-playground`." |
| 23:00 | urgente | "Última chamada — 1h pra manter o streak de 12 dias." |

### Regras que evitam virar spam

- **Commitou hoje → nenhuma notificação**, o dia inteiro. Essa é a regra que faz o app ser tolerável.
- Cada horário dispara **no máximo uma vez por dia**, com flag persistida em disco (não em memória — o app reinicia).
- Botão de **soneca de 1h** direto na notificação.
- O agendador é um **tick de 60s comparando com o relógio de parede**, não `setTimeout` pro horário exato. Motivo: MacBook fecha, dorme, e `setTimeout` de 6 horas não é confiável. Junto com isso, `powerMonitor.on('resume')` força uma reavaliação ao acordar.
- Do Not Disturb do macOS o sistema já respeita sozinho — não tento contornar.

### Ícone no menu bar

Três estados, distinguidos por **forma**, não por cor: o macOS renderiza template images em monocromático, então ícone colorido não é opção confiável.

- ● cheio — commitei hoje
- ○ vazado — ainda não, e o dia está andando
- ○ com ponto — passou das 21h sem commit

Ao lado, o número do streak como título do tray. Clicar abre o popover.

## Telas

### 1. Popover (clique no tray) — 380×520

O que dá pra responder em dois segundos:

- **Figura hero**: "Commitei hoje" / "Ainda não" com ícone + rótulo (nunca cor sozinha).
- Streak atual em número grande.
- Mini-heatmap das últimas 8 semanas.
- Se hoje está vazio: lista curta de **repos com trabalho pendente** — dirty worktree, commits não pushados, stash. Cada linha abre a pasta no editor.
- Link "Abrir janela completa".

### 2. Janela principal

**KPI row** (stat tiles, sem gráfico dentro): streak atual · maior streak · dias com commit nos últimos 365 · % de cobertura · dias perdidos no mês.

**Heatmap de 53 semanas** — a peça central. Especificação visual mais abaixo.

**Painel de lacunas** — a parte de "ajeitar isso". Não é só a lista de dias vazios; é a lista **agrupada por quebra de streak**, mais recente primeiro:

```
⚠  3 dias — 2 a 4 de setembro
   ai-projects-playground tem 2 commits não pushados de 3/set
   cambio-ai tem mudanças não commitadas desde 2/set
   → [abrir no editor]  [marcar como folga]
```

Duas saídas legítimas pra uma lacuna: ou **o trabalho existe e nunca foi registrado** (commita/pusha agora — o author date do commit antigo até reaparece no gráfico, se era um commit local esquecido), ou **o dia foi de folga mesmo** e eu marco como tal. As duas são honestas.

**Não vai existir** botão de "preencher o dia" forjando `GIT_AUTHOR_DATE`. Um gráfico que mente não serve pra nada — o app inteiro existe pra me dar esse sinal.

**Lista de repos**: nome, nº de commits no período, último commit, toggle de contabilizar.

## Design do heatmap

Feito com a skill de dataviz do repo. O trabalho aqui é magnitude numa grade → **heatmap com escala sequencial de um tom só**, nunca arco-íris, nunca cor categórica.

### Rampa (validada com `validate_palette.js --ordinal`, os dois modos passaram)

| Commits no dia | Claro | Escuro |
|---|---|---|
| 0 | superfície `#fcfcfb` + anel `#e1e0d9` | superfície `#1a1a19` + anel `#2c2c2a` |
| 1–2 | `#86b6ef` | `#184f95` |
| 3–5 | `#3987e5` | `#256abf` |
| 6–9 | `#1c5cab` | `#3987e5` |
| 10+ | `#0d366b` | `#6da7ec` |

No claro a rampa vai clara→escura; no escuro ela **inverte** (mais commits = mais claro), porque é o afastamento da superfície que carrega a magnitude. Dark mode é escolhido passo a passo, não é inversão automática do claro.

### O detalhe que muda tudo: o dia zero tem forma

No GitHub o dia sem commit é uma célula quase invisível — faz sentido lá, onde o assunto é o que você fez. Aqui **o assunto é a ausência**, então a célula zero ganha um **anel hairline de 1px**: ela existe, tem contorno, é contável a olho. Dia anterior ao primeiro commit do repo e dia futuro não recebem anel (não são lacuna, são fora de escala). Dia de folga recebe hachura neutra.

### Marcas e anatomia

- Célula 11px, raio 2px, **gap de 2px na cor da superfície** entre células.
- 7 linhas seg→dom; rótulo só em seg/qua/sex. Meses rotulados acima, um a cada mudança de mês.
- Hover: tooltip com data, total do dia e quebra por repo. Alvo de hover maior que a célula.
- Legenda "Menos → Mais" com os 4 passos **mais** a célula zero explicada — ela é um estado, não o degrau mais claro da rampa.
- Grade navegável por teclado (setas) e um **toggle de tabela** com os mesmos dados, pra leitor de tela e pra quando o olho não resolve.

### Status de hoje

O estado de hoje (commitei / ainda não / passou da hora) usa a **paleta de status**, que é reservada pra estado e nunca vira "série 4": `#0ca30c` bom, `#fab219` atenção, `#d03b3b` crítico — sempre com ícone + rótulo junto, nunca a cor sozinha.

### Temas

Variáveis CSS no `:root`, valores de dark redeclarados sob `@media (prefers-color-scheme: dark)` **e** sob `[data-theme="dark"]`, pra um toggle manual vencer nos dois sentidos. Nenhuma cor definida só dentro do bloco dark.

## Estrutura de arquivos (proposta)

```
apps/commit-streak/
├── plan.md              # este arquivo
├── README.md            # como rodar e empacotar
├── package.json
├── main/
│   ├── main.js          # ciclo de vida, tray, popover, janela
│   ├── scanner.js       # descoberta de repos + git log + dedupe
│   ├── pending.js       # dirty worktree / não pushado / stash
│   ├── scheduler.js     # tick de 60s, flags do dia, soneca, resume
│   ├── store.js         # config + cache em userData/data.json
│   └── preload.js       # contextBridge, API estreita
└── renderer/
    ├── popover.html
    ├── index.html       # janela completa
    ├── style.css        # design tokens + tema claro/escuro
    └── js/
        ├── heatmap.js   # grade, rampa, tooltip, tabela alternativa
        ├── stats.js     # streak, cobertura, lacunas
        └── gaps.js      # painel de lacunas + ações
```

## Cache e performance

`git log` em 30 repos na primeira execução leva segundos. Então:

- Cache por repo em `userData/data.json`: `{ repo, lastScan, commits: [...] }`.
- Rescan **incremental**: `--since=<lastScan menos 2 dias>` (a folga de 2 dias captura amend e rebase recente), resultado mesclado por hash.
- Scan completo só no primeiro uso, semanalmente, ou sob demanda no botão.
- Repos varridos em paralelo com limite de concorrência (4) — não adianta abrir 30 processos `git`.
- A UI nunca espera o scan: renderiza do cache e atualiza quando chega.

## Privacidade

Tudo local. **Nenhuma requisição de rede no v1** — nem telemetria, nem update check. Os dados que o app lê (nomes de repo, mensagens de commit, caminhos) não saem da máquina, e o cache é um JSON em `~/Library/Application Support/`. Isso é o que torna aceitável apontar o app pra repos de trabalho.

No renderer: `contextIsolation: true`, `nodeIntegration: false`, preload expondo uma API estreita. Mensagem de commit vai pra tela como texto, nunca como HTML.

## Empacotamento

- `electron-builder` gerando `.dmg` arm64.
- `LSUIElement: true` no Info.plist + `app.dock.hide()` — app de menu bar não aparece no dock nem no cmd+tab.
- App **não assinado** (é uso pessoal): na primeira abertura o Gatekeeper reclama e é preciso clicar com o botão direito → Abrir. Documentar isso no README, porque eu vou esquecer.
- Notificação em dev aparece como "Electron"; só com o app empacotado ela mostra o nome certo. Não é bug.
- "Abrir no login" via `app.setLoginItemSettings({ openAtLogin: true })`, com toggle nas preferências.

## Fases

**v1 — o loop mínimo que já muda o comportamento**
Scanner + cache + tray com os três estados + notificações escalonadas + popover com estado de hoje e streak. Sem janela completa, sem heatmap. Se essa parte não me faz commitar mais, o resto não vale a pena.

**v2 — o retrovisor**
Janela completa: heatmap de 53 semanas, KPI row, tabela alternativa, temas. É aqui que entra a pergunta "quais dias eu perdi".

**v3 — ajeitar as lacunas**
Detecção de trabalho pendente (dirty / não pushado / stash), painel de lacunas agrupadas por quebra de streak, ação de abrir no editor, marcar dia como folga.

**v4 — se fizer falta**
Integração opcional com a API do GitHub, pra pegar commit feito em outra máquina ou pela web (mesclando com o dado local pelo hash). Relatório semanal. Metas ("4 dias por semana" em vez de streak diário) — que pra muita gente é meta mais saudável que corrente ininterrupta.

## Decisões em aberto

- **Nome** — "Commit Streak" é literal demais e a pasta é fácil de renomear enquanto não tem código.
- **Streak = dias com ≥1 commit.** Parece certo, mas considerar um piso mínimo (ex.: ≥1 commit não-trivial) se eu começar a fazer commit de uma linha só pra manter a corrente. O app não deve premiar isso.
- **Meta semanal vs streak diário** — streak é mais viciante, meta semanal é mais honesta com fim de semana e férias. Talvez os dois, com um seletor.
- **Repos de trabalho contam?** Tecnicamente sim (é código que eu escrevi), mas mistura duas coisas diferentes. Um filtro "pessoal / trabalho / tudo" no heatmap resolveria sem ter que decidir agora.
- **Popover vs janela** — se o popover der conta de 90% do uso, a janela completa pode ficar sendo uma página só, chamada pelo menu do tray.
