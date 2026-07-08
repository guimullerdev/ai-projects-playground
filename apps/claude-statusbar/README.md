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

- **Ícone da barra**: `◐ 42%` — percentual da janela de 5h atual. `◐ --%`
  quando não há dado (ainda não instalou a ponte, ou faz tempo que nenhuma
  sessão roda).
- **Popover**: barras de 5h e 7 dias, com percentual, countdown até o reset
  (`reseta em 1h12`) e um selo de frescor (`atualizado agora` / `há 8 min` /
  `há 2h — sem sessão aberta`). Uma linha de rodapé com tokens de hoje, número
  de sessões e o modelo predominante — lido direto dos transcripts em
  `~/.claude/projects/`, com deduplicação (resume/fork de sessão duplicam
  linhas nesses arquivos).
- **Notificação nativa** quando a janela de 5h cruza 70% e depois 90%, uma
  vez por janela.

## Limitações conhecidas do v1

- O dado só atualiza enquanto uma sessão do Claude Code está aberta em algum
  lugar (CLI ou desktop) — é assim que o statusline é acionado. Sem sessão
  ativa, o número fica parado e o app avisa isso explicitamente, em vez de
  fingir que está ao vivo.
- O formato do payload do statusline pode mudar entre versões do Claude Code.
  O app degrada pra "sem dado" em campos ausentes, mas se um release futuro
  renomear `rate_limits.five_hour`, isso para de funcionar até o código ser
  atualizado.
- A linha de "hoje" é uma varredura simples dos transcripts, não o indexador
  completo do v2 (sem cache incremental, sem quebra por projeto/modelo). Em
  máquinas com muito histórico ela pode ficar perceptivelmente lenta — por
  isso roda a cada 5 minutos, não a cada atualização de rate limit.

## Empacotar

Ainda não configurado neste v1 (roda via `npm start` em dev). `electron-builder`
é o plano pra quando fizer sentido gerar um `.app` de verdade — mesma receita
do `cambio-ai`.
