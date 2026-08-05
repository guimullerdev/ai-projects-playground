# YouTube Subscriptions Tracker

Extensão de navegador (Manifest V3) que mostra quais canais do YouTube em que você é inscrito têm vídeos novos — sem precisar de API key ou OAuth.

## Como funciona

1. **Importar inscrições**: ao abrir `youtube.com/feed/channels` (já logado), um content script lê a lista de canais inscritos exibida na página (nome, avatar e ID do canal) e salva localmente (`chrome.storage.local`).
2. **Checar vídeos novos**: um alarme roda a cada 30 minutos (e também ao clicar em "↻" no popup) e consulta o **feed RSS público** de cada canal (`youtube.com/feeds/videos.xml?channel_id=...`), que não exige autenticação nem API key. O vídeo mais recente do feed é comparado com o último visto.
3. **Popup**: lista os canais, destacando em azul + com um ponto vermelho os que têm vídeo novo desde a última vez que você viu. O badge do ícone mostra a contagem. Clicar em um canal abre o vídeo mais recente e marca como visto.

## Como instalar (modo desenvolvedor)

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o "Modo do desenvolvedor".
3. Clique em "Carregar sem compactação" e selecione a pasta `pocs/youtube-subscriptions-tracker`.
4. Abra `https://www.youtube.com/feed/channels` para importar suas inscrições (deixe a página carregar/role até o fim para pegar todas).
5. Clique no ícone da extensão para ver a lista e os vídeos novos.

## Limitações conhecidas

- A importação da lista de inscritos depende do HTML da página `feed/channels`, que o YouTube pode mudar a qualquer momento — se parar de detectar canais, os seletores em `content.js` provavelmente precisam de ajuste.
- Canais que publicam vídeos com muita frequência só têm o **vídeo mais recente** verificado (o feed RSS traz os últimos ~15, mas só o primeiro é usado).
- Não distingue lives/shorts de vídeos normais — o feed RSS trata tudo como entrada.
- Sem OAuth, não há como marcar "visto" diretamente na conta do YouTube; o estado é local à extensão.

## Estrutura

- `manifest.json` — configuração da extensão (MV3).
- `content.js` — script injetado em `youtube.com/feed/channels` que extrai a lista de canais inscritos.
- `background.js` — service worker: mescla canais recebidos, consulta os feeds RSS periodicamente, atualiza o badge.
- `popup.html` / `popup.js` / `popup.css` — interface que lista os canais e destaca os com vídeo novo.
