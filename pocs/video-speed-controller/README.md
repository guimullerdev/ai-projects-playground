# Video Speed Controller

Extensão de navegador (Manifest V3) para controlar a velocidade de reprodução de qualquer `<video>` na página.

## Funcionalidades

- Detecta automaticamente vídeos na página (inclusive os que aparecem depois, via `MutationObserver`).
- Badge com a velocidade atual sobre o vídeo, exibido ao passar o mouse ou ao alterar a velocidade.
- Atalhos de teclado (funcionam com foco na página, exceto em campos de texto):
  - `S` — diminui a velocidade em 0.1x
  - `D` — aumenta a velocidade em 0.1x
  - `R` — restaura para 1x
- Popup da extensão com slider, presets (0.5x a 4x) e botão de reset.
- Velocidade sincronizada entre abas via `chrome.storage.sync`.
- **Aceleração automática em anúncios do YouTube**: quando o player entra em estado de anúncio (classe `ad-showing`/`ad-interrupting` no `.html5-video-player`), a velocidade sobe automaticamente para 4x (configurável: 2x–16x) e volta para a velocidade normal assim que o anúncio termina. Pode ser desativado no popup.
  - Essa detecção é específica do YouTube, pois cada site marca anúncios de um jeito diferente no HTML — não há uma forma genérica e confiável de detectar "propaganda" em qualquer player de vídeo.
  - Enquanto o anúncio está ativo, a extensão também clica automaticamente no botão "Pular anúncio" assim que ele fica disponível (checagem a cada 500ms). Como esse clique usa o mesmo toggle de "aceleração automática" do popup, desativar essa opção também desliga o skip automático.

## Como instalar (modo desenvolvedor)

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o "Modo do desenvolvedor".
3. Clique em "Carregar sem compactação" e selecione a pasta `pocs/video-speed-controller`.
4. Abra qualquer página com vídeo (YouTube, Netflix, etc.) e use os atalhos `S`/`D`/`R` ou o popup da extensão.

## Estrutura

- `manifest.json` — configuração da extensão (MV3).
- `content.js` / `content.css` — script injetado nas páginas que aplica a velocidade e desenha o badge.
- `popup.html` / `popup.js` / `popup.css` — interface de controle rápido ao clicar no ícone da extensão.
