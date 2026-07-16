(function () {
  'use strict';
  const TXT = __TXT__;
  const vscodeApi = acquireVsCodeApi();
  const CLES = ['title', 'revue', 'volume', 'numero', 'date', 'lang'];
  const modifies = new Set();
  const etat = document.getElementById('etat');
  let couleurChoisie = '';
  function majPastilles() {
    for (const b of document.querySelectorAll('#couleurs .pastille')) {
      b.setAttribute('aria-pressed', b.dataset.hex === couleurChoisie ? 'true' : 'false');
    }
  }
  function rendreCouleurs() {
    const conteneur = document.getElementById('couleurs');
    conteneur.textContent = '';
    const items = [{ hex: '', nom: TXT.couleurAucune }].concat(TXT.couleurs);
    for (const c of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pastille';
      b.dataset.hex = c.hex;
      b.setAttribute('aria-pressed', 'false');
      if (c.hex) {
        const puce = document.createElement('span');
        puce.className = 'puce';
        puce.style.background = c.hex;
        b.appendChild(puce);
      }
      b.appendChild(document.createTextNode(c.nom));
      b.addEventListener('click', function () {
        couleurChoisie = c.hex;
        majPastilles();
        modifies.add('couleur');
        etat.textContent = '';
      });
      conteneur.appendChild(b);
    }
  }
  function remplir(valeurs) {
    for (const cle of CLES) {
      const champ = document.getElementById(cle);
      const v = valeurs[cle] === undefined ? '' : String(valeurs[cle]);
      champ.value = v;
      if (cle === 'date') {
        const indice = document.getElementById('indiceDate');
        if (v && champ.value !== v) {
          indice.textContent = TXT.indiceDate.split('{0}').join(v);
          indice.hidden = false;
        } else { indice.hidden = true; }
      }
      if (cle === 'lang' && champ.value !== v) { champ.value = ''; }
    }
    couleurChoisie = valeurs.couleur === undefined ? '' : String(valeurs.couleur);
    majPastilles();
    modifies.clear();
    etat.textContent = '';
  }
  for (const cle of CLES) {
    document.getElementById(cle).addEventListener('input', function () { modifies.add(cle); etat.textContent = ''; });
  }
  rendreCouleurs();
  document.getElementById('formulaire').addEventListener('submit', function (e) {
    e.preventDefault();
    if (modifies.size === 0) { etat.textContent = TXT.rien; return; }
    const envoi = {};
    for (const cle of modifies) {
      envoi[cle] = cle === 'couleur' ? couleurChoisie : document.getElementById(cle).value;
    }
    vscodeApi.postMessage({ type: 'enregistrer', modifies: envoi });
  });
  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    if (msg.type === 'valeurs') { remplir(msg.valeurs || {}); }
    if (msg.type === 'enregistre') { modifies.clear(); etat.textContent = TXT.enregistre; }
    if (msg.type === 'erreur') { etat.textContent = '⚠ ' + msg.message; }
  });
  vscodeApi.postMessage({ type: 'pret' });
})();