# Dollar Cost Analyzer — Plano

## Objetivo
Página estática (`index.html`) que mostra a cotação de compra/venda do dólar comercial dos últimos 30 dias, com um sinal automático ("vale a pena converter agora?") baseado só em dados históricos, além de um card de contexto de mercado com notícias recentes — pra usar antes de converter dólar recebido de fora via Husky.

## Como funciona hoje
- `index.html` + `style.css` + `script.js`: buscam a cotação ao vivo direto no navegador via [AwesomeAPI](https://docs.awesomeapi.com.br/api-de-moedas) (`economia.awesomeapi.com.br`, CORS liberado, sem chave). Isso roda sozinho, sem depender deste plano.
- `news-data.js`: arquivo estático gerado à mão (por mim, Claude) com um resumo do contexto de mercado e notícias recentes sobre o dólar/BRL. **Não é buscado ao vivo** — precisa ser regenerado manualmente rodando este plano, porque depende de busca na internet (WebSearch), que uma página estática não consegue fazer sozinha.

## Runbook — regenerar notícias e dados
Rodar sempre que o usuário pedir para "atualizar/regenerar as notícias e dados" desse POC.

1. **Cotação atual**: `curl -s https://economia.awesomeapi.com.br/json/last/USD-BRL` para pegar bid/ask/pctChange/timestamp do momento da geração.
2. **Buscar notícias recentes** (WebSearch, 2–3 buscas):
   - `"dólar hoje" cotação análise` (contexto imediato do dia)
   - `Copom Selic` ou `Federal Reserve juros` — o que estiver mais relevante na semana (política monetária BR/EUA costuma mover o câmbio)
   - Qualquer evento macro relevante da semana (eleição, fiscal, comércio exterior) se aparecer nas buscas acima
3. **Sintetizar** em 3–5 itens de notícia, cada um com: título curto, 1–2 frases de resumo, fonte (nome do veículo) e data. Preferir fontes primárias/veículos financeiros conhecidos (Valor, InfoMoney, Reuters, Bloomberg, Estadão/Broadcast).
4. **Escrever um outlook curto** (2–3 frases) combinando os dados históricos (`avg-7`, `avg-30`, posição na faixa de 30 dias — já calculados pelo `script.js`) com o que saiu nas notícias. Deixar claro que é uma leitura qualitativa, não recomendação financeira.
5. **Atualizar `news-data.js`** com o formato abaixo, sobrescrevendo o arquivo inteiro:
   ```js
   window.MARKET_NEWS = {
     generatedAt: "2026-08-03T19:30:00-03:00", // ISO, momento da geração
     outlook: "Resumo qualitativo de 2-3 frases combinando dados + notícias.",
     items: [
       {
         title: "Título curto da notícia",
         summary: "1-2 frases de resumo.",
         source: "Nome do veículo",
         date: "2026-08-02", // data da notícia, não da geração
       },
       // 3-5 itens
     ],
   };
   ```
6. Abrir `index.html` (ou dar refresh se já aberto) e conferir visualmente que o card "Contexto de mercado" carregou o novo conteúdo e a data de geração está certa.

## Estrutura de arquivos
```
dollar-cost-analyzer/
├── plan.md          # este arquivo
├── index.html
├── style.css
├── script.js        # busca cotação ao vivo (AwesomeAPI) + heurística de sinal
└── news-data.js      # gerado manualmente via este plano — notícias + outlook
```

## Decisões em aberto
- `news-data.js` fica versionado no git (não é dado pessoal, só um snapshot público de notícias) — mas fica desatualizado até alguém pedir pra regenerar. Sem automação/cron por enquanto.
- Cotação da Husky continua manual (sem API pública) — campo na sidebar pra comparar o spread.
