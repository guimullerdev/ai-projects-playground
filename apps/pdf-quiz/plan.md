# PDF Quiz — Plano

## Objetivo

Transformar PDFs de estudo em quizzes jogáveis: eu jogo os PDFs numa pasta, a Claude lê e gera arquivos JSON com perguntas de múltipla escolha, e um front estático consome esses JSONs com pontuação, progresso e — o ponto central — **explicação em cada alternativa errada dizendo por que ela é errada**.

Fica em `apps/` (não em `pocs/`) porque a intenção é usar de verdade pra estudar ao longo do tempo, com histórico de acertos acumulando — não é um protótipo pra olhar uma vez e abandonar.

## Por que existe

Ler PDF é passivo: dá a sensação de que entendeu, mas não testa nada. Quiz com feedback imediato força a recuperação ativa. E a parte que realmente ensina não é acertar — é errar e entender *por que* aquela alternativa que parecia certa não era. Por isso o schema exige explicação por alternativa, não só por questão.

Três consequências que atravessam o plano inteiro e explicam quase toda decisão daqui pra baixo:

1. **A explicação é o produto**, não a pergunta. Um deck sem explicação boa é um deck quebrado, mesmo que as perguntas estejam certas.
2. **O erro precisa ter continuação** — referência pra onde revisar, tópico pra agrupar, e um modo de refazer só o que errei. Erro sem continuação é ruído.
3. **O histórico é o que diferencia isso de um quiz descartável.** Se o progresso sumir, o projeto vira POC.

## Stack

Zero dependência, zero build: HTML + CSS + JS puro, mesmo padrão dos outros projetos do repo, reaproveitando o design system existente (variáveis `--bg`/`--surface`/`--accent`/`--up`/`--down`, dark mode via `prefers-color-scheme` + toggle `data-theme`).

A geração dos decks **também** não tem stack: é a própria sessão do Claude Code lendo o PDF e escrevendo o JSON, guiada por um prompt versionado. Sem API key, sem script, sem SDK — até o v3, quando volume justificar.

O único "runtime" é um `python3 -m http.server` pra servir os JSONs (ver [Como o front carrega os JSONs](#como-o-front-carrega-os-jsons)).

## Pipeline

```
pdfs/*.pdf  ──►  Claude lê e gera  ──►  decks/*.json  ──►  front estático joga
 (gitignored)      (prompt fixo)         (perguntas)        (pontuação + histórico)
```

### 1. Colocar o PDF

Em `pdfs/` — pasta gitignored, porque material de estudo é pesado e geralmente tem direito autoral.

### 2. Gerar o deck

Pedir pra Claude Code ler o PDF e escrever o JSON, usando o prompt versionado em `prompts/gerar-deck.md`.

Limite prático que define o tamanho do deck: leitura de PDF vai em blocos de ~10–20 páginas por vez. Então **um deck por capítulo/seção**, nunca um deck gigante por livro. Isso também é melhor pedagogicamente — sessão de 15–20 questões, que cabe numa sentada.

O prompt ser um arquivo versionado (e não algo que eu redigito toda vez) é o que faz os decks saírem consistentes entre si: mesmo schema, mesmo estilo de distrator, mesma régua de dificuldade. Quando um deck sair ruim, o conserto é editar o prompt, não o JSON.

### 3. Jogar

Abrir `index.html`, escolher o deck no catálogo, responder.

## O contrato: schema do deck

O JSON é a fronteira entre a Claude e o front. Enquanto ele não mudar, os dois lados evoluem sozinhos.

### Arquivo de deck

Um arquivo por deck, em `decks/<slug>.json`:

```json
{
  "id": "redes-cap3",
  "titulo": "Redes — Capítulo 3: Camada de Transporte",
  "fonte": { "arquivo": "redes-kurose.pdf", "paginas": "185-210" },
  "gerado_em": "2026-09-13",
  "questoes": [
    {
      "id": "q1",
      "topico": "Controle de congestionamento",
      "dificuldade": "media",
      "enunciado": "No TCP Reno, o que acontece com a janela de congestionamento ao receber três ACKs duplicados?",
      "alternativas": [
        {
          "id": "a",
          "texto": "A janela cai para 1 MSS e volta ao slow start",
          "correta": false,
          "explicacao": "Esse é o comportamento do TCP no timeout, não nos ACKs duplicados. Três ACKs duplicados indicam que a rede ainda está entregando pacotes, então o Reno reage de forma menos agressiva (fast recovery) em vez de zerar a janela."
        },
        {
          "id": "b",
          "texto": "A janela é reduzida pela metade e entra em fast recovery",
          "correta": true,
          "explicacao": "Correto. Três ACKs duplicados disparam fast retransmit, e o Reno corta cwnd pela metade entrando em fast recovery, sem voltar ao slow start."
        }
      ],
      "referencia": "p. 197 — seção 3.7.1"
    }
  ]
}
```

### Campos

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | slug único, igual ao nome do arquivo — é a chave do histórico no `localStorage` |
| `titulo` | string | aparece no card do catálogo; inclui o capítulo, não só o livro |
| `fonte.arquivo` / `fonte.paginas` | string | de onde saiu; sem isso não dá pra regerar nem conferir |
| `gerado_em` | `YYYY-MM-DD` | pra saber qual deck é velho quando o prompt melhorar |
| `questoes[].id` | string | único **dentro do deck**; é o que o modo "só os que errei" guarda |
| `questoes[].topico` | string | agrupa o relatório de fraquezas — poucos valores, repetidos |
| `questoes[].dificuldade` | `facil` \| `media` \| `dificil` | peso da pontuação (1 / 2 / 3) |
| `questoes[].enunciado` | string | uma pergunta só, sem "qual das alternativas abaixo **não**…" quando der pra evitar |
| `alternativas[].correta` | bool | booleano **por alternativa**, não índice — permite múltipla resposta depois sem quebrar o formato |
| `alternativas[].explicacao` | string | obrigatório em **todas**, inclusive na correta |
| `questoes[].referencia` | string | página/seção pra revisar |

### Catálogo

`decks/index.json` lista o que existe, pro front não precisar adivinhar:

```json
{
  "decks": [
    { "id": "redes-cap3", "titulo": "Redes — Cap. 3", "arquivo": "redes-cap3.json", "total_questoes": 18 }
  ]
}
```

Quem escreve esse arquivo é a Claude, no mesmo passo em que gera o deck — o prompt precisa mandar atualizar o índice, senão o deck novo existe mas não aparece.

## Qualidade das questões

Essa seção é o que o `prompts/gerar-deck.md` precisa garantir. É a parte do projeto que mais decide se ele presta.

### Explicação por alternativa

Na errada, a explicação diz *por que é errada* e, quando dá, *o que ela realmente descreve*. Esse segundo pedaço é o que mais ensina: mostra o conceito vizinho que foi confundido, em vez de só negar. "Isso é o comportamento no timeout, não nos ACKs duplicados" vale dez vezes mais que "alternativa incorreta".

Na correta, a explicação não repete o enunciado — ela dá o mecanismo (*por que* é assim), que é o que sustenta a resposta numa questão diferente sobre o mesmo conceito.

### Distratores

3–5 alternativas por questão, tiradas do **próprio PDF** — conceitos vizinhos reais, nunca opções obviamente absurdas. Distrator absurdo transforma a questão em reconhecimento de padrão e não testa nada.

A régua: um distrator bom é uma resposta que **eu daria** se tivesse entendido o conceito pela metade.

Proibido: "todas as anteriores", "nenhuma das anteriores", alternativas que se distinguem só por uma palavra invertida, e alternativa cujo tamanho denuncia que é a certa (a correta costuma sair mais longa — o prompt precisa equalizar).

### Tópicos

Poucos e repetidos dentro do deck (uns 4–6 pra 18 questões). Tópico único por questão mata o relatório de fraqueza: se cada questão tem seu próprio tópico, "onde eu erro mais" vira uma lista de 18 itens com 1 erro cada.

### Ancoragem

A questão tem que sair do texto lido, não do que o modelo sabe sobre o assunto. `referencia` obrigatória é justamente a trava: se não dá pra apontar a página, a questão provavelmente não veio do PDF.

### Distribuição

Por deck, mais ou menos: 30% fácil (definição/reconhecimento), 50% média (aplicação), 20% difícil (comparação entre conceitos, caso de borda). Deck só de fácil dá sensação falsa de domínio; deck só de difícil desanima.

## Front

Três telas, uma página só.

### Tela 1 — Catálogo

Card por deck com título, nº de questões, melhor pontuação e data da última tentativa. Botões: **Começar** e **Só os que errei** (desabilitado quando não há erros guardados).

### Tela 2 — Quiz

Uma questão por vez, barra de progresso no topo, alternativas clicáveis.

Ao responder, feedback **imediato**: a alternativa escolhida fica verde ou vermelha, a correta é revelada, e a explicação da escolhida aparece embaixo. Se errou, mostra também a explicação da correta.

Feedback imediato (e não só no final) é escolha deliberada: a explicação chega no momento em que o raciocínio errado ainda está fresco na cabeça. No final, já esqueci por que marquei aquilo.

Atalhos: `1`–`5` escolhe, `Enter` avança.

### Tela 3 — Resultado

Pontuação, % de acerto, tempo, e **quebra por tópico** — onde errou mais. Lista das questões erradas com enunciado + explicação + referência, pra revisar tudo de uma vez. Botões: **Refazer só os erros** / **Refazer tudo** / **Voltar ao catálogo**.

### Pontuação

- Score da sessão = acertos ponderados por dificuldade (fácil 1, média 2, difícil 3) — evita que deck fácil infle o número.
- Streak de acertos seguidos, visível durante o quiz.
- Sem penalidade por erro: o objetivo é me fazer responder, não me fazer evitar responder.

### Persistência

Tudo em `localStorage`, chave `pdf-quiz:v1`:

```json
{
  "redes-cap3": {
    "tentativas": 3,
    "melhor_score": 31,
    "ultima": "2026-09-18",
    "erradas": ["q4", "q11"]
  }
}
```

`erradas` é o que alimenta o "só os que errei" — questão acertada numa tentativa posterior sai do set. A chave tem `:v1` pra eu poder mudar o formato sem herdar lixo.

### Como o front carrega os JSONs

Detalhe prático que morde: `fetch()` de arquivo local falha por CORS quando a página é aberta direto por `file://`. Duas saídas, as duas implementadas:

- **Servidor local** (caminho normal): `python3 -m http.server` na pasta do projeto, abrir via `localhost`. `fetch('decks/index.json')` funciona.
- **Importar deck** (fallback e uso avulso): botão + drag & drop de `.json` na página. Serve pra abrir no `file://` sem servidor e pra jogar deck que não está commitado.

## Integração com Obsidian

Faz sentido, mas **não como plataforma** — como destino.

### O que eu não vou fazer: plugin do Obsidian

Escrever o quiz como plugin acopla o projeto ao ciclo de vida de outro app, obriga TypeScript + build + API de plugin que muda, e joga fora o front estático que segue o padrão do resto do repo. Também amarra o estudo à máquina com o vault configurado. O ganho seria "abre dentro do Obsidian" — pouco, perto do custo.

### O que faz sentido: exportar o erro pro vault (v2)

O buraco real do plano atual é que o aprendizado morre no `localStorage`. Errei, li a explicação, fechei a aba — e três meses depois não tem rastro. O vault é exatamente o lugar onde esse rastro deveria ficar.

Na tela de resultado, um botão **Exportar erros (.md)** gera uma nota por sessão, que eu jogo no vault:

```markdown
---
deck: redes-cap3
data: 2026-09-18
acertos: 14/18
---

# Redes — Cap. 3 — erros de 18/09

## [[Controle de congestionamento]]

**No TCP Reno, o que acontece com a cwnd ao receber três ACKs duplicados?**

Marquei: *A janela cai para 1 MSS e volta ao slow start*
→ Esse é o comportamento no timeout. Três ACKs duplicados indicam que a rede
  ainda entrega pacotes, então o Reno usa fast recovery.

Certa: *Reduzida pela metade, entra em fast recovery* · `redes-kurose.pdf` p. 197
```

O que o `[[tópico]]` compra: o backlink do Obsidian passa a responder "todas as vezes que eu errei em Controle de congestionamento", atravessando decks e livros — que é o relatório de fraqueza que eu queria, de graça e permanente, sem eu escrever agregação nenhuma.

Implementação: gerar string markdown e baixar como arquivo. Sem API, sem plugin, sem caminho de vault no código — eu escolho onde salvar.

### Flashcards de repetição espaçada

Segundo export, mesmo custo: as questões no formato do plugin **obsidian-spaced-repetition**, uma nota por deck com a tag `#flashcards`:

```markdown
#flashcards/redes

O que dispara fast retransmit no TCP Reno?
?
Três ACKs duplicados. A cwnd cai pela metade e entra em fast recovery —
diferente do timeout, que volta ao slow start. (Kurose p. 197)
```

Isso **mata o item de SM-2 do v4**. Repetição espaçada é um problema resolvido e chato de implementar direito (agendamento, fila do dia, persistência entre dispositivos); o plugin já faz, sincroniza com o resto do vault e sobrevive a eu limpar o navegador. Meu app faz o que ele não faz — múltipla escolha com explicação por alternativa — e delega o resto.

### PDFs que já moram no vault

Se o material já está no vault, `pdfs/` pode ser um symlink pra lá. Nada no código depende disso — é conveniência de sistema de arquivos, e não vira dependência.

## Estrutura de arquivos

```
apps/pdf-quiz/
├── plan.md            # este arquivo
├── README.md          # como gerar deck e como rodar
├── .gitignore         # pdfs/ e decks/*.json (exceto exemplo.json)
├── pdfs/              # material de estudo
├── prompts/
│   └── gerar-deck.md  # prompt versionado: schema + regras de distrator e explicação
├── decks/
│   ├── index.json     # catálogo
│   └── exemplo.json   # deck de amostra, pra página nunca abrir vazia
├── index.html
├── style.css
└── js/
    ├── app.js         # roteamento entre as três telas, carregamento/import de decks
    ├── quiz.js        # estado da sessão, pontuação, streak, modo "só os erros"
    ├── storage.js     # histórico em localStorage
    └── export.js      # markdown pro Obsidian (v2)
```

## Versionamento e privacidade

Plano e código vão pro git. **PDFs e decks gerados, não**: `pdfs/` fica de fora por peso e direito autoral, e `decks/` pelo mesmo motivo — questão gerada de um livro é material derivado. Exceção: `decks/exemplo.json`, commitado pra página nunca abrir vazia.

### Datas dos commits

O repo usa datas backdated, e nele autor e committer são sempre **iguais** — `--date` sozinho move só o autor, e aí o `git log` parece certo enquanto o committer entrega que a história foi reescrita depois. Hora do dia: `20:30:00 -0300`, como o resto dos commits de `apps/`.

```
GIT_COMMITTER_DATE="2026-08-29T20:30:00-03:00" \
  git commit --date="2026-08-29T20:30:00-03:00" -m "feat(pdf-quiz): add v1 quiz app"
```

| Fase | Data | Mensagem |
|---|---|---|
| plano | 28/08/2026 | `docs(pdf-quiz): add study quiz plan` — já commitado (`dcee40d`, esse ao meio-dia) |
| v1 | 29/08/2026 | `feat(pdf-quiz): add v1 quiz app` — já commitado (`e27894b`) |
| v2 | 30/08/2026 | `feat(pdf-quiz): add progress and export` — já commitado (`2fba4f5`) |
| v3 | 31/08/2026 | `feat(pdf-quiz): add batch deck generation` |
| v4 | 01/09/2026 | `feat(pdf-quiz): add exam mode` |

Mensagem em Conventional Commits, em inglês, sem trailer de co-autoria. Conferir depois com `git log --pretty=format:'%ad | %cd' --date=iso` que as duas datas bateram.

Nada sai da máquina: sem telemetria, sem backend, sem request pra fora. O histórico é `localStorage`, e o único dado que atravessa fronteira é o `.md` que eu mesmo exporto.

## Fases

Cada fase fecha em **um commit**, com a data e o formato da seção anterior.

### v1 — o loop completo, manual · commit 29/08 — **feito**

Schema + `prompts/gerar-deck.md` + um deck real gerado de um PDF meu + as três telas + pontuação + histórico em `localStorage`. Como rodar e como gerar um deck: [README.md](./README.md).

*Pronto quando*: eu consigo gerar um deck de um capítulo e jogar do início ao fim sem tocar em código, e o "só os que errei" funciona dentro da mesma sessão.

O que entrou em `e27894b`: o prompt versionado, as três telas em HTML/CSS/JS puro, pontuação ponderada por dificuldade com streak, histórico em `localStorage` (incluindo o set de erradas que encolhe quando acerto na repescagem), import por botão e drag & drop, e `decks/exemplo.json` — 6 questões escritas à mão, pra página nunca abrir vazia.

**Falta o deck real**: `pdfs/` está vazia, então o critério acima só foi exercitado com o exemplo. Rodar o prompt num capítulo de verdade é o que vai dizer se as regras de distrator aguentam material que eu não escrevi.

Dois desvios do que está escrito acima, decididos na implementação:

- `decks/index.json` entrou no `.gitignore` junto com os outros decks — ele muda a cada deck local e sujaria o working tree. Quando o catálogo não existe, o front cai no exemplo em vez de abrir vazio.
- O deck de exemplo precisou ser reordenado: a correta saía sempre na primeira posição, que é justamente o que o prompt proíbe.

### v2 — memória · commit 30/08 — **feito**

"Só os que errei" acumulado **entre** sessões, relatório de tópicos fracos somando todas as tentativas, export/import do progresso em JSON (pra não perder se limpar o navegador) e os dois exports pro Obsidian (erros com `[[tópico]]` e flashcards).

*Pronto quando*: depois de duas semanas sem abrir, o app me diz o que revisar primeiro.

O que entrou em `2fba4f5`: painel "Onde eu erro mais" no topo do catálogo, somando todas as tentativas de todos os decks; `js/export.js` com as três saídas (nota de erros, flashcards, backup do progresso); e o import do backup. O "só os que errei" entre sessões já tinha vindo no v1, porque o set de erradas nasceu persistente.

Três decisões da implementação:

- **Tópico só entra no painel depois de 2 respostas.** Com uma resposta só, um chute isolado lidera o ranking de fraqueza e o painel mente.
- **Import de progresso substitui, não mescla.** Mesclar duas linhas do tempo do mesmo deck exigiria inventar o que fazer com tentativas e recordes concorrentes; restaurar backup é substituir, e a confirmação diz o que se perde.
- **Flashcards saem do deck inteiro, não só dos erros.** O que eu acertei hoje é justamente o que a repetição espaçada precisa reagendar pra daqui a semanas.

A chave do `localStorage` continua `pdf-quiz:v1`: o campo `topicos` é aditivo e registro velho sem ele vira `{}`, então não valia queimar o histórico existente.

### v3 — geração em lote · commit 31/08

Script Node usando a API da Claude com suporte a PDF pra processar um livro inteiro, capítulo por capítulo, sem eu pedir deck por deck. Só vale quando o volume justificar — antes disso é complexidade sem ganho.

### v4 — se der vontade · commit 01/09

Modo simulado com timer e ordem embaralhada, e questões dissertativas curtas com a Claude corrigindo. (SM-2 saiu daqui: fica com o plugin do Obsidian.)

## O que eu descartei

| Ideia | Por que não |
|---|---|
| Plugin do Obsidian | acopla a outro app, exige build e TS, e amarra o estudo a uma máquina configurada |
| Implementar SM-2 no app | o plugin de spaced repetition já faz melhor; eu só exporto |
| Backend / conta / sync | o histórico cabe no `localStorage`; sync resolve-se com o export JSON |
| Parser de PDF em JS no front | o trabalho difícil é entender o conteúdo, não extrair texto — e isso é a Claude que faz |
| Deck por livro inteiro | estoura a leitura em blocos e vira sessão que ninguém termina |
| Gerar explicação só na correta | é exatamente o que os outros quizzes fazem e o motivo deste existir |

## Decisões em aberto

- **Nome** — "PDF Quiz" é descritivo demais, provisório. E fica errado assim que entrar fonte que não é PDF.
- **Múltipla resposta e V/F no v1** ou só resposta única? O schema já aguenta os dois; a dúvida é se vale o trabalho na UI logo de cara.
- **Quantas questões por deck** — 15–20 parece o ponto certo pra uma sessão, mas só testando.
- **Export do Obsidian: baixar arquivo ou escrever direto no vault?** Baixar é zero-config e roda no navegador; escrever direto precisaria de File System Access API (Chrome-only, com permissão por sessão). Começar baixando.
- **`apps/` vs `pocs/`** — está em `apps/` pela intenção de uso contínuo, mas se virar protótipo descartável, mover é só um `git mv`.
