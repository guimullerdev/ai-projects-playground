# Prompt — gerar deck do PDF Quiz

Cole isto numa sessão do Claude Code, junto com o caminho do PDF e o intervalo de páginas.

---

Leia `pdfs/<ARQUIVO>.pdf`, páginas `<INTERVALO>`, e escreva um deck de quiz em
`decks/<slug>.json`. Depois adicione o deck a `decks/index.json`.

**Leia o trecho inteiro antes de escrever a primeira questão.** Questão escrita
durante a leitura sai enviesada pelas primeiras páginas.

## Schema

```json
{
  "id": "<slug>",
  "titulo": "<Matéria> — <Capítulo/Seção>",
  "fonte": { "arquivo": "<ARQUIVO>.pdf", "paginas": "<INTERVALO>" },
  "gerado_em": "<YYYY-MM-DD>",
  "questoes": [
    {
      "id": "q1",
      "topico": "<um dos 4–6 tópicos do deck>",
      "dificuldade": "facil | media | dificil",
      "enunciado": "<a pergunta>",
      "alternativas": [
        { "id": "a", "texto": "<...>", "correta": false, "explicacao": "<...>" },
        { "id": "b", "texto": "<...>", "correta": true,  "explicacao": "<...>" }
      ],
      "referencia": "p. <N> — seção <X>"
    }
  ]
}
```

`id` do deck = nome do arquivo sem `.json`. `id` da questão = `q1`, `q2`, …
(único dentro do deck; é a chave que o histórico de erros guarda — não renumere
questão existente ao regerar).

## Regras que não podem ser quebradas

1. **Toda alternativa tem `explicacao`, inclusive a correta.** Deck com uma
   alternativa sem explicação está errado, mesmo que as perguntas estejam certas.
2. **Na alternativa errada, a explicação diz por que é errada e, quando der, o
   que ela realmente descreve.** Essa segunda metade é a que ensina: mostra o
   conceito vizinho que foi confundido, em vez de só negar.
   - ✅ "Esse é o comportamento no timeout, não nos ACKs duplicados. Três ACKs
     duplicados indicam que a rede ainda entrega pacotes, então o Reno usa fast
     recovery."
   - ❌ "Alternativa incorreta." / "Não é isso que o capítulo diz."
3. **Na correta, a explicação dá o mecanismo, não repete o enunciado.** O leitor
   precisa sair sabendo *por que*, pra acertar outra questão sobre o mesmo
   conceito.
4. **A questão sai do texto lido, não do que você sabe do assunto.** Se não dá
   pra apontar a página em `referencia`, a questão não entra.

## Distratores

3–5 alternativas. Todas tiradas do próprio PDF — conceitos vizinhos reais.

A régua: um distrator bom é **uma resposta que alguém daria se tivesse entendido
o conceito pela metade**. Distrator absurdo transforma a questão em
reconhecimento de padrão e não testa nada.

Proibido:
- "todas as anteriores" / "nenhuma das anteriores";
- alternativas que diferem só por uma palavra invertida ("é" vs "não é");
- correta visivelmente mais longa que as outras — equalize o tamanho, senão dá
  pra acertar sem ler;
- correta sempre na mesma posição — varie qual `id` é a verdadeira.

## Composição do deck

- **15–20 questões.** Se o trecho não dá isso, faça menos e diga; não invente.
- **4–6 tópicos, repetidos.** `topico` é o que alimenta o relatório de "onde eu
  erro mais" — tópico único por questão mata o relatório.
- **Dificuldade ≈ 30% `facil` / 50% `media` / 20% `dificil`.** Fácil é
  definição e reconhecimento; média é aplicação; difícil é comparação entre
  conceitos e caso de borda.
- Uma pergunta por enunciado. Evite "qual das alternativas **não**…" quando der
  pra escrever na afirmativa.
- Cubra o trecho inteiro, não só o começo.

## Ao terminar

1. Valide o JSON (`python3 -m json.tool decks/<slug>.json`).
2. Acrescente a entrada em `decks/index.json`:
   `{ "id": "<slug>", "titulo": "<...>", "arquivo": "<slug>.json", "total_questoes": <N> }`
3. Relate: quantas questões, quais tópicos, e o que do trecho ficou de fora.
