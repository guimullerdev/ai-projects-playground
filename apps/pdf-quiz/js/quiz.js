/* Estado de uma sessão de quiz: pontuação, streak e o que foi respondido.
 * Não toca no DOM nem no localStorage — app.js desenha, storage.js persiste. */

var PQQuiz = (function () {
  var PESOS = { facil: 1, media: 2, dificil: 3 };

  function peso(questao) {
    return PESOS[questao.dificuldade] || PESOS.media;
  }

  /* Valida o deck na entrada, porque ele é escrito por um modelo de linguagem:
   * é mais barato recusar aqui, com o motivo, do que descobrir na tela 2 que
   * uma alternativa não tem explicação. */
  function validar(deck) {
    if (!deck || typeof deck !== 'object') return 'Arquivo não é um objeto JSON.';
    if (!deck.id) return 'Falta o campo "id".';
    if (!Array.isArray(deck.questoes) || !deck.questoes.length) return 'Deck sem questões.';

    for (var i = 0; i < deck.questoes.length; i++) {
      var q = deck.questoes[i];
      var onde = 'Questão ' + (q.id || i + 1);
      if (!q.enunciado) return onde + ': falta o enunciado.';
      if (!Array.isArray(q.alternativas) || q.alternativas.length < 2) {
        return onde + ': precisa de pelo menos duas alternativas.';
      }
      var corretas = 0;
      for (var j = 0; j < q.alternativas.length; j++) {
        var alt = q.alternativas[j];
        if (!alt.texto) return onde + ': alternativa sem texto.';
        if (!alt.explicacao) return onde + ', alternativa ' + (alt.id || j + 1) + ': sem explicação.';
        if (alt.correta) corretas++;
      }
      if (corretas === 0) return onde + ': nenhuma alternativa marcada como correta.';
      // Múltipla resposta cabe no schema, mas a UI do v1 é de resposta única.
      if (corretas > 1) return onde + ': mais de uma correta — o v1 ainda não joga múltipla resposta.';
    }
    return null;
  }

  /* `apenasIds` limita a sessão a um subconjunto — é o "só os que errei". */
  function criar(deck, apenasIds) {
    var questoes = deck.questoes;
    if (apenasIds && apenasIds.length) {
      questoes = questoes.filter(function (q) { return apenasIds.indexOf(q.id) !== -1; });
    }
    if (!questoes.length) return null;

    return {
      deck: deck,
      questoes: questoes,
      parcial: Boolean(apenasIds && apenasIds.length),
      indice: 0,
      escolhida: null,
      score: 0,
      maxScore: questoes.reduce(function (t, q) { return t + peso(q); }, 0),
      streak: 0,
      melhorStreak: 0,
      inicio: Date.now(),
      fim: null,
      respostas: []
    };
  }

  function atual(sessao) {
    return sessao.questoes[sessao.indice];
  }

  function respondida(sessao) {
    return sessao.escolhida !== null;
  }

  function correta(questao) {
    return questao.alternativas.filter(function (a) { return a.correta; })[0];
  }

  /* Uma resposta por questão: chamada repetida é ignorada, senão dois cliques
   * rápidos (ou um clique junto com a tecla) contariam duas vezes no score. */
  function responder(sessao, altId) {
    if (respondida(sessao)) return null;

    var questao = atual(sessao);
    var escolhida = questao.alternativas.filter(function (a) { return a.id === altId; })[0];
    if (!escolhida) return null;

    sessao.escolhida = escolhida;

    if (escolhida.correta) {
      sessao.score += peso(questao);
      sessao.streak++;
      sessao.melhorStreak = Math.max(sessao.melhorStreak, sessao.streak);
    } else {
      sessao.streak = 0;
    }

    sessao.respostas.push({
      questao: questao,
      escolhida: escolhida,
      correta: correta(questao),
      acertou: Boolean(escolhida.correta)
    });

    return sessao.escolhida;
  }

  function ultima(sessao) {
    return sessao.indice >= sessao.questoes.length - 1;
  }

  function avancar(sessao) {
    if (ultima(sessao)) {
      sessao.fim = Date.now();
      return false;
    }
    sessao.indice++;
    sessao.escolhida = null;
    return true;
  }

  /* Agrupa por tópico — é a resposta pra "onde eu erro mais", e o motivo de o
   * prompt exigir poucos tópicos repetidos por deck. */
  function porTopico(sessao) {
    var mapa = {};
    sessao.respostas.forEach(function (r) {
      var nome = r.questao.topico || 'Sem tópico';
      if (!mapa[nome]) mapa[nome] = { topico: nome, total: 0, acertos: 0 };
      mapa[nome].total++;
      if (r.acertou) mapa[nome].acertos++;
    });
    return Object.keys(mapa)
      .map(function (k) { return mapa[k]; })
      .sort(function (a, b) {
        // Pior aproveitamento primeiro: o relatório existe pra mostrar onde doer.
        return a.acertos / a.total - b.acertos / b.total;
      });
  }

  function resultado(sessao) {
    var erradas = sessao.respostas.filter(function (r) { return !r.acertou; });
    var acertadas = sessao.respostas.filter(function (r) { return r.acertou; });
    return {
      score: sessao.score,
      maxScore: sessao.maxScore,
      acertos: acertadas.length,
      total: sessao.respostas.length,
      segundos: Math.round(((sessao.fim || Date.now()) - sessao.inicio) / 1000),
      melhorStreak: sessao.melhorStreak,
      parcial: sessao.parcial,
      topicos: porTopico(sessao),
      erros: erradas,
      erradas: erradas.map(function (r) { return r.questao.id; }),
      acertadas: acertadas.map(function (r) { return r.questao.id; })
    };
  }

  return {
    validar: validar,
    criar: criar,
    atual: atual,
    respondida: respondida,
    responder: responder,
    avancar: avancar,
    ultima: ultima,
    resultado: resultado,
    peso: peso
  };
})();
