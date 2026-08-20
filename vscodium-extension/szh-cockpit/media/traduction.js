// Panneau « Traduction » (D113) — une carte par champ bilingue : texte source en
// lecture seule, traduction à saisir, état d'avancement. DOM construit sans
// injection HTML ; les valeurs arrivent par postMessage (jamais dans le gabarit).
(function () {
  'use strict';
  const TXT = __TXT__;
  const vscodeApi = acquireVsCodeApi();
  const etat = document.getElementById('etat');
  const conteneur = document.getElementById('champs');
  const titreArticle = document.getElementById('article');
  const barreTout = document.getElementById('tout');
  const zoneCommentaire = document.getElementById('zone-commentaire');
  const commentaire = document.getElementById('commentaire');

  let SLUG = null;
  let STATUTS = [];          // [{ valeur, libelle }] — envoyés par l'hôte (i18n)
  let modifie = false;
  let dernierModifie = false;

  // L'hôte doit savoir si le panneau porte des modifications : c'est lui qui pose
  // la garde « non enregistré » avant de CHANGER d'article (clic sur un autre
  // article de la section « Traductions »).
  function signalerModifie() {
    if (modifie === dernierModifie) { return; }
    dernierModifie = modifie;
    vscodeApi.postMessage({ type: 'modifie', modifie: modifie });
  }
  function marquer(carte) {
    modifie = true;
    if (carte) { carte.classList.add('modifie'); }
    etat.textContent = '';
    signalerModifie();
  }

  function majBadge(carte) {
    const zone = carte.querySelector('textarea.cible');
    const badge = carte.querySelector('.badge');
    const rempli = zone.value.trim() !== '';
    badge.textContent = rempli ? TXT.traduit : TXT.atraduire;
    badge.classList.toggle('traduit', rempli);
  }

  function majStatut(carte) {
    const select = carte.querySelector('select.statut');
    for (const s of STATUTS) { carte.classList.remove('statut-' + s.valeur); }
    carte.classList.add('statut-' + select.value);
  }

  function carteChamp(ligne) {
    const carte = document.createElement('div');
    carte.className = 'carte';
    carte.dataset.champ = ligne.champ;
    carte.dataset.langue = ligne.langue;
    carte.dataset.cle = ligne.cle;

    const h3 = document.createElement('h3');
    h3.textContent = ligne.libelle;
    const badge = document.createElement('span');
    badge.className = 'badge';
    h3.appendChild(badge);
    carte.appendChild(h3);

    // ---- Texte source : en lecture seule, avec un bouton « Copier » (l'hôte
    // écrit dans le presse-papiers ; aucune permission de webview en jeu).
    const entete = document.createElement('div');
    entete.className = 'entete-source';
    const lSource = document.createElement('label');
    lSource.textContent = TXT.source.split('{0}').join(ligne.langueSource.toUpperCase());
    entete.appendChild(lSource);
    if (ligne.source !== '') {
      const copier = document.createElement('button');
      copier.type = 'button';
      copier.textContent = TXT.copier;
      copier.addEventListener('click', function () {
        vscodeApi.postMessage({ type: 'copier', texte: ligne.source });
      });
      entete.appendChild(copier);
    }
    carte.appendChild(entete);
    const source = document.createElement('div');
    source.className = 'source' + (ligne.source === '' ? ' vide' : '');
    source.textContent = ligne.source !== '' ? ligne.source : TXT.sourceVide;
    carte.appendChild(source);

    // ---- Traduction (le seul champ éditable de la carte).
    const lCible = document.createElement('label');
    lCible.textContent = TXT.cible.split('{0}').join(ligne.langue.toUpperCase());
    lCible.htmlFor = 'cible-' + ligne.cle;
    carte.appendChild(lCible);
    const zone = document.createElement('textarea');
    zone.className = 'cible';
    zone.id = 'cible-' + ligne.cle;
    zone.rows = ligne.champ === 'resume' ? 7 : 2;
    zone.value = ligne.cible || '';
    if (ligne.aide) { zone.placeholder = ligne.aide; }
    zone.addEventListener('input', function () { majBadge(carte); marquer(carte); });
    carte.appendChild(zone);

    // ---- État d'avancement.
    const rangee = document.createElement('div');
    rangee.className = 'ligne-statut';
    const lStatut = document.createElement('label');
    lStatut.textContent = TXT.statut;
    lStatut.htmlFor = 'statut-' + ligne.cle;
    rangee.appendChild(lStatut);
    const select = document.createElement('select');
    select.className = 'statut';
    select.id = 'statut-' + ligne.cle;
    for (const s of STATUTS) {
      const opt = document.createElement('option');
      opt.value = s.valeur;
      opt.textContent = s.libelle;
      select.appendChild(opt);
    }
    select.value = ligne.statut;
    select.addEventListener('input', function () { majStatut(carte); marquer(carte); });
    rangee.appendChild(select);
    carte.appendChild(rangee);

    majBadge(carte);
    majStatut(carte);
    return carte;
  }

  // « Tout l'article » : un bouton par état. Un clic pose l'état sur TOUS les
  // champs puis enregistre — c'est le geste demandé « en un clic », et il n'y a
  // rien à perdre : l'enregistrement emporte aussi les textes en cours de saisie.
  function rendreTout(nombreChamps) {
    barreTout.textContent = '';
    if (nombreChamps === 0) { barreTout.hidden = true; return; }
    const intitule = document.createElement('span');
    intitule.className = 'intitule';
    intitule.textContent = TXT.tout;
    barreTout.appendChild(intitule);
    for (const s of STATUTS) {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.textContent = s.libelle;
      bouton.addEventListener('click', function () {
        for (const carte of conteneur.querySelectorAll('.carte')) {
          const select = carte.querySelector('select.statut');
          if (select.value !== s.valeur) { select.value = s.valeur; carte.classList.add('modifie'); }
          majStatut(carte);
        }
        modifie = true;
        signalerModifie();
        enregistrer();
      });
      barreTout.appendChild(bouton);
    }
    const aide = document.createElement('p');
    aide.className = 'aide';
    aide.textContent = TXT.toutAide.split('{0}').join(String(nombreChamps));
    barreTout.appendChild(aide);
    barreTout.hidden = false;
  }

  function rendre(msg) {
    SLUG = msg.slug || null;
    STATUTS = msg.statuts || [];
    titreArticle.textContent = SLUG || '';
    conteneur.textContent = '';
    const lignes = msg.lignes || [];
    for (const ligne of lignes) { conteneur.appendChild(carteChamp(ligne)); }
    if (lignes.length === 0) {
      const rien = document.createElement('p');
      rien.className = 'rien';
      rien.textContent = TXT.rien;
      conteneur.appendChild(rien);
    }
    rendreTout(lignes.length);
    commentaire.value = msg.commentaire || '';
    zoneCommentaire.hidden = false;
    modifie = false;
    signalerModifie();
    if (msg.focus) {
      const cible = document.getElementById('cible-' + msg.focus);
      if (cible) { cible.focus(); cible.scrollIntoView({ block: 'center' }); }
    }
  }

  function collecter() {
    const champs = [];
    for (const carte of conteneur.querySelectorAll('.carte')) {
      champs.push({
        champ: carte.dataset.champ,
        langue: carte.dataset.langue,
        texte: carte.querySelector('textarea.cible').value,
        statut: carte.querySelector('select.statut').value
      });
    }
    return { type: 'enregistrer', slug: SLUG, champs: champs, commentaire: commentaire.value };
  }

  function enregistrer() {
    if (!SLUG) { return; }
    if (!modifie) { etat.textContent = TXT.aucuneModif; return; }
    vscodeApi.postMessage(collecter());
  }

  commentaire.addEventListener('input', function () { marquer(null); });
  document.getElementById('enregistrer').addEventListener('click', enregistrer);

  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    if (msg.type === 'valeurs') { rendre(msg); return; }
    // L'hôte veut changer d'article alors que le panneau porte un ● : il lui faut
    // ce que la webview contient pour pouvoir l'enregistrer avant de recharger.
    if (msg.type === 'demande-rechargement') {
      vscodeApi.postMessage(Object.assign(collecter(), { type: 'rechargement' }));
      return;
    }
    if (msg.type === 'enregistre') {
      modifie = false;
      signalerModifie();
      for (const carte of conteneur.querySelectorAll('.carte.modifie')) { carte.classList.remove('modifie'); }
      etat.textContent = TXT.enregistre;
      return;
    }
    // Clic sur UN champ dans l'arbre alors que le panneau montre déjà cet article :
    // pas de re-rendu (une saisie en cours serait perdue), juste le focus.
    if (msg.type === 'focus') {
      const cible = document.getElementById('cible-' + msg.cle);
      if (cible) { cible.focus(); cible.scrollIntoView({ block: 'center' }); }
      return;
    }
    if (msg.type === 'copie') { etat.textContent = TXT.copie; return; }
    if (msg.type === 'erreur') { etat.textContent = '⚠ ' + msg.message; }
  });

  // Un dépôt HORS zone prévue ne doit jamais « naviguer » la webview.
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); });
  vscodeApi.postMessage({ type: 'pret' });
})();
