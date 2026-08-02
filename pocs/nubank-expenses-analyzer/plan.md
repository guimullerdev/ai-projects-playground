# Nubank Expenses Analyzer — Plano

## Objetivo
Analisar múltiplos CSVs de fatura do cartão de crédito Nubank (colocados em `csvs/`) e gerar um único relatório HTML estático, visualmente bonito, com gráficos, tabelas e resumos dos gastos.

## Entrada
- Arquivos CSV exportados do Nubank em `csvs/*.csv`, um por fatura/mês (formato padrão: `date,title,amount`).
- Podem existir várias faturas cobrindo meses diferentes — o script deve consolidar tudo.

## Abordagem
1. **Script Python** (`analyze.py`) lê todos os CSVs da pasta `csvs/`, concatena, normaliza:
   - Parseia datas, valores (positivo = gasto, negativo = estorno/pagamento).
   - Deduplica linhas idênticas caso um mês apareça em mais de um arquivo.
   - Categoriza gastos automaticamente por palavras-chave no título (ex: iFood/Rappi → Alimentação, Uber/99 → Transporte, Netflix/Spotify → Assinaturas, etc.), com categoria "Outros" como fallback.
2. **Cálculo de métricas**:
   - Total gasto por mês.
   - Total gasto por categoria.
   - Top 10 maiores gastos individuais.
   - Top estabelecimentos por soma gasta.
   - Média mensal, mês com maior/menor gasto.
   - Evolução mensal (série temporal).
3. **Geração do HTML** (`report.html`, gerado pelo script — não editado à mão):
   - Template com CSS embutido (visual moderno, dark/light).
   - Gráficos via Chart.js (CDN) ou embutido inline: linha (evolução mensal), pizza/barra (categorias), barra (top estabelecimentos).
   - Tabelas: maiores gastos, resumo por categoria, resumo por mês.
   - Cards de resumo no topo (total geral, média mensal, maior gasto, categoria dominante).
   - Todos os dados injetados como JSON no próprio HTML (self-contained, sem servidor).

## Estrutura de arquivos
```
nubank-expenses-analyzer/
├── plan.md
├── analyze.py          # script principal, lê csvs/ e gera report.html
├── csvs/                # usuário coloca os CSVs do Nubank aqui
└── report.html          # saída gerada (gitignored)
```

## Uso
```
python3 analyze.py
```
Gera `report.html` na raiz do projeto — abrir direto no navegador.

## Manutenção
Sempre que `analyze.py` for alterado (nova métrica, correção de cálculo, novo card) ou novos CSVs forem adicionados a `csvs/`, atualizar `summary.md` para refletir os números e a lógica atuais — ele não é regenerado automaticamente pelo script.

## Decisões em aberto
- Categorização por keywords é heurística simples; pode ser ajustada depois via um dicionário no topo do script.
- Sem dependências externas além de biblioteca padrão do Python (csv, json, datetime, collections) — HTML usa Chart.js via CDN.
