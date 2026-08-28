# PDF Quiz — Plano

## Objetivo
Transformar PDFs de estudo em quizzes jogáveis: eu jogo os PDFs numa pasta, a Claude lê e gera arquivos JSON com perguntas de múltipla escolha, e um front estático consome esses JSONs com pontuação, progresso e — o ponto central — **explicação em cada alternativa errada dizendo por que ela é errada**.

Fica em `apps/` (não em `pocs/`) porque a intenção é usar de verdade pra estudar ao longo do tempo, com histórico de acertos acumulando — não é um protótipo pra olhar uma vez e abandonar.

## Por que existe
Ler PDF é passivo: dá a sensação de que entendeu, mas não testa nada. Quiz com feedback imediato força a recuperação ativa. E a parte que realmente ensina não é acertar — é errar e entender *por que* aquela alternativa que parecia certa não era. Por isso o schema exige explicação por alternativa, não só por questão.

## Como funciona (pipeline)

```
pdfs/*.pdf  ──►  Claude lê e gera  ──►  decks/*.json  ──►  front estático joga
 (gitignored)      (prompt fixo)         (perguntas)        (pontuação + histórico)
```

1. **Colocar o PDF** em `pdfs/` (pasta gitignored — material de estudo é pesado e geralmente tem direito autoral).
2. **Gerar o deck**: pedir pra Claude Code ler o PDF e escrever o JSON, usando o prompt versionado em `prompts/gerar-deck.md`. Sem API, sem script, sem dependência — a própria sessão do Claude Code lê o PDF e escreve o arquivo.
   - Limite prático: leitura de PDF vai em blocos de ~10–20 páginas por vez. Então **um deck por capítulo/seção**, não um deck gigante por livro. Isso também é melhor pedagogicamente (sessão de 15–20 questões).
3. **Jogar**: abrir `index.html`, escolher o deck no catálogo, responder.

## Schema do JSON (contrato entre a Claude e o front)

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

Regras do schema, que o prompt de geração precisa garantir:

- **Toda** alternativa tem `explicacao`, inclusive a correta. Na errada, a explicação diz *por que é errada* e, quando dá, *o que ela realmente descreve* (isso é o que mais ensina: mostra o conceito vizinho que foi confundido).
- `correta` é booleano por alternativa — permite questão de múltipla resposta depois sem quebrar o formato.
- 3–5 alternativas por questão. Distratores tirados do próprio PDF (conceitos vizinhos reais), nunca opções obviamente absurdas.
- `topico` é o que alimenta o relatório de "onde eu erro mais", então precisa ser consistente dentro do deck (poucos tópicos, repetidos).
- `referencia` aponta pra onde revisar no PDF — sem isso o erro vira beco sem saída.
- `decks/index.json` lista os decks disponíveis (`id`, `titulo`, `arquivo`, `total_questoes`) pro catálogo não precisar adivinhar o que existe.

## Front

Página estática, HTML + CSS + JS puro, sem framework nem build — mesmo padrão dos outros projetos do repo, e reaproveitando o design system já existente (variáveis `--bg`/`--surface`/`--accent`/`--up`/`--down`, dark mode via `prefers-color-scheme` + toggle `data-theme`).

**Três telas, uma página só:**

1. **Catálogo** — card por deck com título, nº de questões, melhor pontuação e data da última tentativa. Botões: "Começar" e "Só os que errei".
2. **Quiz** — uma questão por vez, barra de progresso no topo, alternativas clicáveis.
   - Ao responder: feedback **imediato**. A alternativa escolhida fica verde ou vermelha, a correta é revelada, e a explicação da alternativa escolhida aparece embaixo. Se errou, mostra também a explicação da correta.
   - Feedback imediato (e não só no final) é escolha deliberada: a explicação chega no momento em que o raciocínio errado ainda está fresco na cabeça.
   - Atalhos de teclado: `1`–`5` pra escolher, `Enter` pra avançar.
3. **Resultado** — pontuação, % de acerto, tempo, e **quebra por tópico** (onde errou mais). Lista das questões erradas com enunciado + explicação, pra revisar tudo de uma vez. Botões: "Refazer só os erros" / "Refazer tudo" / "Voltar ao catálogo".

**Pontuação:**
- Score da sessão = acertos, mas ponderado por dificuldade (fácil 1, média 2, difícil 3) — evita que deck fácil infle o número.
- Streak de acertos seguidos, visível durante o quiz.
- Histórico por deck em `localStorage` (`pdf-quiz:v1`): tentativas, melhor score, e um set de IDs de questões erradas — é isso que alimenta o modo "só os que errei".

## Como o front carrega os JSONs

Detalhe prático que morde: `fetch()` de arquivo local falha por CORS quando a página é aberta direto por `file://`. Duas saídas, as duas implementadas:

- **Servidor local** (caminho normal): `python3 -m http.server` na pasta do projeto e abrir via `localhost`. `fetch('decks/index.json')` funciona.
- **Importar deck** (fallback e uso avulso): botão + drag & drop de `.json` na página. Serve pra abrir no `file://` sem servidor e pra jogar deck que não está commitado.

## Estrutura de arquivos (proposta)

```
apps/pdf-quiz/
├── plan.md            # este arquivo
├── README.md          # como gerar deck e como rodar
├── pdfs/              # material de estudo
├── prompts/
│   └── gerar-deck.md  # prompt versionado: schema + regras dos distratores e explicações
├── decks/
│   ├── index.json     # catálogo
│   └── exemplo.json   # deck de amostra, pra página nunca abrir vazia
├── index.html
├── style.css
└── js/
    ├── app.js         # roteamento entre as três telas, carregamento/import de decks
    ├── quiz.js        # estado da sessão, pontuação, streak, modo "só os erros"
    └── storage.js     # histórico em localStorage
```

## Fases

**v1 — o loop completo, manual**
Schema + `prompts/gerar-deck.md` + um deck real gerado de um PDF meu + as três telas + pontuação + histórico em localStorage. É o suficiente pra já estudar de verdade.

**v2 — repetição**
Modo "só os que errei" acumulado entre sessões (não só dentro de uma), relatório de tópicos fracos somando todas as tentativas, e export/import do progresso em JSON (pra não perder se limpar o navegador).

**v3 — geração em lote**
Script Node usando a API da Claude com suporte a PDF pra processar um livro inteiro de uma vez, capítulo por capítulo, sem eu pedir deck por deck. Só vale a pena quando o volume justificar.

**v4 — se der vontade**
Modo simulado com timer e ordem embaralhada, repetição espaçada leve (SM-2 simplificado por questão), e questões dissertativas curtas com a Claude corrigindo.

## Versionamento

O plano e o código vão pro git. **Os PDFs e os decks gerados, não** — `pdfs/` fica de fora por peso e direito autoral, e `decks/` pelo mesmo motivo, já que questão gerada de um livro é material derivado. A exceção é `decks/exemplo.json`, commitado pra página nunca abrir vazia.

Quando o código do v1 entrar, isso vira um `.gitignore` na pasta.

## Decisões em aberto

- **Nome** — "PDF Quiz" é descritivo demais, provisório.
- **Múltipla resposta e V/F** no v1 ou só questão de resposta única? O schema já aguenta os dois; a dúvida é se vale o trabalho na UI logo de cara.
- **Quantas questões por deck** — 15–20 parece o ponto certo pra uma sessão, mas só testando.
- **`apps/` vs `pocs/`** — está em `apps/` pela intenção de uso contínuo, mas se na prática virar protótipo descartável, mover pra `pocs/` é só um `git mv`.
