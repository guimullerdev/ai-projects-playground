# Budget Planner — Plano

## Objetivo
Página estática (`index.html`) de orçamento mensal por categoria (envelope budget): defino um limite de gasto por categoria, registro os gastos do mês à mão, e vejo barra de progresso gasto/limite por categoria — pra saber, no meio do mês, se ainda dá pra gastar em determinada categoria.

## Como funciona
- Tudo local: sem servidor, sem conta, dados ficam em `localStorage` do navegador (`budget-planner:v1`). Nada de financeiro é commitado no git.
- Categorias fixas, as mesmas do `nubank-expenses-analyzer` (`CATEGORY_KEYWORDS` em `analyze.py`), pra manter os dois POCs consistentes: Transporte, Alimentação, Assinaturas, Educação, Viagem, Compras, Saúde, Telecomunicações, Serviços, Encargos, Outros. Dá pra adicionar categoria custom pela UI.
- Cada gasto tem data, descrição, categoria e valor. O seletor de mês (topo) mostra o gasto acumulado daquele mês por categoria vs. o limite definido — os limites são os mesmos todo mês (não há limite "por mês", é uma meta recorrente).
- Barra de progresso por categoria: verde (<70% do limite), âmbar (70–100%), vermelho (>100%, estourou).

## Integração com nubank-expenses-analyzer
- Ao carregar, tenta injetar `../nubank-expenses-analyzer/report-data.js` (arquivo gitignored, só existe se `analyze.py` já rodou localmente). Se carregar, aparece o botão "Sugerir com base no histórico", que calcula a média mensal gasta por categoria nas faturas fechadas (mesma lógica do `avg_monthly` do analyze.py) e preenche os campos de limite — editável depois.
- Se o arquivo não existir (a maioria dos casos, fora da minha máquina com os CSVs), a página funciona normalmente só sem a sugestão automática; um aviso explica como habilitar.
- Isso é só sugestão de ponto de partida — não sincroniza gastos automaticamente. O registro do mês corrente continua manual (a fatura do Nubank fecha num ciclo diferente do calendário e envolve outros gastos além do cartão).

## Estrutura de arquivos
```
budget-planner/
├── plan.md
├── index.html
├── style.css        # mesmo design system dos outros POCs (variáveis --bg/--surface/--accent etc.)
└── script.js        # estado em localStorage, cálculo de progresso, integração opcional com report-data.js
```

## Decisões em aberto
- Sem exportar/importar dados entre dispositivos — é local ao navegador. Se precisar, dá pra adicionar export/import JSON depois.
- Limite é recorrente (mesmo valor todo mês), não por mês específico. Se um mês precisar de limite diferente (ex: viagem), ajustar manualmente antes/depois.
