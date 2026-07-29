# Color Picker

Extensão de navegador (Manifest V3) para capturar a cor de qualquer elemento na tela, sem precisar abrir o DevTools.

## Funcionalidades

- Botão "Selecionar cor na tela" abre a lupa de captura nativa do navegador ([`EyeDropper` API](https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper)): basta mirar em qualquer pixel da tela (mesmo fora do popup, em qualquer app) e clicar.
- Mostra a cor capturada como amostra visual, em `HEX` e `RGB`.
- Botão "Copiar" em cada valor (usa a área de transferência do sistema).
- Histórico das últimas 16 cores capturadas (persistido via `chrome.storage.local`), com opção de limpar.
- Aviso automático caso o navegador não suporte a `EyeDropper` API.

## Como instalar (modo desenvolvedor)

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o "Modo do desenvolvedor".
3. Clique em "Carregar sem compactação" e selecione a pasta `pocs/color-picker`.
4. Clique no ícone da extensão, depois em "Selecionar cor na tela" e mire no elemento desejado.

> A `EyeDropper` API é suportada em Chrome/Edge 95+ (baseados em Chromium). Não há suporte no Firefox/Safari no momento.

## Estrutura

- `manifest.json` — configuração da extensão (MV3), sem content script: tudo roda no popup.
- `popup.html` / `popup.js` / `popup.css` — interface com o botão de captura, exibição HEX/RGB, cópia e histórico.
