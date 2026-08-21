(function () {
  'use strict';
  const TXT = __TXT__;
  const vscodeApi = acquireVsCodeApi();
  let recu = false;
  const CLES = ['title', 'volume', 'numero', 'date', 'lang'];
  const modifies = new Set();
  const etat = document.getElementById('etat');
  let couleurChoisie = '';
  // La revue est un choix fermé : c'est le jeton canonique zeitschrift ou revue qui est
  // écrit dans ausgabe.yaml, l'ISSN et la langue par défaut en étant dérivés.
  let revueChoisie = '';
  const RADIOS_REVUE = document.querySelectorAll('input[name="revue"]');
  // La valeur de la case arrive déjà tranchée en « true » ou « false » par estVraiYaml
  // (lib/yaml.js) : aucune règle de vérité n'est dupliquée ici.
  const CASE_CONDENSE = document.getElementById('entete-condensee');
  CASE_CONDENSE.addEventListener('change', function () {
    modifies.add('entete-condensee');
    etat.textContent = '';
  });
  // Miroir de normaliserRevue() (lib/yaml.js) et de derive_revue() côté Lua : accepte le
  // jeton comme l'ancien nom complet, et teste « zeitschrift » avant « revue ».
  function normaliserRevue(v) {
    const s = String(v === undefined || v === null ? '' : v).toLowerCase();
    if (s.indexOf('zeitschrift') !== -1) { return 'zeitschrift'; }
    if (s.indexOf('revue') !== -1) { return 'revue'; }
    return '';
  }
  function majRevue() {
    for (const r of RADIOS_REVUE) { r.checked = (r.value === revueChoisie); }
  }
  for (const r of RADIOS_REVUE) {
    r.addEventListener('change', function () {
      if (!r.checked) { return; }
      revueChoisie = r.value;
      modifies.add('revue');
      etat.textContent = '';
    });
  }
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
    revueChoisie = normaliserRevue(valeurs.revue);
    majRevue();
    couleurChoisie = valeurs.couleur === undefined ? '' : String(valeurs.couleur);
    majPastilles();
    CASE_CONDENSE.checked = String(valeurs['entete-condensee']) === 'true';
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
      if (cle === 'couleur') { envoi[cle] = couleurChoisie; }
      else if (cle === 'revue') { envoi[cle] = revueChoisie; }
      else if (cle === 'entete-condensee') { envoi[cle] = CASE_CONDENSE.checked ? 'true' : 'false'; }
      else { envoi[cle] = document.getElementById(cle).value; }
    }
    vscodeApi.postMessage({ type: 'enregistrer', modifies: envoi });
  });
  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    recu = true;
    if (msg.type === 'valeurs') { remplir(msg.valeurs || {}); }
    if (msg.type === 'enregistre') { modifies.clear(); etat.textContent = TXT.enregistre; }
    if (msg.type === 'erreur') { etat.textContent = '⚠ ' + msg.message; }
  });
  SZH.annoncerPret(vscodeApi, function () { return recu; });
})();