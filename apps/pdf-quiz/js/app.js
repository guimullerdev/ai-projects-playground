/* Roteamento entre as três telas, carregamento e import de decks. */

(function () {
  var TECLAS = ['1', '2', '3', '4', '5'];

  var estado = {
    catalogo: [],      // entradas do decks/index.json
    importados: {},    // decks que vieram por arquivo, por id
    deck: null,        // deck carregado
    sessao: null,
    resultado: null    // resultado da última sessão, pro export do Obsidian
  };

  var el = {};
  ['tela-catalogo', 'tela-quiz', 'tela-resultado', 'catalogo', 'catalogo-aviso',
   'progresso', 'quiz-passo', 'quiz-streak', 'quiz-topico', 'quiz-enunciado',
   'quiz-alternativas', 'quiz-feedback', 'quiz-avancar', 'quiz-sair',
   'resultado-titulo', 'resultado-score', 'resultado-acertos', 'resultado-tempo',
   'resultado-topicos', 'resultado-erros', 'resultado-bloco-erros',
   'resultado-refazer-erros', 'resultado-refazer', 'resultado-catalogo',
   'resultado-exportar-erros', 'resultado-exportar-flashcards',
   'progresso-painel', 'progresso-fracos', 'progresso-vazio', 'progresso-resumo',
   'progresso-exportar', 'progresso-importar',
   'import', 'theme', 'dropzone'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  /* ---------- telas ---------- */

  function mostrar(tela) {
    ['tela-catalogo', 'tela-quiz', 'tela-resultado'].forEach(function (t) {
      el[t].hidden = t !== tela;
    });
    window.scrollTo(0, 0);
  }

  /* ---------- catálogo ---------- */

  function carregarCatalogo() {
    return fetch('decks/index.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        estado.catalogo = json.decks || [];
        aviso(null);
      })
      .catch(function () {
        // Sem servidor (file://) ou sem catálogo: o exemplo ainda pode estar lá.
        return fetch('decks/exemplo.json')
          .then(function (r) {
            if (!r.ok) throw new Error('sem exemplo');
            return r.json();
          })
          .then(function (deck) {
            estado.catalogo = [{
              id: deck.id,
              titulo: deck.titulo,
              arquivo: 'exemplo.json',
              total_questoes: deck.questoes.length
            }];
            aviso('Catálogo não encontrado — mostrando só o deck de exemplo. ' +
                  'Gere um deck com <code>prompts/gerar-deck.md</code> pra ele aparecer aqui.');
          })
          .catch(function () {
            estado.catalogo = [];
            aviso('Não consegui ler os decks. Abrir o arquivo direto pelo <code>file://</code> ' +
                  'bloqueia a leitura: rode <code>python3 -m http.server</code> na pasta do projeto ' +
                  'e abra por <code>localhost</code>, ou importe um <code>.json</code> pelo botão acima.');
          });
      })
      .then(desenharCatalogo);
  }

  function aviso(html) {
    el['catalogo-aviso'].hidden = !html;
    if (html) el['catalogo-aviso'].innerHTML = html;
  }

  /* Painel de fraquezas: soma todas as tentativas de todos os decks. Some
   * quando não há evidência — painel vazio no primeiro acesso é ruído. */
  function desenharProgresso() {
    var fracos = PQStorage.pontosFracos(2);
    var dados = PQStorage.lerTudo();
    var deckIds = Object.keys(dados);
    var tentativas = deckIds.reduce(function (t, id) { return t + (dados[id].tentativas || 0); }, 0);

    el['progresso-painel'].hidden = !tentativas;
    if (!tentativas) return;

    el['progresso-resumo'].textContent = tentativas +
      (tentativas === 1 ? ' tentativa em ' : ' tentativas em ') +
      deckIds.length + (deckIds.length === 1 ? ' deck' : ' decks');

    el['progresso-vazio'].hidden = fracos.length > 0;
    el['progresso-fracos'].innerHTML = '';

    fracos.slice(0, 6).forEach(function (f) {
      var proporcao = f.acertos / f.total;
      var li = document.createElement('li');
      li.className = 'topico' + (proporcao < 0.6 ? ' is-fraco' : '');

      var nome = document.createElement('span');
      nome.className = 'topico__nome';
      nome.textContent = f.topico;

      var placar = document.createElement('span');
      placar.className = 'topico__placar';
      placar.textContent = f.acertos + '/' + f.total;

      var trilho = document.createElement('span');
      trilho.className = 'topico__trilho' + (f.acertos === 0 ? ' is-zero' : '');
      var preenchido = document.createElement('span');
      preenchido.className = 'topico__preenchido';
      preenchido.style.display = 'block';
      preenchido.style.width = proporcao * 100 + '%';
      trilho.appendChild(preenchido);

      li.appendChild(nome);
      li.appendChild(placar);
      li.appendChild(trilho);

      if (f.decks.length > 1) {
        var decks = document.createElement('span');
        decks.className = 'topico__decks';
        decks.textContent = 'em ' + f.decks.length + ' decks';
        li.appendChild(decks);
      }

      el['progresso-fracos'].appendChild(li);
    });
  }

  function desenharCatalogo() {
    desenharProgresso();
    var lista = estado.catalogo.slice();
    Object.keys(estado.importados).forEach(function (id) {
      var jaTem = lista.some(function (d) { return d.id === id; });
      if (!jaTem) {
        var deck = estado.importados[id];
        lista.push({
          id: id,
          titulo: deck.titulo + ' (importado)',
          arquivo: null,
          total_questoes: deck.questoes.length
        });
      }
    });

    el.catalogo.innerHTML = '';
    if (!lista.length) return;

    lista.forEach(function (entrada) {
      var hist = PQStorage.lerDeck(entrada.id);
      var card = document.createElement('article');
      card.className = 'deck';

      var info = document.createElement('div');
      info.className = 'deck__info';

      var titulo = document.createElement('h2');
      titulo.className = 'deck__titulo';
      titulo.textContent = entrada.titulo;
      info.appendChild(titulo);

      var meta = document.createElement('p');
      meta.className = 'deck__meta';
      meta.textContent = descreverHistorico(entrada, hist);
      info.appendChild(meta);

      var acoes = document.createElement('div');
      acoes.className = 'deck__acoes';

      var comecar = document.createElement('button');
      comecar.className = 'btn';
      comecar.type = 'button';
      comecar.textContent = 'Começar';
      comecar.addEventListener('click', function () { iniciar(entrada, null); });
      acoes.appendChild(comecar);

      var erradas = hist ? hist.erradas : [];
      var soErros = document.createElement('button');
      soErros.className = 'btn btn--ghost';
      soErros.type = 'button';
      soErros.textContent = 'Só os que errei' + (erradas.length ? ' (' + erradas.length + ')' : '');
      soErros.disabled = !erradas.length;
      soErros.addEventListener('click', function () { iniciar(entrada, erradas); });
      acoes.appendChild(soErros);

      card.appendChild(info);
      card.appendChild(acoes);
      el.catalogo.appendChild(card);
    });
  }

  function descreverHistorico(entrada, hist) {
    var partes = [entrada.total_questoes + ' questões'];
    if (hist && hist.tentativas) {
      partes.push(hist.tentativas + (hist.tentativas === 1 ? ' tentativa' : ' tentativas'));
      partes.push('melhor: ' + hist.melhor_score + ' pts');
      if (hist.ultima) partes.push('última em ' + formatarData(hist.ultima));
    } else {
      partes.push('nunca jogado');
    }
    return partes.join(' · ');
  }

  function formatarData(iso) {
    var p = iso.split('-');
    return p.length === 3 ? p[2] + '/' + p[1] : iso;
  }

  /* ---------- carregar e iniciar ---------- */

  function iniciar(entrada, apenasIds) {
    var promessa = estado.importados[entrada.id]
      ? Promise.resolve(estado.importados[entrada.id])
      : fetch('decks/' + entrada.arquivo).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });

    promessa
      .then(function (deck) { abrir(deck, apenasIds); })
      .catch(function () {
        aviso('Não consegui carregar <code>' + entrada.arquivo + '</code>. ' +
              'Confira se o arquivo existe e se a página está sendo servida por <code>localhost</code>.');
      });
  }

  function abrir(deck, apenasIds) {
    var erro = PQQuiz.validar(deck);
    if (erro) {
      aviso('Deck inválido: ' + erro);
      mostrar('tela-catalogo');
      return;
    }

    var sessao = PQQuiz.criar(deck, apenasIds);
    if (!sessao) {
      aviso('Nenhuma questão para essa seleção.');
      return;
    }

    estado.deck = deck;
    estado.sessao = sessao;
    mostrar('tela-quiz');
    desenharQuestao();
  }

  /* ---------- quiz ---------- */

  function desenharQuestao() {
    var s = estado.sessao;
    var q = PQQuiz.atual(s);

    el.progresso.style.width = (s.indice / s.questoes.length) * 100 + '%';
    el['quiz-passo'].textContent = 'Questão ' + (s.indice + 1) + ' de ' + s.questoes.length;
    el['quiz-streak'].textContent = s.streak >= 2 ? s.streak + ' seguidas' : '';
    el['quiz-topico'].textContent = q.topico || '';
    el['quiz-enunciado'].textContent = q.enunciado;

    el['quiz-alternativas'].innerHTML = '';
    q.alternativas.forEach(function (alt, i) {
      var li = document.createElement('li');
      var botao = document.createElement('button');
      botao.className = 'alternativa';
      botao.type = 'button';
      botao.dataset.alt = alt.id;

      var tecla = document.createElement('span');
      tecla.className = 'alternativa__tecla';
      tecla.textContent = TECLAS[i] || alt.id;
      botao.appendChild(tecla);

      var texto = document.createElement('span');
      texto.textContent = alt.texto;
      botao.appendChild(texto);

      botao.addEventListener('click', function () { responder(alt.id); });
      li.appendChild(botao);
      el['quiz-alternativas'].appendChild(li);
    });

    el['quiz-feedback'].hidden = true;
    el['quiz-avancar'].hidden = true;
  }

  function responder(altId) {
    var s = estado.sessao;
    if (!s || PQQuiz.respondida(s)) return;

    var escolhida = PQQuiz.responder(s, altId);
    if (!escolhida) return;

    var q = PQQuiz.atual(s);
    var certa = q.alternativas.filter(function (a) { return a.correta; })[0];

    // Trava as alternativas e marca as duas que importam: a escolhida e a certa.
    Array.prototype.forEach.call(el['quiz-alternativas'].querySelectorAll('.alternativa'), function (botao) {
      botao.disabled = true;
      var id = botao.dataset.alt;
      if (id === certa.id) {
        botao.classList.add('is-correta');
        botao.querySelector('.alternativa__tecla').textContent = '✓';
      } else if (id === escolhida.id) {
        botao.classList.add('is-errada');
        botao.querySelector('.alternativa__tecla').textContent = '✗';
      }
    });

    desenharFeedback(escolhida, certa, q);

    el['quiz-streak'].textContent = s.streak >= 2 ? s.streak + ' seguidas' : '';
    el.progresso.style.width = ((s.indice + 1) / s.questoes.length) * 100 + '%';

    el['quiz-avancar'].hidden = false;
    el['quiz-avancar'].textContent = PQQuiz.ultima(s) ? 'Ver resultado' : 'Próxima';
    el['quiz-avancar'].focus();
  }

  /* A explicação da escolhida vem primeiro: é sobre ela que o raciocínio errado
   * ainda está fresco. A da correta entra logo abaixo, só quando errou. */
  function desenharFeedback(escolhida, certa, questao) {
    var box = el['quiz-feedback'];
    var acertou = Boolean(escolhida.correta);

    box.className = 'feedback ' + (acertou ? 'is-acerto' : 'is-erro');
    box.innerHTML = '';

    var veredito = document.createElement('p');
    veredito.className = 'feedback__veredito';
    veredito.textContent = acertou
      ? 'Acertou · +' + PQQuiz.peso(questao) + (PQQuiz.peso(questao) === 1 ? ' ponto' : ' pontos')
      : 'Errou';
    box.appendChild(veredito);

    box.appendChild(blocoExplicacao(
      acertou ? 'Por quê' : 'Por que a sua não serve',
      escolhida.explicacao
    ));

    if (!acertou) {
      box.appendChild(blocoExplicacao('A correta era "' + certa.texto + '"', certa.explicacao));
    }

    if (questao.referencia) {
      var ref = document.createElement('p');
      ref.className = 'feedback__referencia';
      ref.textContent = 'Revisar em: ' + questao.referencia;
      box.appendChild(ref);
    }

    box.hidden = false;
  }

  function blocoExplicacao(rotulo, texto) {
    var p = document.createElement('p');
    p.className = 'feedback__bloco';
    var forte = document.createElement('strong');
    forte.textContent = rotulo + ': ';
    p.appendChild(forte);
    p.appendChild(document.createTextNode(texto));
    return p;
  }

  function avancar() {
    var s = estado.sessao;
    if (!s || !PQQuiz.respondida(s)) return;
    if (PQQuiz.avancar(s)) {
      desenharQuestao();
    } else {
      finalizar();
    }
  }

  /* ---------- resultado ---------- */

  function finalizar() {
    var s = estado.sessao;
    var r = PQQuiz.resultado(s);
    PQStorage.registrarTentativa(s.deck.id, r);
    estado.resultado = r;

    el['resultado-titulo'].textContent = s.deck.titulo + (r.parcial ? ' — revisão dos erros' : '');
    el['resultado-score'].textContent = r.score + '/' + r.maxScore;
    el['resultado-acertos'].textContent = r.acertos + '/' + r.total +
      ' · ' + Math.round((r.acertos / r.total) * 100) + '%';
    el['resultado-tempo'].textContent = formatarTempo(r.segundos);

    desenharTopicos(r.topicos);
    desenharErros(r.erros);

    el['resultado-refazer-erros'].disabled = !r.erros.length;
    el['resultado-exportar-erros'].disabled = !r.erros.length;
    mostrar('tela-resultado');
  }

  function formatarTempo(segundos) {
    var min = Math.floor(segundos / 60);
    var seg = segundos % 60;
    return min ? min + 'min ' + seg + 's' : seg + 's';
  }

  function desenharTopicos(topicos) {
    el['resultado-topicos'].innerHTML = '';
    topicos.forEach(function (t) {
      var proporcao = t.acertos / t.total;
      var li = document.createElement('li');
      li.className = 'topico' + (proporcao < 0.6 ? ' is-fraco' : '');

      var nome = document.createElement('span');
      nome.className = 'topico__nome';
      nome.textContent = t.topico;

      var placar = document.createElement('span');
      placar.className = 'topico__placar';
      placar.textContent = t.acertos + '/' + t.total;

      var trilho = document.createElement('span');
      // Tópico zerado precisa ter forma: sem isso, "errei tudo" e "não caiu no
      // deck" desenham exatamente o mesmo trilho vazio.
      trilho.className = 'topico__trilho' + (t.acertos === 0 ? ' is-zero' : '');
      var preenchido = document.createElement('span');
      preenchido.className = 'topico__preenchido';
      preenchido.style.display = 'block';
      preenchido.style.width = proporcao * 100 + '%';
      trilho.appendChild(preenchido);

      li.appendChild(nome);
      li.appendChild(placar);
      li.appendChild(trilho);
      el['resultado-topicos'].appendChild(li);
    });
  }

  function desenharErros(erros) {
    el['resultado-bloco-erros'].hidden = !erros.length;
    el['resultado-erros'].innerHTML = '';

    erros.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'erro';

      var enunciado = document.createElement('p');
      enunciado.className = 'erro__enunciado';
      enunciado.textContent = r.questao.enunciado;
      li.appendChild(enunciado);

      var marcou = document.createElement('p');
      marcou.className = 'erro__linha';
      marcou.appendChild(rotulo('Marquei: '));
      marcou.appendChild(document.createTextNode(r.escolhida.texto + ' — ' + r.escolhida.explicacao));
      li.appendChild(marcou);

      var certa = document.createElement('p');
      certa.className = 'erro__linha';
      certa.appendChild(rotulo('Correta: '));
      certa.appendChild(document.createTextNode(r.correta.texto + ' — ' + r.correta.explicacao));
      li.appendChild(certa);

      if (r.questao.referencia) {
        var ref = document.createElement('p');
        ref.className = 'erro__referencia';
        ref.textContent = 'Revisar em: ' + r.questao.referencia;
        li.appendChild(ref);
      }

      el['resultado-erros'].appendChild(li);
    });
  }

  function rotulo(texto) {
    var forte = document.createElement('strong');
    forte.textContent = texto;
    return forte;
  }

  /* ---------- import ---------- */

  function importarArquivo(arquivo) {
    if (!arquivo) return;
    var leitor = new FileReader();
    leitor.onload = function () {
      var deck;
      try {
        deck = JSON.parse(leitor.result);
      } catch (e) {
        aviso('Esse arquivo não é um JSON válido.');
        mostrar('tela-catalogo');
        return;
      }
      var erro = PQQuiz.validar(deck);
      if (erro) {
        aviso('Deck inválido: ' + erro);
        mostrar('tela-catalogo');
        return;
      }
      estado.importados[deck.id] = deck;
      aviso(null);
      desenharCatalogo();
      abrir(deck, null);
    };
    leitor.readAsText(arquivo);
  }

  /* ---------- eventos ---------- */

  el['quiz-avancar'].addEventListener('click', avancar);

  el['quiz-sair'].addEventListener('click', function () {
    estado.sessao = null;
    desenharCatalogo();
    mostrar('tela-catalogo');
  });

  el['resultado-catalogo'].addEventListener('click', function () {
    desenharCatalogo();
    mostrar('tela-catalogo');
  });

  el['resultado-refazer'].addEventListener('click', function () {
    abrir(estado.deck, null);
  });

  el['resultado-refazer-erros'].addEventListener('click', function () {
    var ids = PQQuiz.resultado(estado.sessao).erradas;
    if (ids.length) abrir(estado.deck, ids);
  });

  el['resultado-exportar-erros'].addEventListener('click', function () {
    if (estado.deck && estado.resultado) PQExport.baixarErros(estado.deck, estado.resultado);
  });

  // Flashcards saem do deck inteiro, não só dos erros: o que eu acertei hoje é
  // justamente o que a repetição espaçada precisa reagendar pra daqui a semanas.
  el['resultado-exportar-flashcards'].addEventListener('click', function () {
    if (estado.deck) PQExport.baixarFlashcards(estado.deck, null);
  });

  el['progresso-exportar'].addEventListener('click', function () {
    var dados = PQStorage.lerTudo();
    if (!Object.keys(dados).length) {
      aviso('Não há progresso para exportar ainda.');
      return;
    }
    PQExport.baixarProgresso(dados);
  });

  /* Import de progresso substitui em vez de mesclar. Mesclar duas linhas do
   * tempo do mesmo deck exigiria inventar o que fazer com tentativas e
   * recordes concorrentes; restaurar backup é o caso real, e restaurar é
   * substituir. Por isso a confirmação diz exatamente o que se perde. */
  el['progresso-importar'].addEventListener('change', function (e) {
    var arquivo = e.target.files[0];
    e.target.value = '';
    if (!arquivo) return;

    var leitor = new FileReader();
    leitor.onload = function () {
      var lido = PQExport.lerProgresso(leitor.result);
      if (lido.erro) {
        aviso(lido.erro);
        return;
      }

      var atuais = Object.keys(PQStorage.lerTudo()).length;
      var chegando = Object.keys(lido.progresso).length;
      var pergunta = 'Substituir o progresso atual (' + atuais +
        (atuais === 1 ? ' deck' : ' decks') + ') pelo backup de ' + lido.exportado_em +
        ' (' + chegando + (chegando === 1 ? ' deck' : ' decks') + ')?';

      if (!window.confirm(pergunta)) return;

      PQStorage.substituirTudo(lido.progresso);
      aviso('Progresso restaurado do backup de ' + lido.exportado_em + '.');
      desenharCatalogo();
    };
    leitor.readAsText(arquivo);
  });

  el.import.addEventListener('change', function (e) {
    importarArquivo(e.target.files[0]);
    e.target.value = '';
  });

  // Atalhos: 1–5 escolhe, Enter avança. Só valem na tela do quiz.
  document.addEventListener('keydown', function (e) {
    if (el['tela-quiz'].hidden || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'Enter' || e.key === ' ') {
      if (PQQuiz.respondida(estado.sessao)) {
        e.preventDefault();
        avancar();
      }
      return;
    }

    var i = TECLAS.indexOf(e.key);
    if (i === -1 || PQQuiz.respondida(estado.sessao)) return;
    var alt = PQQuiz.atual(estado.sessao).alternativas[i];
    if (alt) {
      e.preventDefault();
      responder(alt.id);
    }
  });

  // Drag & drop: o overlay some quando o ponteiro sai da janela de verdade
  // (relatedTarget nulo), senão ele pisca a cada elemento que o cursor cruza.
  document.addEventListener('dragover', function (e) {
    e.preventDefault();
    el.dropzone.hidden = false;
  });

  document.addEventListener('dragleave', function (e) {
    if (!e.relatedTarget) el.dropzone.hidden = true;
  });

  document.addEventListener('drop', function (e) {
    e.preventDefault();
    el.dropzone.hidden = true;
    if (e.dataTransfer.files.length) importarArquivo(e.dataTransfer.files[0]);
  });

  el.theme.addEventListener('click', function () {
    var atualTema = document.documentElement.getAttribute('data-theme');
    var escuroPorPadrao = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var proximo = atualTema
      ? (atualTema === 'dark' ? 'light' : 'dark')
      : (escuroPorPadrao ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', proximo);
    try { localStorage.setItem('pdf-quiz:tema', proximo); } catch (err) { /* sem persistência, tudo bem */ }
  });

  try {
    var temaSalvo = localStorage.getItem('pdf-quiz:tema');
    if (temaSalvo) document.documentElement.setAttribute('data-theme', temaSalvo);
  } catch (err) { /* idem */ }

  carregarCatalogo();
})();
