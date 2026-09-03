# Claude Statusbar

App de barra de menu do macOS que mostra o quanto da sua assinatura Claude já
foi consumido (janela de 5h e de 7 dias) e quando reseta — sem precisar abrir
o terminal ou esperar tomar um "limite atingido" no meio de uma resposta.

Ver [plan.md](./plan.md) para o raciocínio completo (de onde vêm os dados, o
que foi descartado e por quê, e as fases seguintes).

## Como funciona, resumido

O Claude Code já manda esses números pro seu script de `statusline` toda vez
que ele é chamado — só que eles nunca ficam salvos em lugar nenhum. Este app
depende de uma "ponte": duas dúzias de linhas a mais no seu
`~/.claude/statusline-command.sh` que despejam esse payload em
`~/.claude/statusbar/latest.json`. O app só lê esse arquivo.

Sem a ponte instalada, o app abre mas mostra "sem dado".

## Setup

1. Instalar dependências:

   ```bash
   npm install
   ```

2. Instalar a ponte no seu `statusline-command.sh` (idempotente — pode rodar
   de novo sem duplicar nada):

   ```bash
   npm run install-bridge
   ```

   Isso insere um bloco marcado (`# >>> claude-statusbar bridge >>>` / `<<<`)
   logo após a linha que lê o stdin (`input=$(cat)`). Se você não tiver um
   `statusline-command.sh` ainda, o script cria um mínimo. Se o seu script
   não seguir esse padrão, o bridge é anexado ao final do arquivo e um aviso
   é impresso — confira manualmente se `$input` está disponível nesse ponto.

3. Abrir **qualquer** sessão do Claude Code (CLI ou app desktop) pra gerar o
   primeiro payload — o statusline só é chamado enquanto uma sessão está
   ativa.

4. Rodar o app:

   ```bash
   npm start
   ```

Um ícone aparece na barra de menu com o percentual da janela de 5h. Clicar
abre o popover com as duas janelas, o horário do reset e a linha de uso de
hoje.

## O que o app mostra

- **Ícone da barra**: `◐ 42%` — percentual da janela de 5h atual, ou `◐ 1h12`
  (tempo até o reset) se você trocar nas preferências. `◐ --` quando não há
  dado (ainda não instalou a ponte, ou faz tempo que nenhuma sessão roda).
- **Popover**: barras de 5h e 7 dias, com percentual, countdown até o reset
  (`reseta em 1h12`) e um selo de frescor (`atualizado agora` / `há 8 min` /
  `há 2h — sem sessão aberta`). Uma linha de rodapé com tokens de hoje, número
  de sessões e o modelo predominante, e um link pro relatório.
- **Ritmo de consumo**, logo abaixo do countdown de 5h: `ritmo 25%/h · estoura
  às 13:34` — ver abaixo.
- **Notificação nativa** quando a janela de 5h cruza os limiares (70% e 90%
  por padrão), e quando o ritmo passa a projetar o estouro antes do reset. Cada
  um desses avisos dispara uma vez por janela, e os dois podem ser desligados
  nas preferências.
- **Relatório** (botão "Relatório ›" no popover): janela separada com o
  histórico dos últimos 30 dias (ou a janela que você escolher) — ver abaixo.

## Ritmo de consumo

A ponte também acrescenta uma linha em `~/.claude/statusbar/rate-limits.jsonl`
**toda vez que o percentual muda** (não a cada chamada do statusline, que
acontece várias vezes por segundo). Isso dá a curva de consumo dentro da
janela, e é dela que sai a projeção em
[`src/burnRate.js`](./src/burnRate.js):

> `ritmo 25%/h · estoura às 13:34`

O ajuste é uma regressão linear sobre os últimos ~90 min da janela atual — ou
sobre a janela inteira, se esse trecho recente for curto demais (< 10 min) pra
dizer alguma coisa. Três detalhes que decidem se o número é honesto:

- **A janela é filtrada por `resets_at`.** No reset o percentual despenca pra
  ~0; uma reta puxada por cima desse degrau projeta qualquer coisa.
- **Sem sessão aberta não existe ritmo.** Passados 20 min sem amostra nova, a
  linha vira `sem consumo há 2h` em vez de continuar extrapolando um ritmo que
  acabou.
- **Vermelho só quando muda decisão.** A linha só fica em destaque quando a
  projeção estoura com pelo menos 15 min de folga antes do reset. Quando ela
  cai em cima do horário do reset, o texto diz isso (`estoura em cima do
  reset`) em vez de fingir precisão que não tem.

O arquivo cresce pra sempre (retenção ainda é decisão em aberto no
[plan.md](./plan.md)), então a leitura pega só os últimos 256 KB — a janela
atual sempre cabe nisso.

## Relatório

O botão "Relatório ›" no popover abre uma janela com os últimos 30 dias, lidos
dos transcripts em `~/.claude/projects/`:

- **consumo por dia** (colunas, com tabela equivalente embaixo do gráfico);
- **composição dos tokens** — input, output, cache creation e cache read. É a
  parte que costuma surpreender: sessão longa é quase toda releitura de cache,
  e isso aparece na hora;
- **quebra por projeto, por modelo e por entrypoint** (app desktop vs CLI);
- **custo estimado**, com tabela de preço versionada em
  [`src/usage/pricing.js`](./src/usage/pricing.js).

O botão **"Exportar…"** salva o relatório **que está na tela** — não uma
varredura nova, então o arquivo bate com os números que você estava olhando. A
extensão escolhida no diálogo decide o formato:

- **`.csv`** — formato longo, separador `;` (o que o Excel em pt-BR espera, mesma
  escolha do export do `pocs/financing-simulator`): uma linha por bucket, colunas
  `secao;chave;tokens;custo_usd;tokens_sem_preco`, onde `secao` é `dia`,
  `projeto`, `modelo`, `entrypoint` ou `composicao`. Números crus, com ponto
  decimal, pra planilha poder somar a coluna. Os totais **não** vêm no arquivo:
  são a soma das linhas de `dia`, e repeti-los convidaria a contar tudo duas
  vezes numa tabela dinâmica.
- **`.json`** — o relatório inteiro como o app usa, inclusive o que não cabe no
  CSV: totais, nº de sessões e de respostas, versão da tabela de preço e a
  estatística da varredura.

A serialização mora em [`src/usage/exporter.js`](./src/usage/exporter.js) e não
importa nada de Electron, então dá pra conferir a saída com `node` sem subir o
app.

Duas coisas que o indexador ([`src/usage/indexer.js`](./src/usage/indexer.js))
resolve e que qualquer varredura ingênua erra:

- **Deduplicação.** Resume, fork de sessão e sidechain recopiam o histórico
  pro arquivo novo. Nesta máquina, 46% das linhas com `usage` eram repetidas —
  sem deduplicar por `(message.id, requestId)`, todo número quase dobra.
- **Leitura incremental.** Transcripts só crescem, então o índice guarda o
  offset em bytes de cada arquivo em `~/.claude/statusbar/usage-index.json` e
  lê só o que foi acrescentado. Aqui: ~110 ms na primeira varredura de 30 MB,
  menos de 20 ms nas seguintes.

O custo em dólar é **estimativa** e está rotulado como tal na interface: a
assinatura não cobra por token. O que ele serve é comparar projetos, modelos e
dias entre si.

## Preferências

O botão "Preferências" no popover abre uma janela com o que antes era constante
no código:

- **título na barra** — percentual usado (`◐ 42%`) ou tempo até o reset (`◐ 1h12`);
- **limiares de aviso** da janela de 5h (70% e 90% por padrão) — ou nenhum, se
  desmarcar o aviso;
- **aviso de ritmo** — ligar/desligar o que projeta o estouro antes do reset;
- **janela do relatório** — de 7 a 90 dias, valendo pro gráfico por dia e pra
  todas as quebras;
- **abrir no login** — registra o app nos Itens de Início do macOS.

Cada campo salva ao mudar, sem botão "Salvar", e **aplica na hora**: o título do
tray redesenha, o próximo render já usa os limiares novos, e mudar a janela
reindexa o relatório. Nada disso pede reinício.

O "abrir no login" é **de mão única** por um motivo medido: numa execução de
dev, onde nada foi registrado, `app.getLoginItemSettings().openAtLogin` volta
`true` — ler o estado do sistema pra sincronizar ligaria a preferência sozinha.
Então o app só **registra** (a cada abertura, pra entrada sobreviver a um
reinstall) e só **desregistra** quando você desmarca a caixa. Se remover a
entrada em Ajustes do Sistema, desmarque aqui também. Em dev (`npm start`) quem
é registrado é o binário do Electron, e a janela avisa isso.

As preferências ficam em `~/.claude/statusbar/config.json`, junto do
`latest.json` e do `notified.json` — é JSON legível, dá pra editar na mão, e um
arquivo inválido ou truncado volta pros padrões campo a campo em vez de derrubar
o app ([`src/config.js`](./src/config.js)).

## Limitações conhecidas

- O dado só atualiza enquanto uma sessão do Claude Code está aberta em algum
  lugar (CLI ou desktop) — é assim que o statusline é acionado. Sem sessão
  ativa, o número fica parado e o app avisa isso explicitamente, em vez de
  fingir que está ao vivo.
- O formato do payload do statusline pode mudar entre versões do Claude Code.
  O app degrada pra "sem dado" em campos ausentes, mas se um release futuro
  renomear `rate_limits.five_hour`, isso para de funcionar até o código ser
  atualizado.
- O relatório conta **tokens**, não percentual de limite: as duas coisas não
  são conversíveis, e a única fonte honesta de percentual é a ponte. Pelo
  mesmo motivo o custo em dólar é sempre estimativa — a assinatura não cobra
  por token.
- A projeção de ritmo é extrapolação linear: ela responde ao que você acabou
  de fazer, não ao que você vai fazer. Uma rajada de 20 min projeta um estouro
  que uma pausa desmente logo em seguida — ela serve pra decidir agora (trocar
  de modelo, baixar o effort), não pra planejar a tarde.
- `rate-limits.jsonl` ainda não tem corte de retenção. Ele cresce devagar (uma
  linha por mudança de percentual), mas cresce.
- O índice guarda um registro por resposta nos últimos 90 dias. Com muito
  histórico o cache chega a alguns MB; registros mais velhos que isso são
  descartados a cada gravação.

## Empacotar

Ainda não configurado neste v1 (roda via `npm start` em dev). `electron-builder`
é o plano pra quando fizer sentido gerar um `.app` de verdade — mesma receita
do `cambio-ai`.
