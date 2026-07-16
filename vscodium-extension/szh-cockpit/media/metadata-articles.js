(function () {
  'use strict';
  const TXT = __TXT__;
  const vscodeApi = acquireVsCodeApi();
  const etat = document.getElementById('etat');
  const conteneur = document.getElementById('cartes');
  const modifies = new Set();
  let TYPES = [];
  function marquer(carte, slug) { modifies.add(slug); carte.classList.add('modifie'); etat.textContent = ''; }
  function champTexte(carte, parent, slug, cle, langue, libelle, valeur, multiligne) {
    const l = document.createElement('label');
    l.textContent = libelle;
    const i = document.createElement(multiligne ? 'textarea' : 'input');
    if (multiligne) { i.rows = 3; } else { i.type = 'text'; }
    i.value = valeur || '';
    i.dataset.cle = cle;
    if (langue) { i.dataset.langue = langue; l.classList.add('champ-' + langue); i.classList.add('champ-' + langue); }
    i.addEventListener('input', function () { marquer(carte, slug); });
    parent.appendChild(l);
    parent.appendChild(i);
  }
  function ligneAuteur(carte, slug, zone, auteur) {
    const rangee = document.createElement('div');
    rangee.className = 'auteur';
    for (const [cle, indice] of [['prenom', TXT.aPrenom], ['nom', TXT.aNom], ['fonction', TXT.aFonction], ['affiliation', TXT.aAffiliation], ['orcid', TXT.aOrcid]]) {
      const i = document.createElement('input');
      i.type = 'text';
      i.placeholder = indice;
      i.title = indice;
      i.value = (auteur && auteur[cle]) || '';
      i.dataset.cle = cle;
      i.addEventListener('input', function () { marquer(carte, slug); });
      rangee.appendChild(i);
    }
    const retirer = document.createElement('button');
    retirer.type = 'button';
    retirer.className = 'retirer';
    retirer.textContent = '✕';
    retirer.title = TXT.retirerAuteur;
    retirer.addEventListener('click', function () { rangee.remove(); marquer(carte, slug); });
    rangee.appendChild(retirer);
    zone.appendChild(rangee);
  }
  function rendre(articles) {
    conteneur.textContent = '';
    modifies.clear();
    for (const article of articles) {
      const carte = document.createElement('div');
      carte.className = 'carte';
      carte.dataset.slug = article.slug;
      const titre = document.createElement('h2');
      titre.textContent = article.slug;
      carte.appendChild(titre);
      const v = article.valeurs || {};
      const avecIt = ['title', 'subtitle', 'resume'].some(function (c) { return v[c] && v[c].it; }) ||
        (v.keywords && v.keywords.it && v.keywords.it.length > 0);
      if (avecIt) { carte.classList.add('avec-it'); }
      const lType = document.createElement('label');
      lType.textContent = TXT.type;
      carte.appendChild(lType);
      const selection = document.createElement('select');
      selection.dataset.cle = 'type';
      const optVide = document.createElement('option');
      optVide.value = '';
      optVide.textContent = TXT.typeAucun;
      selection.appendChild(optVide);
      // Groupes (E2) : chaque option porte un `groupe` ; on ouvre un <optgroup>
      // quand il change (option sans groupe -> directement dans le select).
      let cible = selection, groupeCourant = null;
      for (const t of TYPES) {
        if (t.groupe) {
          if (t.groupe !== groupeCourant) {
            groupeCourant = t.groupe;
            cible = document.createElement('optgroup');
            cible.label = t.groupe;
            selection.appendChild(cible);
          }
        } else { cible = selection; groupeCourant = null; }
        const opt = document.createElement('option');
        opt.value = t.valeur;
        opt.textContent = t.libelle;
        cible.appendChild(opt);
      }
      selection.value = v.type || '';
      if (selection.value !== (v.type || '')) { selection.value = ''; }
      selection.addEventListener('input', function () { marquer(carte, article.slug); });
      carte.appendChild(selection);
      const langues = ['fr', 'de', 'it'];   // IT toujours construit, révélé par CSS
      const nomsLangues = { fr: 'FR', de: 'DE', it: 'IT' };
      for (const lg of langues) {
        champTexte(carte, carte, article.slug, 'title', lg, TXT.titreChamp.split('{0}').join(nomsLangues[lg]), (v.title || {})[lg]);
      }
      for (const lg of langues) {
        champTexte(carte, carte, article.slug, 'subtitle', lg, TXT.sousTitre.split('{0}').join(nomsLangues[lg]), (v.subtitle || {})[lg]);
      }
      for (const lg of langues) {
        champTexte(carte, carte, article.slug, 'resume', lg, TXT.resume.split('{0}').join(nomsLangues[lg]), (v.resume || {})[lg], true);
      }
      const lAuteurs = document.createElement('label');
      lAuteurs.textContent = TXT.auteurs;
      carte.appendChild(lAuteurs);
      const zone = document.createElement('div');
      zone.className = 'auteurs';
      carte.appendChild(zone);
      for (const a of (v.author || [])) { ligneAuteur(carte, article.slug, zone, a); }
      const ajouter = document.createElement('button');
      ajouter.type = 'button';
      ajouter.textContent = TXT.ajouterAuteur;
      ajouter.addEventListener('click', function () { ligneAuteur(carte, article.slug, zone, null); marquer(carte, article.slug); });
      carte.appendChild(ajouter);
      champTexte(carte, carte, article.slug, 'doi', null, 'DOI', v.doi);
      for (const lg of langues) {
        champTexte(carte, carte, article.slug, 'keywords', lg, TXT.motsCles.split('{0}').join(nomsLangues[lg]), ((v.keywords || {})[lg] || []).join(', '));
      }
      const caseIt = document.createElement('label');
      caseIt.className = 'case-it';
      const coche = document.createElement('input');
      coche.type = 'checkbox';
      coche.checked = avecIt;
      caseIt.appendChild(coche);
      caseIt.appendChild(document.createTextNode(TXT.italien));
      coche.addEventListener('change', function () {
        carte.classList.toggle('avec-it', coche.checked);
      });
      carte.appendChild(caseIt);
      conteneur.appendChild(carte);
    }
  }
  function collecter(carte) {
    const resultat = { type: '', doi: '', title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
    const sel = carte.querySelector('select[data-cle=type]');
    if (sel) { resultat.type = sel.value; }
    for (const i of carte.querySelectorAll(':scope > input, :scope > textarea')) {
      const cle = i.dataset.cle;
      const langue = i.dataset.langue;
      if (cle === 'doi') { resultat.doi = i.value; }
      else if (cle === 'title' || cle === 'subtitle' || cle === 'resume') { resultat[cle][langue] = i.value; }
      else if (cle === 'keywords') {
        resultat.keywords[langue] = i.value.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
      }
    }
    for (const rangee of carte.querySelectorAll('.auteur')) {
      const a = {};
      for (const i of rangee.querySelectorAll('input')) { a[i.dataset.cle] = i.value; }
      resultat.author.push(a);
    }
    return resultat;
  }
  document.getElementById('enregistrer').addEventListener('click', function () {
    if (modifies.size === 0) { etat.textContent = TXT.rien; return; }
    const envoi = {};
    for (const carte of conteneur.querySelectorAll('.carte')) {
      if (modifies.has(carte.dataset.slug)) { envoi[carte.dataset.slug] = collecter(carte); }
    }
    vscodeApi.postMessage({ type: 'enregistrer', articles: envoi });
  });
  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    if (msg.type === 'valeurs') { TYPES = msg.types || []; rendre(msg.articles || []); }
    if (msg.type === 'enregistre') { etat.textContent = TXT.enregistre.split('{0}').join(msg.n); }
    if (msg.type === 'erreur') { etat.textContent = '⚠ ' + msg.message; }
  });
  vscodeApi.postMessage({ type: 'pret' });
})();