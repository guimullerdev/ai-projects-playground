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
      erradas: Array.isArray(registro.erradas) ? registro.erradas : []
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

    dados[deckId] = {
      tentativas: atual.tentativas + 1,
      // Só a sessão completa disputa o recorde: um "refazer só os erros" tem
      // menos questões e não dá pra comparar com a volta inteira.
      melhor_score: resultado.parcial
        ? atual.melhor_score
        : Math.max(atual.melhor_score || 0, resultado.score),
      ultima: hoje(),
      erradas: erradas
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

  return {
    lerTudo: lerTudo,
    lerDeck: lerDeck,
    registrarTentativa: registrarTentativa
  };
})();
