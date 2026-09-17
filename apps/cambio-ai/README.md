# Câmbio AI

App de barra de menu do macOS com a cotação do dólar comercial sempre à vista e
a trajetória do dia e dos últimos 30 dias a um clique — pra decidir quando
converter dólar sem precisar abrir o navegador toda hora.

É a evolução do POC [`pocs/dollar-cost-analyzer`](../../pocs/dollar-cost-analyzer),
que resolvia a análise mas dependia de alguém lembrar de abrir a página. Ver
[plan.md](./plan.md) para o raciocínio completo e as fases seguintes (sinal com
IA, notificações, comparação com a Husky).

## Setup

```bash
npm install
npm start
```

Um ícone aparece na barra de menu com a cotação de compra. Clicar abre o
popover. Não precisa de chave de API nem de servidor: o app busca direto na
[AwesomeAPI](https://docs.awesomeapi.com.br/api-de-moedas).

## O que o app mostra

- **Barra de menu**: `$ 5,1520 ▲` — cotação de compra e a direção do dia
  (`▲`/`▼`/`·`). `$ --` enquanto a primeira carga não volta. O tooltip traz
  compra, venda, variação do dia e o horário da cotação.
- **Popover**:
  - compra em destaque, com variação do dia, venda, máxima e mínima de hoje;
  - **Hoje**: a trajetória intradiária da compra, com tooltip por cotação;
  - **Últimos 30 dias**: um ponto por pregão, mesmo tooltip;
  - rodapé com "Abrir no login", atualizar na hora e sair.

Só a compra vira linha nos gráficos: na escala de qualquer um dos dois o spread
até a venda é fino demais pra virar uma segunda linha legível — a venda aparece
no topo e no tooltip.

## Como funciona

- O processo principal busca a cada **5 minutos** os três endpoints da
  AwesomeAPI (última cotação, 30 dias, últimas cotações) e empurra o resultado
  pro popover. Abrir o popover também dispara uma atualização.
- O **gráfico do dia é acumulado pelo próprio app**: a API devolve no máximo 100
  cotações (~2–3h de pregão), então cada amostra vista é guardada em
  `~/Library/Application Support/cambio-ai/intraday.json` e vai formando a
  trajetória do dia inteiro. Quanto mais o app fica aberto, mais completo o
  gráfico — e o que ele não viu (Mac desligado) não aparece.
- Fim de semana e feriado mostram o **último pregão**, com a data ao lado do
  título, em vez de fingir que é a trajetória de hoje.
- Falha de rede não limpa a tela: a última cotação continua, com um aviso no
  popover e o rótulo marcando que está desatualizada.

## Limitações conhecidas

- O gráfico do dia só tem o que o app presenciou (mais as ~100 cotações que a
  API devolve a cada busca). Primeira execução no meio do dia começa pela metade.
- Enquanto o app não está aberto, nada é coletado nem avisado — notificação e
  sinal são as próximas fases (ver [plan.md](./plan.md)).
- Sem empacotamento ainda: roda via `npm start`. `electron-builder` fica pra
  quando valer a pena ter um `.app`.
- "Abrir no login" em modo dev registra o binário do Electron, não um `.app`
  — só faz sentido de verdade depois do empacotamento.

## Manutenção

O ícone da barra é gerado por script (template image preto + alfa, o macOS
recolore sozinho):

```bash
npm run make-icon
```
