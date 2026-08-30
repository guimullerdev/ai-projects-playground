/* Histórico por deck no localStorage.
 *
 * A chave carrega ':v1' de propósito: quando o formato mudar, o dado velho fica
 * para trás em vez de virar objeto meio-migrado que o app tem que adivinhar.
 *
 * Scripts clássicos (sem `type="module"`) porque o módulo ES não carrega em
 * file:// — e abrir o index direto, sem servidor, é justamente o caminho de
 * fallback do "importar deck". */

var PQStorage = (function () {
  var CHAVE = 'pdf-quiz:v1';

  function lerTudo() {
    try {
      return JSON.parse(localStorage.getItem(CHAVE)) || {};
    } catch (e) {
      // localStorage bloqueado (navegação privada, site data limpo) ou JSON
      // corrompido: o quiz funciona sem histórico, só não lembra de nada.
      return {};
    }
  }

  function gravarTudo(dados) {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(dados));
      return true;
    } catch (e) {
      return false;
    }
  }

  function lerDeck(deckId) {
    var registro = lerTudo()[deckId];
    if (!registro) return null;
    return {
      tentativas: registro.tentativas || 0,
      melhor_score: registro.melhor_score || 0,
      ultima: registro.ultima || null,
      erradas: Array.isArray(registro.erradas) ? registro.erradas : [],
      // Registro do v1 não tinha tópicos: ausente vira vazio em vez de quebrar.
      topicos: registro.topicos && typeof registro.topicos === 'object' ? registro.topicos : {}
    };
  }

  /* Guarda o resultado de uma sessão.
   *
   * `erradas` é um set acumulado, não a foto da última tentativa: questão
   * errada entra, questão acertada sai. É isso que faz o "só os que errei"
   * encolher conforme eu aprendo, em vez de repetir o mesmo lote pra sempre. */
  function registrarTentativa(deckId, resultado) {
    var dados = lerTudo();
    var atual = dados[deckId] || { tentativas: 0, melhor_score: 0, ultima: null, erradas: [] };

    var erradas = Array.isArray(atual.erradas) ? atual.erradas.slice() : [];
    resultado.acertadas.forEach(function (id) {
      var i = erradas.indexOf(id);
      if (i !== -1) erradas.splice(i, 1);
    });
    resultado.erradas.forEach(function (id) {
      if (erradas.indexOf(id) === -1) erradas.push(id);
    });

    // Soma por tópico atravessando tentativas: o relatório do v1 só enxergava a
    // sessão que acabou, e uma sessão não diz onde eu erro sempre.
    var topicos = {};
    var anteriores = atual.topicos && typeof atual.topicos === 'object' ? atual.topicos : {};
    Object.keys(anteriores).forEach(function (nome) {
      topicos[nome] = {
        total: anteriores[nome].total || 0,
        acertos: anteriores[nome].acertos || 0
      };
    });
    (resultado.topicos || []).forEach(function (t) {
      if (!topicos[t.topico]) topicos[t.topico] = { total: 0, acertos: 0 };
      topicos[t.topico].total += t.total;
      topicos[t.topico].acertos += t.acertos;
    });

    dados[deckId] = {
      tentativas: atual.tentativas + 1,
      // Só a sessão completa disputa o recorde: um "refazer só os erros" tem
      // menos questões e não dá pra comparar com a volta inteira.
      melhor_score: resultado.parcial
        ? atual.melhor_score
        : Math.max(atual.melhor_score || 0, resultado.score),
      ultima: hoje(),
      erradas: erradas,
      topicos: topicos
    };

    gravarTudo(dados);
    return dados[deckId];
  }

  function hoje() {
    var d = new Date();
    var mes = String(d.getMonth() + 1).padStart(2, '0');
    var dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mes + '-' + dia;
  }

  /* Tópicos fracos somando TODAS as tentativas de TODOS os decks.
   *
   * Atravessar decks é o ponto: "controle de congestionamento" pode aparecer em
   * dois capítulos, e o que eu quero saber é se erro o conceito — não se errei
   * naquele deck. Tópico só entra se já foi visto o bastante pra significar
   * alguma coisa (mínimo de 2 respostas), senão um chute isolado lidera a lista. */
  function pontosFracos(minimo) {
    var piso = minimo || 2;
    var dados = lerTudo();
    var mapa = {};

    Object.keys(dados).forEach(function (deckId) {
      var topicos = dados[deckId].topicos || {};
      Object.keys(topicos).forEach(function (nome) {
        if (!mapa[nome]) mapa[nome] = { topico: nome, total: 0, acertos: 0, decks: [] };
        mapa[nome].total += topicos[nome].total || 0;
        mapa[nome].acertos += topicos[nome].acertos || 0;
        if (mapa[nome].decks.indexOf(deckId) === -1) mapa[nome].decks.push(deckId);
      });
    });

    return Object.keys(mapa)
      .map(function (k) { return mapa[k]; })
      .filter(function (t) { return t.total >= piso && t.acertos < t.total; })
      .sort(function (a, b) {
        var diff = a.acertos / a.total - b.acertos / b.total;
        // Empate de proporção: quem tem mais respostas vem antes, porque é
        // evidência mais forte de que o buraco é real.
        return diff !== 0 ? diff : b.total - a.total;
      });
  }

  function substituirTudo(dados) {
    return gravarTudo(dados || {});
  }

  function limpar() {
    return gravarTudo({});
  }

  return {
    lerTudo: lerTudo,
    lerDeck: lerDeck,
    registrarTentativa: registrarTentativa,
    pontosFracos: pontosFracos,
    substituirTudo: substituirTudo,
    limpar: limpar
  };
})();
