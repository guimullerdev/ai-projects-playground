# Claude Statusbar — Plano

## Objetivo
App de barra de menu do macOS que mostra, sempre visível, **quanto do limite da assinatura Claude já foi consumido** (janela de 5h e semanal), **quanto falta pro reset**, e um histórico de consumo por dia / projeto / modelo — unificando o uso do Claude Code na CLI e na aba Code do app desktop.

Fica em `apps/` (não em `pocs/`) porque é pra rodar o dia inteiro, todo dia, junto com o trabalho — mesmo critério do `cambio-ai`.

## Por que existe
O número existe, mas só **dentro** de uma sessão: `/usage` e o statusline do terminal. No app desktop eu não vejo nada — descubro que estourei o limite quando a resposta é recusada, no meio de uma task. É o mesmo problema do `cambio-ai`: o dado está disponível, só não está **onde eu olho**.

Já existe um `~/.claude/statusline-command.sh` meu que lê `rate_limits.five_hour` e desenha uma barra — a informação certa, no lugar errado (só aparece no TUI da CLI, em fullscreen, e some quando eu estou no desktop).

## De onde vêm os dados

Essa é a parte que decide se o app é viável. Levantei na máquina, não é suposição:

### Fonte A — payload do `statusLine` (verdade oficial, tempo real)

O Claude Code chama o comando de statusline passando um JSON no stdin que contém, entre outros:

```
.model.display_name
.effort.level
.context_window.used_percentage
.cost.total_cost_usd
.rate_limits.five_hour.used_percentage   .rate_limits.five_hour.resets_at
.rate_limits.seven_day.used_percentage   .rate_limits.seven_day.resets_at
```

Dois pontos importantes:

- **É percentual de limite real**, não estimativa. É exatamente o que o `/usage` mostra.
- **É por conta, não por ferramenta.** O consumo do chat no app desktop e na web cai na mesma janela, então esse número já reflete tudo — não só o Claude Code.

Limitação: é *push*. O payload só chega enquanto existe uma sessão viva. Confirmei com `grep` que o Claude Code **não persiste** esses valores em lugar nenhum do `~/.claude/` — se ninguém capturar na hora, o dado se perde.

→ **A ponte (o coração do app):** o próprio script de statusline despeja o payload num arquivo. Duas linhas a mais, custo zero, roda tanto na CLI quanto no desktop:

```sh
# em ~/.claude/statusline-command.sh, logo depois de: input=$(cat)
mkdir -p "$HOME/.claude/statusbar"
printf '%s' "$input" | jq --arg at "$(date -u +%FT%TZ)" '. + {captured_at:$at}' \
  > "$HOME/.claude/statusbar/latest.json.tmp" 2>/dev/null \
  && mv "$HOME/.claude/statusbar/latest.json.tmp" "$HOME/.claude/statusbar/latest.json"
```

Escrita atômica (`tmp` + `mv`) porque o app vai estar lendo o arquivo ao mesmo tempo. O app observa com `fs.watch`, sem polling.

Além do snapshot, vale acrescentar uma linha em `~/.claude/statusbar/rate-limits.jsonl` **só quando o percentual muda** (o statusline é chamado a cada poucos centésimos de segundo — gravar sempre encheria o disco de linha repetida). Isso dá a curva de consumo dentro da janela, que é o que permite projetar o burn rate no v3.

### Fonte B — transcripts JSONL (histórico)

`~/.claude/projects/<slug-do-cwd>/<sessionId>.jsonl`, uma linha por evento. As linhas de `assistant` trazem:

```json
{
  "message": {
    "model": "claude-opus-5",
    "id": "msg_011C...",
    "usage": {
      "input_tokens": 2, "output_tokens": 430,
      "cache_creation_input_tokens": 9099, "cache_read_input_tokens": 45884,
      "output_tokens_details": { "thinking_tokens": 142 },
      "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 }
    }
  },
  "requestId": "req_011C...", "timestamp": "2026-09-13T23:56:01.529Z",
  "sessionId": "...", "cwd": "...", "gitBranch": "main",
  "entrypoint": "claude-desktop", "version": "2.1.270"
}
```

Tem tudo que um relatório precisa: modelo, tokens quebrados por tipo, projeto (`cwd`), branch, e `entrypoint` — que separa `claude-desktop` de `cli`.

**A pegadinha, medida aqui:** 18 arquivos, 13 MB, 5.247 linhas, 1.577 com `usage` — e **730 delas (46%) são duplicadas**. Resume, fork de sessão e sidechain recopiam o histórico pra dentro do arquivo novo. Sem deduplicar por `(message.id, requestId)` o total infla quase 2x. Isso não é detalhe de implementação, é a diferença entre o app ser útil ou mentir.

Segunda ressalva: essa fonte dá **tokens**, não percentual de limite. Converter token → dólar exige tabela de preço e continua sendo estimativa (assinatura não cobra por token). O percentual honesto vem só da Fonte A.

### O que eu descartei

- **Ler o token OAuth do Keychain e bater num endpoint de usage não documentado.** Resolveria o problema do dado parado, mas quebra em toda rotação de credencial, e mexer em credencial pra alimentar um widget não paga o risco.
- **Disparar `claude -p` periodicamente só pra forçar um refresh.** Queima exatamente o limite que o app existe pra vigiar.

Consequência aceita: quando não tem sessão rodando, o dado envelhece. O app **mostra isso** ("atualizado há 2h") em vez de fingir que está vivo. É a decisão certa — um número errado aqui é pior que um número ausente.

## v1 — o essencial na barra

- **Título na barra:** `◐ 42%` — percentual da janela de 5h, com cor (verde < 70, amarelo < 90, vermelho ≥ 90). Opção de trocar pra mostrar o tempo até o reset.
- **Popover ao clicar:**
  - duas barras — 5h e 7 dias — com percentual e horário do reset já formatado em hora local, além do countdown (`reseta em 1h12`), calculado localmente a partir de `resets_at`;
  - selo de frescor: `atualizado agora` / `há 8 min` / `há 2h — sem sessão aberta`, com o número esmaecido quando passa de ~15 min;
  - depois que o `resets_at` vence sem sessão nova, mostra `janela nova — sem dado ainda`, e **não** assume 0%;
  - linha de hoje vinda da Fonte B: tokens do dia, nº de sessões, modelo predominante.
- **Notificação nativa** ao cruzar 70% e 90%, uma vez por janela (guarda o `resets_at` da janela em que já notificou, pra não repetir).
- **Setup assistido:** na primeira execução o app detecta se a ponte está instalada no `statusline-command.sh` e oferece aplicar o patch — inclusive pra quem não tem statusline configurado (gera um mínimo). Sem isso o app não tem dado, então isso é parte do v1, não do README.

## v2 — histórico e relatório

Indexador da Fonte B (dedup por `(message.id, requestId)`, cache incremental por arquivo com `mtime`+offset pra não reprocessar 13 MB a cada abertura):

- consumo por dia (barras dos últimos 30 dias);
- quebra por **projeto** (`cwd` → nome do repo), por **modelo** e por **entrypoint** (desktop vs CLI — quero saber onde o token some);
- proporção cache read / cache creation / output — é o que mostra se a sessão está sendo cara por contexto inchado;
- custo estimado em dólar com tabela de preço versionada, sempre rotulado como estimativa.

## v3 — extras

- **Burn rate**: com a curva do `rate-limits.jsonl`, projetar "no ritmo atual, a janela estoura às 16h40" — o aviso que realmente muda decisão (trocar de modelo, baixar o effort, parar).
- Auto-start no login, preferências (modelo de título, limiares de notificação).
- Export CSV do histórico.
- Atalho pra abrir o projeto que mais consumiu no dia.

## Stack

**Electron + [`menubar`](https://github.com/max-mapper/menubar)**, mesma escolha do `cambio-ai`. O motivo é prático: o popover é HTML/CSS/JS puro (dá pra reaproveitar o design system dos outros projetos do repo e o padrão de gráfico do `dollar-cost-analyzer`), e uma receita só de empacotamento (`electron-builder`) serve pros dois apps.

O custo: ~150–200 MB de RAM parado, num app que só mostra um número. Se incomodar, a alternativa é **Swift + `MenuBarExtra`** (SwiftUI, nativo, ~20 MB, sem runtime) — o app é simples o bastante pra portar sem drama, já que toda a inteligência está no formato dos dados, não na UI. Fica anotado como decisão em aberto, não como refactor planejado.

## Estrutura de arquivos (proposta)

```
apps/claude-statusbar/
├── plan.md              # este arquivo
├── README.md            # setup da ponte, como rodar em dev, como empacotar
├── package.json
├── scripts/
│   └── install-bridge.sh  # aplica (idempotente) o dump no statusline-command.sh
└── src/
    ├── main.js            # menubar, tray title, fs.watch, notificações
    ├── bridge.js          # lê latest.json, valida, calcula frescor e countdown
    ├── usage/
    │   ├── indexer.js     # varre os JSONL, dedup, cache incremental
    │   └── pricing.js     # tabela de preço por modelo (estimativa de custo)
    └── popover/           # HTML/CSS/JS do popover
```

## Fases

**v1** — ponte + tray com percentual + popover com as duas barras, frescor e reset + notificação de limiar. É o que resolve a dor de hoje.
**v2** — indexador do histórico e o relatório por dia/projeto/modelo.
**v3** — burn rate, preferências, export.

## Decisões em aberto

- **Electron ou Swift nativo** — ver acima. Começar no Electron pela reutilização; medir a RAM parada antes de decidir se vale portar.
- **Título na barra**: percentual, tempo até o reset, ou os dois alternando? Percentual parece o certo, mas só usando pra saber.
- **`rate-limits.jsonl` cresce pra sempre** — precisa de corte (manter 30 dias?) ou a ponte vira um vazamento lento de disco.
- **Robustez da Fonte A**: o formato do payload do statusline pode mudar entre versões do Claude Code (aqui: CLI 2.1.236, sessões gravando 2.1.270). O `bridge.js` tem que tolerar campo ausente e degradar pra "sem dado", nunca quebrar o app.
- **Confirmar se algum hook** (`SessionStart`/`Stop`) também recebe `rate_limits` — se receber, é uma segunda ponte mais barata que o statusline pra capturar no fim de cada turno.
- **Consumo do chat** (app desktop/web) aparece agregado no percentual, mas **não dá pra separar** quanto veio do chat e quanto do Code — não existe fonte local pra isso. Se um dia incomodar, o jeito é inferir: percentual da conta menos o que os JSONL explicam.
- **Nome** — "Claude Statusbar" é descritivo demais, provisório.
