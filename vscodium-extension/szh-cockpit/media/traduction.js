// Panneau « Traduction » : une carte par bloc à traduire — titre et sous-titre ensemble,
// résumé, mots-clés appariés — avec le texte source en lecture seule, la traduction à
// saisir et un état par bloc. DOM construit sans injection HTML, valeurs reçues par
// postMessage, enregistrement automatique par SZH.autoEnregistrement (media/_commun.js).
//
// Protocole avec l'hôte :
//   webview -> hôte : pret ; modifie { modifie } ; lien ; copier { texte } ;
//                     deepl { texte, source, cible } ;
//                     enregistrer { auto, slug, groupes, commentaire } ;
//                     rechargement { … même charge utile qu'enregistrer }
//   hôte -> webview : valeurs { slug, statuts, langueSource, groupes, commentaire } ;
//                     demande-rechargement ; enregistre ; erreur { message } ;
//                     copie ; focus
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
  let LANGUE_SOURCE = 'fr';
  let STATUTS = [];          // [{ valeur, libelle }], envoyés par l'hôte
  let modifie = false;
  let dernierModifie = false;

  // L'hôte doit savoir si le panneau porte des modifications : c'est lui qui pose la
  // garde avant de changer d'article.
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

  function majStatut(carte) {
    const select = carte.querySelector('select.statut');
    for (const s of STATUTS) { carte.classList.remove('statut-' + s.valeur); }
    carte.classList.add('statut-' + select.value);
  }

  function majBadge(carte) {
    const badge = carte.querySelector('.badge');
    const editeur = editeursMotsCles[carte.dataset.cle];
    const zones = editeur
      ? Array.prototype.slice.call(editeur.element.querySelectorAll('input'))
      : Array.prototype.slice.call(carte.querySelectorAll('textarea.cible'));
    let remplies = 0;
    for (const z of zones) { if (z.value.trim() !== '') { remplies++; } }
    const total = zones.length;
    badge.textContent = carte.dataset.groupe === 'motscles'
      ? remplies + '/' + total
      : (remplies === total && total > 0 ? TXT.traduit : TXT.atraduire);
    badge.classList.toggle('traduit', total > 0 && remplies === total);
  }

  function boutonsSource(texte, langue) {
    const zone = document.createElement('span');
    zone.className = 'actions-source';
    if (texte === '') { return zone; }
    const copier = document.createElement('button');
    copier.type = 'button';
    copier.textContent = TXT.copier;
    copier.addEventListener('click', function () {
      vscodeApi.postMessage({ type: 'copier', texte: texte });
    });
    zone.appendChild(copier);
    const deepl = document.createElement('button');
    deepl.type = 'button';
    deepl.className = 'deepl';
    deepl.textContent = TXT.deepl;
    deepl.title = TXT.deeplTip
      .split('{0}').join(LANGUE_SOURCE.toUpperCase())
      .split('{1}').join(langue.toUpperCase());
    deepl.addEventListener('click', function () {
      vscodeApi.postMessage({ type: 'deepl', texte: texte, source: LANGUE_SOURCE, cible: langue });
    });
    zone.appendChild(deepl);
    return zone;
  }

  function blocSource(libelle, texte, langue) {
    const entete = document.createElement('div');
    entete.className = 'entete-source';
    const l = document.createElement('label');
    l.textContent = libelle;
    entete.appendChild(l);
    entete.appendChild(boutonsSource(texte, langue));
    const bloc = document.createElement('div');
    bloc.className = 'source' + (texte === '' ? ' vide' : '');
    bloc.textContent = texte !== '' ? texte : TXT.sourceVide;
    return [entete, bloc];
  }

  function champTexte(carte, groupe, champ) {
    const nomSource = TXT.source.split('{0}').join(groupe.langueSource.toUpperCase());
    for (const el of blocSource(champ.libelle + ' — ' + nomSource, champ.source, groupe.langue)) {
      carte.appendChild(el);
    }
    const lCible = document.createElement('label');
    lCible.textContent = champ.libelle + ' — ' + TXT.cible.split('{0}').join(groupe.langue.toUpperCase());
    lCible.htmlFor = 'cible-' + groupe.cle + '-' + champ.champ;
    carte.appendChild(lCible);
    const zone = document.createElement('textarea');
    zone.className = 'cible';
    zone.dataset.champ = champ.champ;
    zone.id = lCible.htmlFor;
    zone.rows = champ.multiligne ? 7 : 2;
    zone.value = champ.cible || '';
    zone.addEventListener('input', function () { majBadge(carte); marquer(carte); });
    carte.appendChild(zone);
  }

  // ---- Les mots-clés : le fragment partagé SZH.motsCles (media/_commun.js). Ici la
  // colonne source est en lecture seule et la structure figée : on traduit des mots-clés
  // sans en inventer, le formulaire de métadonnées étant là pour en ajouter.
  const editeursMotsCles = {};        // clé de carte -> fragment

  function champMotsCles(carte, groupe, champ) {
    const entete = document.createElement('div');
    entete.className = 'entete-source';
    const l = document.createElement('label');
    l.textContent = champ.libelle;
    entete.appendChild(l);
    const source = (champ.paires || []).map(function (p) { return p.source; })
      .filter(function (t) { return t !== ''; }).join(', ');
    entete.appendChild(boutonsSource(source, groupe.langue));
    carte.appendChild(entete);

    const listes = {};
    listes[groupe.langueSource] = (champ.paires || []).map(function (p) { return p.source; });
    listes[groupe.langue] = (champ.paires || []).map(function (p) { return p.cible; });
    const editeur = SZH.motsCles({
      langues: [
        { code: groupe.langueSource, libelle: groupe.langueSource.toUpperCase(), lecture: true },
        { code: groupe.langue, libelle: groupe.langue.toUpperCase() }
      ],
      listes: listes,
      edition: false,
      textes: {
        motCle: TXT.motCle, sansEquivalent: TXT.motCleSansEquiv, aide: TXT.motsClesAide
      },
      onChange: function () { majBadge(carte); marquer(carte); }
    });
    editeur.langueCible = groupe.langue;
    editeursMotsCles[groupe.cle] = editeur;
    carte.appendChild(editeur.element);
  }

  function carteGroupe(groupe) {
    const carte = document.createElement('div');
    carte.className = 'carte';
    carte.dataset.cle = groupe.cle;
    carte.dataset.groupe = groupe.groupe;
    carte.dataset.langue = groupe.langue;
    carte.id = 'bloc-' + groupe.cle;

    const h3 = document.createElement('h3');
    h3.textContent = groupe.libelle;
    const badge = document.createElement('span');
    badge.className = 'badge';
    h3.appendChild(badge);
    carte.appendChild(h3);

    for (const champ of groupe.champs) {
      if (champ.champ === 'keywords') { champMotsCles(carte, groupe, champ); }
      else { champTexte(carte, groupe, champ); }
    }

    const rangee = document.createElement('div');
    rangee.className = 'ligne-statut';
    const lStatut = document.createElement('label');
    lStatut.textContent = TXT.statut;
    lStatut.htmlFor = 'statut-' + groupe.cle;
    rangee.appendChild(lStatut);
    const select = document.createElement('select');
    select.className = 'statut';
    select.id = lStatut.htmlFor;
    for (const s of STATUTS) {
      const opt = document.createElement('option');
      opt.value = s.valeur;
      opt.textContent = s.libelle;
      select.appendChild(opt);
    }
    select.value = groupe.statut;
    select.addEventListener('input', function () { majStatut(carte); marquer(carte); });
    rangee.appendChild(select);
    carte.appendChild(rangee);

    majBadge(carte);
    majStatut(carte);
    return carte;
  }

  // « Tout l'article » : un bouton par état. Un clic pose l'état sur tous les blocs puis
  // enregistre, ce qui emporte aussi les textes en cours de saisie.
  function rendreTout(nombreBlocs) {
    barreTout.textContent = '';
    if (nombreBlocs === 0) { barreTout.hidden = true; return; }
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
        enregistrer(false);
      });
      barreTout.appendChild(bouton);
    }
    const aide = document.createElement('p');
    aide.className = 'aide';
    aide.textContent = TXT.toutAide.split('{0}').join(String(nombreBlocs));
    barreTout.appendChild(aide);
    barreTout.hidden = false;
  }

  // « Envoyer pour traduction » : l'hôte fabrique le lien szh:// et ouvre le brouillon
  // d'e-mail. Ni garde de modification, ni enregistrement forcé.
  function poserBoutonEnvoyer() {
    if (!TXT.envoyer || document.getElementById('envoyer')) { return; }
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.id = 'envoyer';
    bouton.textContent = TXT.envoyer;
    if (TXT.envoyerTip) { bouton.title = TXT.envoyerTip; }
    bouton.addEventListener('click', function () { vscodeApi.postMessage({ type: 'lien' }); });
    const ancre = document.getElementById('enregistrer');
    ancre.parentNode.insertBefore(bouton, ancre.nextSibling);
  }

  function rendre(msg) {
    poserBoutonEnvoyer();
    SLUG = msg.slug || null;
    STATUTS = msg.statuts || [];
    LANGUE_SOURCE = msg.langueSource || 'fr';
    titreArticle.textContent = SLUG || '';
    conteneur.textContent = '';
    for (const cle of Object.keys(editeursMotsCles)) { delete editeursMotsCles[cle]; }
    const groupes = msg.groupes || [];
    for (const groupe of groupes) { conteneur.appendChild(carteGroupe(groupe)); }
    if (groupes.length === 0) {
      const rien = document.createElement('p');
      rien.className = 'rien';
      rien.textContent = TXT.rien;
      conteneur.appendChild(rien);
    }
    rendreTout(groupes.length);
    commentaire.value = msg.commentaire || '';
    zoneCommentaire.hidden = false;
    modifie = false;
    signalerModifie();
    if (msg.focus) { viser(msg.focus); }
  }

  function viser(cle) {
    const bloc = document.getElementById('bloc-' + cle);
    if (!bloc) { return; }
    const premier = bloc.querySelector('textarea.cible, .mc input');
    if (premier) { premier.focus(); }
    bloc.scrollIntoView({ block: 'center' });
  }

  function collecter(auto) {
    const groupes = [];
    for (const carte of conteneur.querySelectorAll('.carte')) {
      const champs = [];
      for (const zone of carte.querySelectorAll('textarea.cible')) {
        champs.push({ champ: zone.dataset.champ, texte: zone.value });
      }
      const editeur = editeursMotsCles[carte.dataset.cle];
      if (editeur) {
        champs.push({ champ: 'keywords', paires: editeur.collecter()[editeur.langueCible] || [] });
      }
      groupes.push({
        cle: carte.dataset.cle,
        langue: carte.dataset.langue,
        statut: carte.querySelector('select.statut').value,
        champs: champs
      });
    }
    return {
      type: 'enregistrer', auto: !!auto, slug: SLUG,
      groupes: groupes, commentaire: commentaire.value
    };
  }

  function enregistrer(auto) {
    if (!SLUG) { return; }
    if (!modifie) { if (!auto) { etat.textContent = TXT.aucuneModif; } return; }
    vscodeApi.postMessage(collecter(auto));
  }

  const auto = SZH.autoEnregistrement({
    estModifie: function () { return modifie && !!SLUG; },
    enregistrer: enregistrer
  });

  commentaire.addEventListener('input', function () { marquer(null); });
  document.getElementById('enregistrer').addEventListener('click', function () {
    auto.annuler();
    enregistrer(false);
  });

  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    if (msg.type === 'valeurs') { rendre(msg); return; }
    // L'hôte veut changer d'article alors que le panneau est modifié : il lui faut ce que
    // la webview contient pour l'enregistrer avant de recharger.
    if (msg.type === 'demande-rechargement') {
      vscodeApi.postMessage(Object.assign(collecter(false), { type: 'rechargement' }));
      return;
    }
    if (msg.type === 'enregistre') {
      auto.confirme();
      modifie = false;
      signalerModifie();
      for (const carte of conteneur.querySelectorAll('.carte.modifie')) { carte.classList.remove('modifie'); }
      etat.textContent = TXT.enregistre;
      return;
    }
    // Clic sur un bloc de l'arbre alors que le panneau montre déjà cet article : pas de
    // re-rendu, qui perdrait une saisie en cours, juste le focus.
    if (msg.type === 'focus') { viser(msg.cle); return; }
    if (msg.type === 'copie') { etat.textContent = TXT.copie; return; }
    if (msg.type === 'erreur') { auto.confirme(); etat.textContent = '⚠ ' + msg.message; }
  });

  // Un dépôt hors d'une zone prévue ne doit jamais faire naviguer la webview.
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); });
  vscodeApi.postMessage({ type: 'pret' });
})();
