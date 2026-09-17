# Câmbio AI — Plano

## Objetivo
App que avisa proativamente o melhor momento pra converter dólar recebido de fora (via Husky), evoluindo o POC `pocs/dollar-cost-analyzer` de página estática pra um produto de verdade que roda sozinho em background.

Fica fora de `pocs/` (em `apps/cambio-ai/`) porque a intenção é ser usado de verdade no dia a dia, não é só um protótipo descartável.

## Por que existe
O `dollar-cost-analyzer` já resolve a parte de "olhar a cotação e decidir", mas depende de abrir o navegador manualmente toda vez. O app resolve isso vivendo na barra de menu do macOS: cotação e trajetória sempre visíveis, um clique de distância, sem precisar abrir nada.

## v1 — App de barra de menu (macOS) — **feito**

Escopo enxuto pra sair do papel rápido, sem depender de IA nem de backend ainda.
Como rodar e o que cada parte mostra: [README.md](./README.md).

- **Stack**: Electron + [`menubar`](https://github.com/max-mapper/menubar) (ícone fixo na barra de menu, popover ao clicar). Reaproveita a lógica de fetch/gráfico do `pocs/dollar-cost-analyzer/script.js` quase direto — o processo principal do Electron faz o polling, o popover é HTML/JS igual ao POC.
- **Funcionalidade**:
  - Ícone na barra de menu com a cotação atual (bid) sempre visível.
  - Popover ao clicar: gráfico da trajetória intradiária (variação do dia) + gráfico dos últimos N dias (30, como no POC).
  - Atualização periódica em background (ex.: a cada 5–10 min) via `economia.awesomeapi.com.br/json/last/USD-BRL` — sem servidor próprio, o app busca direto.
  - Auto-start no login (opcional, configurável).
- **Sem IA e sem backend nesta fase** — só cotação + gráfico, que já é o problema principal (não precisar abrir o navegador).

## v2 — Sinal e outlook com IA
- Job agendado (dentro do próprio processo Electron, via `setInterval`/`node-cron` — não precisa de servidor separado enquanto o app roda na barra de menu) chama a API da Claude com web search pra gerar o outlook + notícias, automatizando o runbook manual que hoje existe em `pocs/dollar-cost-analyzer/plan.md`.
- Card de sinal ("bom momento pra converter" / "esperar") no popover, com a mesma heurística do `script.js`.
- Notificação nativa do macOS (Electron `Notification` API) quando o sinal cruzar um limiar configurável.

## v3 — Extras
- Comparação com a taxa Husky (campo manual, igual ao POC atual).
- Histórico de sinais passados.
- Auto-update do app (electron-updater) já que vai rodar sempre ligado.

## v4 — Versão mobile (ideia original, mais pra frente)
Retomar a ideia original de app React Native pra Play Store, reaproveitando a lógica de sinal/outlook (e o backend agendado, que aí sim passa a fazer sentido — um job rodando 24/7 num servidor, não só enquanto o Electron está aberto, pra poder mandar push mesmo de madrugada). Não é prioridade agora — só revisitar depois do desktop estar rodando e provar valor no dia a dia.

## Estrutura de arquivos
```
apps/cambio-ai/
├── plan.md               # este arquivo
├── README.md             # setup, o que o app mostra, limitações
├── package.json
├── scripts/make-icon.js  # gera o ícone template da barra de menu
└── src/
    ├── main.js           # processo principal (menubar, polling, tray, IPC)
    ├── quotes.js         # os três endpoints da AwesomeAPI
    ├── store.js          # histórico intradiário acumulado em disco
    ├── shared/theme.css  # tokens de cor, os mesmos do POC
    └── popover/          # HTML/JS/CSS do popover — portado do POC
```

## Decisões tomadas no v1
- **Polling fixo em 5 min**, não configurável: cotação anda em minutos, e um
  campo de configuração aqui seria mais superfície do que valor. Abrir o
  popover também força uma atualização, que cobre o caso "quero o número agora".
- **O gráfico intradiário é acumulado pelo app.** A API devolve no máximo 100
  cotações (~2–3h), então não dá pra montar o dia inteiro a partir dela. Como o
  app já fica ligado o dia todo, ele guarda cada amostra que vê em
  `~/Library/Application Support/cambio-ai/intraday.json`. Custo assumido: o que
  o app não presenciou não existe no gráfico.
- **Só a linha de compra nos gráficos.** Na escala dos dois, o spread pra venda
  é fino demais pra virar uma segunda linha legível — na prática as duas linhas
  se sobrepunham (o POC tem o mesmo problema, com mais espaço em tela). A venda
  ficou no topo do popover e no tooltip.
- **Sem card de sinal no v1**, mesmo com a heurística pronta no POC: ela é o
  coração do v2 e merece vir junto com o outlook e a notificação, não como meia
  funcionalidade.

## Decisões em aberto
- Empacotamento/distribuição do `.app` — via `electron-builder`, sem assinatura de código/notarização no início (roda local, só assinar se for distribuir pra outras pessoas). Enquanto isso, "abrir no login" registra o binário do Electron de dev.
- Nome do app ainda provisório ("Câmbio AI") — pode mudar.
- v2 em diante: se o job de notícias via Claude API roda só enquanto o app está aberto (mais simples, mas não avisa se o Mac estiver desligado) ou se compensa migrar pra um backend agendado real (Supabase/Cloudflare) já nessa fase.
