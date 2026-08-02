# Nubank Expenses Analyzer

Analisa CSVs de fatura do cartão de crédito Nubank e gera um relatório HTML único, com gráficos, tabelas e resumos de gastos — tudo local, sem servidor nem dependências externas além de Python padrão.

## Uso

1. Exporte suas faturas do app do Nubank em CSV (uma por fatura) e coloque os arquivos em `csvs/`.
2. Rode:
   ```
   python3 analyze.py
   ```
3. Abra `report.html` no navegador.

Repita sempre que adicionar novas faturas em `csvs/`.

## O que o relatório mostra

- Cards de resumo: total gasto, média por fatura fechada, estornos, fatura com maior/menor gasto, categoria dominante, parcelas em aberto, gasto com Uber e Preply.
- Evolução de gastos por fatura (gráfico de linha) — a fatura mais recente é marcada como "em aberto" quando o ciclo ainda não fechou.
- Gasto por categoria (gráfico de rosca), com cores fixas por categoria em todo o relatório.
- Previsão de gastos futuros: detecta compras parceladas ("Parcela X/Y") ainda em aberto e projeta o valor restante nos próximos meses.
- Maiores gastos individuais e top estabelecimentos.
- Tabela completa de transações, com busca por descrição e filtro por categoria/mês.

## Como funciona (`analyze.py`)

- Lê todos os CSVs de `csvs/` (formato `date,title,amount`, decimal com vírgula).
- Cada CSV é uma fatura (ciclo ~dia 10 ao dia 9 do mês seguinte, não mês-calendário) — os totais são agrupados por fatura, não por data da transação.
- O total de cada fatura é **líquido** (compras menos estornos do próprio ciclo), igual ao que o Nubank mostra.
- Exclui linhas que não são gasto real: "Pagamento recebido" (pagamento da fatura) e "Valor pendente do mês anterior" (saldo residual repassado).
- Detecta automaticamente se a fatura mais recente ainda está em aberto (ciclo não fechado) e a exclui das comparações de média/maior/menor gasto, mantendo-a visível no gráfico.
- Categoriza gastos por palavras-chave no título (dicionário `CATEGORY_KEYWORDS` no topo do script) — ajuste ali para reclassificar estabelecimentos.
- Deduplica linhas idênticas (mesma data, descrição e valor) para evitar contagem dupla caso um CSV seja reexportado.

## Estrutura

```
nubank-expenses-analyzer/
├── plan.md          # plano original do projeto
├── analyze.py       # script principal — lê csvs/ e gera report.html
├── summary.md        # resumo textual dos achados (mantido manualmente, ver plan.md)
├── csvs/              # CSVs do Nubank (gitignored — dados financeiros pessoais)
└── report.html        # relatório gerado (gitignored)
```

`csvs/*.csv`, `report.html` e `summary.md` estão no `.gitignore` por conterem dados financeiros pessoais.

## Manutenção

Depois de mudar `analyze.py` ou adicionar novos CSVs, atualize `summary.md` com os números e a lógica atuais (ver `plan.md`).
