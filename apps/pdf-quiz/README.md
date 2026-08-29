# PDF Quiz

Transforma PDF de estudo em quiz jogável: a Claude lê o PDF e escreve um deck
JSON, e esta página joga o deck com pontuação, histórico e — o ponto central —
**explicação em cada alternativa, dizendo por que a errada é errada**.

Ver [plan.md](./plan.md) para o raciocínio completo e as fases seguintes
(histórico acumulado, export pro Obsidian, geração em lote).

## Rodar

```bash
python3 -m http.server 8000
```

Abrir <http://localhost:8000>. Não tem build, dependência nem chave de API.

O servidor é necessário porque `fetch()` de arquivo local é bloqueado no
`file://`. Sem ele a página abre, mas só dá pra jogar via **Importar deck**.

## Gerar um deck

1. Colocar o PDF em `pdfs/` (pasta gitignored).
2. Numa sessão do Claude Code, usar o prompt de
   [`prompts/gerar-deck.md`](./prompts/gerar-deck.md), preenchendo o arquivo e o
   intervalo de páginas.
3. A Claude escreve `decks/<slug>.json` e acrescenta a entrada em
   `decks/index.json`. Recarregar a página.

**Um deck por capítulo ou seção**, não por livro: a leitura do PDF vai em blocos
de ~10–20 páginas, e 15–20 questões é o tamanho de uma sessão que se termina.

## Jogar

- **Catálogo** — um card por deck, com melhor pontuação e data da última
  tentativa. **Só os que errei** fica disponível quando há erros guardados.
- **Quiz** — uma questão por vez, feedback imediato. A explicação da alternativa
  que você marcou aparece primeiro; se errou, a da correta vem logo abaixo.
  Atalhos: `1`–`5` escolhe, `Enter` avança.
- **Resultado** — pontos, % de acerto, tempo, quebra por tópico (pior primeiro) e
  a lista do que revisar, com a referência de cada erro.

Pontuação: acerto vale o peso da dificuldade (fácil 1, média 2, difícil 3), pra
deck fácil não inflar o número. Sem penalidade por erro.

## Histórico

Fica em `localStorage`, chave `pdf-quiz:v1`: tentativas, melhor pontuação, data
da última e o conjunto de questões erradas — que é o que alimenta o "só os que
errei". Questão acertada numa tentativa seguinte sai do conjunto.

Nada sai da máquina: sem backend, sem telemetria, sem request pra fora.

## O que não vai pro git

`pdfs/` (peso e direito autoral) e os decks gerados (material derivado do livro).
A exceção é `decks/exemplo.json`, commitado pra página nunca abrir vazia — ele é
escrito à mão, não gerado de PDF nenhum.

`decks/index.json` também fica de fora, porque muda a cada deck local. Quando
ele não existe, a página cai no exemplo.
