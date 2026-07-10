# Commit Streak

App de menu bar (macOS) que varre seus repositórios git locais e te lembra de
commitar antes do dia acabar. Ver [plan.md](./plan.md) para o raciocínio
completo por trás de cada decisão.

## v1 (este estado)

- Scanner: descobre repos em `~/Documents/Github` (configurável), lê
  `git log --all --no-merges` por autor, dedupe global por hash.
- Cache incremental em `~/Library/Application Support/commit-streak/`.
- Tray de menu bar com três estados (●/○/⊙) + streak no título.
- Notificações escalonadas (19h / 21h30 / 23h) — nenhuma dispara se você já
  commitou hoje.
- Popover com streak atual, maior streak e os commits de hoje.

Ainda não tem: janela completa, heatmap, painel de lacunas (v2/v3 do
`plan.md`).

## Rodar em dev

```bash
npm install
npm start
```

## Configuração

Na primeira execução, `~/Library/Application Support/commit-streak/config.json`
é criado com valores default (autor detectado do `git config` global, raiz
`~/Documents/Github`, dia lógico começando às 4h). Edite o arquivo e reinicie
o app pra aplicar.
