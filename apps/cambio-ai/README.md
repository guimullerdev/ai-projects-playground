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
  - **card de sinal** — "perto da máxima / da mínima / faixa intermediária",
    com a faixa que produziu o sinal escrita no texto;
  - **campo da Husky** — a taxa oferecida hoje, digitada à mão, com o spread
    logo abaixo em percentual **e em reais por dólar**;
  - **Hoje**: a trajetória intradiária da compra, com tooltip por cotação;
  - **Últimos 30 dias**: um ponto por pregão, mesmo tooltip;
  - rodapé com "Abrir no login", atualizar na hora e sair.

- **Notificação nativa** quando o sinal entra em "perto da máxima" — no máximo
  uma por dia, e só nesse estado.

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
- O **sinal** ([`src/signal.js`](./src/signal.js)) é a heurística que o POC
  `pocs/dollar-cost-analyzer` já usava, portada sem mudar os cortes: a posição da
  cotação na faixa dos últimos 30 pregões decide (≥ 75% do topo → converter,
  ≤ 25% → esperar, entre os dois → sem sinal), e a tendência das duas últimas
  semanas entra só como qualificador do texto, nunca como gatilho. Com menos de 7
  pregões no histórico ele diz que não tem faixa pra comparar, em vez de chutar.
- A **Husky não tem API pública**, então a taxa é digitada ([`src/husky.js`](./src/husky.js))
  e fica guardada em `settings.json` — ninguém quer redigitar o mesmo número a
  cada abertura. O campo grava no `change`, não a cada tecla: o spread de um
  número pela metade ("5" a caminho de "5,05") seria uma conta errada piscando
  na tela. Diferença abaixo de 0,05% é tratada como empate, porque a própria
  cotação anda mais que isso entre duas atualizações.
- **A notificação só sai no estado "converter"**, que é o único que pede ação;
  "esperar" e "sem sinal" são "não faça nada", e avisar sobre isso treinaria a
  ignorar o aviso que importa. Dispara na *entrada* no estado, no máximo uma vez
  por dia, com o controle guardado em `signal.json` pra que reabrir o app não
  renda um segundo aviso igual.
- Falha de rede não limpa a tela: a última cotação continua, com um aviso no
  popover e o rótulo marcando que está desatualizada.

## Limitações conhecidas

- O gráfico do dia só tem o que o app presenciou (mais as ~100 cotações que a
  API devolve a cada busca). Primeira execução no meio do dia começa pela metade.
- Enquanto o app não está aberto, nada é coletado nem avisado: o sinal e a
  notificação só existem com o app rodando. Um job de verdade 24/7 exigiria
  backend, que está anotado como v4 no [plan.md](./plan.md).
- O limiar da notificação **não é configurável ainda** — é o próprio corte de
  75% da faixa. Preferências são outra fase; hoje mudar isso é editar
  `src/signal.js`.
- "Abrir no login" em modo dev registra o binário do Electron, não um `.app` —
  no app empacotado ele registra o próprio bundle.

## Empacotar

```sh
npm run dist
```

Gera `dist/Cambio AI-<versão>-arm64.dmg` e o `.app` solto em `dist/mac-arm64/`.
A configuração está no campo `build` do [package.json](./package.json), mesma
receita do `claude-statusbar`: `LSUIElement: 1` (app de barra de menu de
verdade, sem ícone no dock desde o lançamento) e ícone gerado por script.

**O `productName` é "Cambio AI", sem acento, e isso não é descuido.** Com
"Câmbio AI" o app empacotado morre no lançamento com `SIGTRAP`, sem escrever uma
linha de log — o A/B é direto: mesmo código, só trocando o nome, ele passa a
subir. O mecanismo provável é a validação de integridade do `app.asar`, que
compara o caminho do bundle com o que está no `Info.plist`: o macOS guarda o
nome do arquivo em NFD ("a" + acento combinante) e o plist carrega NFC, e a
comparação falha. Desligar a validação de integridade pra manter o circunflexo
seria trocar uma proteção por um enfeite; o nome dentro do app (título da
janela, popover, tooltip) continua "Câmbio AI", e o `.dmg` também.

**Não é assinado** — não existe Developer ID aqui, então o `.app` fica com a
assinatura ad-hoc do próprio binário do Electron. Primeira abertura vinda do
`.dmg`: botão direito › Abrir, ou
`xattr -dr com.apple.quarantine "/Applications/Cambio AI.app"`.

## Manutenção

Os dois ícones são gerados por script, a partir do mesmo desenho
([`scripts/mark.js`](./scripts/mark.js)): o template monocromático da barra de
menu e o ícone colorido do `.app` (`npm run make-app-icon`, que o `npm run dist`
já chama).

O ícone da barra é template image (preto + alfa, o macOS recolore sozinho):

```bash
npm run make-icon
```
