/* Saídas do quiz: markdown pro Obsidian e o backup do progresso.
 *
 * Tudo aqui gera string e baixa arquivo — nada de caminho de vault no código,
 * nada de API, nada de plugin. Eu escolho onde salvar. É o que mantém a
 * integração com o Obsidian como destino, e não como dependência. */

var PQExport = (function () {

  function baixar(nome, conteudo, tipo) {
    var blob = new Blob([conteudo], { type: (tipo || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoga no próximo tick: revogar na mesma volta cancela o download no Safari.
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function hoje() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function diaMes(iso) {
    var p = iso.split('-');
    return p[2] + '/' + p[1];
  }

  /* Nota de erros — o formato que faz o vault responder "onde eu erro mais".
   *
   * O tópico vira [[wikilink]] de propósito: o backlink do Obsidian passa a
   * juntar todas as sessões em que errei naquele conceito, atravessando decks e
   * livros, sem eu escrever agregação nenhuma. */
  function notaErros(deck, resultado) {
    var data = hoje();
    var linhas = [];

    linhas.push('---');
    linhas.push('deck: ' + deck.id);
    linhas.push('data: ' + data);
    linhas.push('acertos: ' + resultado.acertos + '/' + resultado.total);
    if (deck.fonte && deck.fonte.arquivo) linhas.push('fonte: ' + deck.fonte.arquivo);
    linhas.push('tags: [pdf-quiz]');
    linhas.push('---');
    linhas.push('');
    linhas.push('# ' + deck.titulo + ' — erros de ' + diaMes(data));
    linhas.push('');

    if (!resultado.erros.length) {
      linhas.push('Nenhum erro nesta sessão.');
      return linhas.join('\n') + '\n';
    }

    // Agrupa por tópico pra nota não virar lista solta: é o agrupamento que
    // transforma o [[link]] em algo com conteúdo embaixo.
    var porTopico = {};
    var ordem = [];
    resultado.erros.forEach(function (r) {
      var nome = r.questao.topico || 'Sem tópico';
      if (!porTopico[nome]) { porTopico[nome] = []; ordem.push(nome); }
      porTopico[nome].push(r);
    });

    ordem.forEach(function (nome) {
      linhas.push('## [[' + nome + ']]');
      linhas.push('');
      porTopico[nome].forEach(function (r) {
        linhas.push('**' + r.questao.enunciado + '**');
        linhas.push('');
        linhas.push('Marquei: *' + r.escolhida.texto + '*');
        linhas.push('→ ' + r.escolhida.explicacao);
        linhas.push('');
        linhas.push('Certa: *' + r.correta.texto + '*');
        linhas.push('→ ' + r.correta.explicacao);
        if (r.questao.referencia) {
          var fonte = deck.fonte && deck.fonte.arquivo ? '`' + deck.fonte.arquivo + '` ' : '';
          linhas.push('');
          linhas.push('Revisar: ' + fonte + r.questao.referencia);
        }
        linhas.push('');
      });
    });

    return linhas.join('\n').replace(/\n+$/, '\n');
  }

  /* Flashcards no formato do plugin obsidian-spaced-repetition (pergunta, `?`
   * sozinho na linha, resposta).
   *
   * É o que dispensa implementar SM-2 aqui: agendamento, fila do dia e
   * persistência entre dispositivos já são problema do plugin. Este app faz o
   * que ele não faz — múltipla escolha com explicação por alternativa. */
  function flashcards(deck, apenasIds) {
    var questoes = deck.questoes;
    if (apenasIds && apenasIds.length) {
      questoes = questoes.filter(function (q) { return apenasIds.indexOf(q.id) !== -1; });
    }

    var linhas = [];
    linhas.push('---');
    linhas.push('deck: ' + deck.id);
    linhas.push('gerado_em: ' + hoje());
    linhas.push('---');
    linhas.push('');
    linhas.push('# ' + deck.titulo);
    linhas.push('');
    linhas.push('#flashcards/' + deck.id);
    linhas.push('');

    questoes.forEach(function (q) {
      var certa = q.alternativas.filter(function (a) { return a.correta; })[0];
      if (!certa) return;

      var resposta = certa.texto;
      // A explicação entra na resposta porque é ela que ensina — um flashcard
      // com só a alternativa certa treina reconhecer a frase, não o conceito.
      if (certa.explicacao) {
        resposta += '\n' + certa.explicacao.replace(/^Correto\.\s*/, '');
      }
      if (q.referencia) resposta += '\n(' + q.referencia + ')';

      linhas.push(q.enunciado);
      linhas.push('?');
      linhas.push(resposta);
      // Linha em branco separa um cartão do outro — é como o plugin delimita.
      linhas.push('');
    });

    return linhas.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
  }

  function nomeArquivo(deck, sufixo) {
    return 'pdf-quiz-' + deck.id + '-' + sufixo + '-' + hoje() + '.md';
  }

  function baixarErros(deck, resultado) {
    baixar(nomeArquivo(deck, 'erros'), notaErros(deck, resultado), 'text/markdown');
  }

  function baixarFlashcards(deck, apenasIds) {
    baixar(nomeArquivo(deck, 'flashcards'), flashcards(deck, apenasIds), 'text/markdown');
  }

  /* Backup do progresso: o histórico mora no localStorage, que some se eu
   * limpar o navegador ou trocar de máquina. */
  function baixarProgresso(dados) {
    var pacote = {
      app: 'pdf-quiz',
      versao: 1,
      exportado_em: hoje(),
      progresso: dados
    };
    baixar('pdf-quiz-progresso-' + hoje() + '.json', JSON.stringify(pacote, null, 2), 'application/json');
  }

  function lerProgresso(texto) {
    var pacote;
    try {
      pacote = JSON.parse(texto);
    } catch (e) {
      return { erro: 'Arquivo não é um JSON válido.' };
    }
    if (!pacote || pacote.app !== 'pdf-quiz' || !pacote.progresso) {
      return { erro: 'Esse JSON não é um backup de progresso do PDF Quiz.' };
    }
    return { progresso: pacote.progresso, exportado_em: pacote.exportado_em || '?' };
  }

  return {
    notaErros: notaErros,
    flashcards: flashcards,
    baixarErros: baixarErros,
    baixarFlashcards: baixarFlashcards,
    baixarProgresso: baixarProgresso,
    lerProgresso: lerProgresso
  };
})();
