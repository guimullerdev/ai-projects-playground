# Simulador de Financiamento (SAC/Price)

Aplicação web single-page, 100% client-side (HTML + CSS + JavaScript puro, sem frameworks nem dependências externas), para simular e acompanhar financiamentos com os sistemas SAC e Price. Todos os dados ficam salvos no navegador via IndexedDB.

## Como usar

Não há build nem servidor. Basta abrir `index.html` diretamente no navegador, ou servir a pasta com qualquer servidor estático simples, por exemplo:

```
npx serve pocs/financing-simulator
```

ou

```
python3 -m http.server --directory pocs/financing-simulator
```

## Funcionalidades

- Cadastro de múltiplos financiamentos (nome, valor do bem, entrada, valor financiado, CET anual, prazo, sistema SAC ou Price, data da 1ª parcela, encargos mensais opcionais).
- Tabela de parcelas completa (saldo inicial, amortização, juros, parcela, saldo final), com marcação de parcela paga/pendente.
- Amortização extraordinária: registre um pagamento extra numa parcela de referência e escolha entre **reduzir prazo** (mantém a força da parcela) ou **reduzir parcela** (mantém o prazo original). O histórico de amortizações extras pode ser removido a qualquer momento, recalculando a tabela automaticamente.
- Dashboard com saldo devedor atual, total pago, juros pagos, amortizado extra, progresso e economia de tempo/juros gerada pelas amortizações extras.
- Gráficos nativos em `<canvas>`: evolução do saldo devedor (com comparação ao cenário sem amortizações extras) e composição juros x amortização por parcela.
- Comparador lado a lado SAC x Price para os mesmos parâmetros.
- Simulação reversa: informe a parcela máxima do orçamento e veja o prazo necessário (sistema Price).
- Exportar tabela de parcelas em CSV e modo de impressão.
- Backup/restore completo em JSON (útil já que os dados só existem localmente no navegador).
- Tema claro/escuro (segue a preferência do sistema por padrão, com alternância manual).

## Estrutura

```
index.html        Markup das telas (lista, formulário, dashboard)
styles.css         Estilo (tema claro/escuro via CSS custom properties)
js/calc.js         Fórmulas financeiras: SAC, Price, conversão de CET, amortização extra
js/storage.js       Persistência em IndexedDB + preferência de tema em localStorage
js/charts.js        Gráficos em canvas nativo
js/ui.js            Renderização das telas e eventos
```

## Notas de cálculo

- Toda a matemática monetária roda em centavos (inteiros) internamente, evitando erros de ponto flutuante ao longo de centenas de parcelas.
- A última parcela de cada "segmento" (entre uma amortização extra e a seguinte, ou até a quitação) absorve o resíduo de arredondamento, garantindo que a soma das amortizações feche exatamente com o valor financiado.
- Amortização extra com modo "reduzir prazo": no SAC, mantém a amortização mensal aproximadamente constante e recalcula quantos meses restam; no Price, mantém o valor da parcela e recalcula o prazo restante.
- Amortização extra com modo "reduzir parcela": mantém o número de parcelas restantes original e recalcula uma parcela (ou amortização mensal, no SAC) menor.

## Testes

`js/calc.js` é lógica pura (sem DOM/IndexedDB), então é coberto por testes unitários usando o test runner nativo do Node (`node:test`), sem dependências externas:

```
npm test
```

`js/storage.js`, `js/charts.js` e `js/ui.js` dependem de APIs de navegador (IndexedDB, canvas, DOM) e são verificados manualmente pela interface.

## Dados

Os financiamentos ficam salvos no IndexedDB do navegador (banco `financingSimulatorDB`). Limpar os dados de navegação do site apaga essas informações — use o botão **Exportar** para gerar um backup em JSON regularmente.
