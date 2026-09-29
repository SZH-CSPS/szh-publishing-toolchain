// Vue d'ensemble d'une section de la barre latérale : une barre de commandes globales, et
// une liste de lignes. Rien n'est décidé ici — l'hôte envoie les boutons et les lignes, la
// page les pose. Un seul fichier sert donc « Traductions » et « Word en attente ».
//
// Cliquer l'onglet d'une section ouvre cette vue : les commandes globales y ont un bouton
// avec un texte, au lieu des pictogrammes muets que l'arbre alignait dans sa marge.
//
// La barre et les cartes sont construites par SZH.barreBoutons et SZH.listeCartes
// (media/_commun.js), partagées avec la vue « Articles » : une carte a partout les mêmes
// trois étages fixes — la tête et sa mesure, ce qu'il y a à lire, puis « Ouvrir » et l'état.
//
// Protocole. Vers l'hôte :
//   pret ; action { id, cle } ; ouvrir { cle } ; constat-fermer { empreinte }
// Depuis l'hôte :
//   valeurs { titre, boutons, lignes, accent, i18n, focus?, analyse? } ; etat { message } ;
//   focaliser { focus } ; analyse { actif, cle, texte }
// où i18n vaut { ouvrir, listeVide, fermerConstat }.
// où un bouton vaut { id, libelle, icone, tip, principal, danger, desactive } et une ligne
// { cle, groupe, titre, meta, pastilles: [{ texte, ton, icone }], notif: { ton, texte },
// messages: [{ ton, texte, action, fermable, empreinte }],
// actions: [{ id, libelle, icone, tip, desactive, danger }], ouvrir }.
//
// `fermable` ne se devine pas ici : c'est l'hôte qui sait qu'un constat est gris, donc
// effaçable, et lui qui retient l'empreinte de ceux qu'on a fermés.
//
// `focus` (un nom de fichier Word, pour l'instant) désigne la carte dont `cle` lui est égal
// (SZH.listeCartes pose [data-cle] à la construction) : amenée à l'écran, marquée quelques
// secondes. Absent, ou sans carte correspondante : rien ne se passe, jamais d'erreur — la
// table (lib/constats.js) vise « word » avec des focus que toutes les cartes ne portent pas
// (le rapport de conversion, par ex., n'a pas de `cle`). Il arrive soit dans la première
// « valeurs » (panneau qui s'ouvre), soit dans un message « focaliser » à part (panneau déjà
// ouvert, dont la liste ne serait pas reconstruite sinon) — voir extension.js, ouvrirVueEnsemble.
//
// « action » sert aux deux : la barre l'envoie sans `cle`, le bouton d'une carte avec celle
// de sa ligne. C'est l'hôte qui départage, et il n'y a qu'un message à traiter.
//
// Le voile « Analyse en cours… » (vue « À corriger » seulement) : { actif, cles, texte },
// dans « valeurs » (champ `analyse`) ou dans un message ANALYSE à part — l'hôte le pose au
// démarrage d'une compilation et le lève quand le journal est relu et la validation PDF/UA
// terminée (extension.js, debuterAnalyse/terminerAnalyse). `cles` nomme les articles qui se
// recompilent (un ancien hôte n'envoie que `cle`) : seules leurs cartes sont voilées, jamais
// toute la liste. Sans article connu, ou sans carte pour lui (l'article compilé n'a encore
// aucun défaut), rien n'est assombri : un simple bandeau le signale en tête.
// Le voile est reposé après chaque « valeurs » : rendre() reconstruit la liste et l'efface.
(function () {
  'use strict';
  var api = acquireVsCodeApi();
  var TXT = {};
  var titre = document.getElementById('titre');
  var barre = document.getElementById('barre');
  var lignes = document.getElementById('lignes');
  var ctlEtat = null;
  var voile = { actif: false, cles: [], texte: '' };

  // Retire toute trace du voile précédent, puis pose le nouveau s'il y a lieu. Idempotent :
  // appelé après chaque rendu et à chaque message ANALYSE, dans n'importe quel ordre.
  function poserVoile() {
    var poses = lignes.querySelectorAll('.szh-analyse-voile');
    for (var i = 0; i < poses.length; i++) { poses[i].remove(); }
    var voilees = lignes.querySelectorAll('.szh-analyse-cible');
    for (var j = 0; j < voilees.length; j++) {
      voilees[j].classList.remove('szh-analyse-cible');
      voilees[j].removeAttribute('aria-busy');
    }
    lignes.classList.remove('szh-analyse-cible');
    lignes.removeAttribute('aria-busy');
    if (!voile.actif) { return; }
    // Un article a une carte par gravité : toutes les siennes sont voilées, aucune autre.
    // Jamais toute la liste : sans article connu, ou sans carte pour lui, rien n'est
    // assombri et le bandeau prend seul la tête de la liste.
    var cibles = [];
    var cartes = lignes.querySelectorAll('.szh-carte');
    for (var k = 0; k < cartes.length; k++) {
      if (voile.cles.indexOf(cartes[k].dataset.cle) !== -1) { cibles.push(cartes[k]); }
    }
    if (cibles.length === 0) {
      lignes.insertBefore(bulle(true), lignes.firstChild);
      return;
    }
    for (var n = 0; n < cibles.length; n++) {
      cibles[n].classList.add('szh-analyse-cible');
      cibles[n].setAttribute('aria-busy', 'true');
      cibles[n].appendChild(bulle(false));
    }
  }

  // La roue et « Analyse en cours… ». role=status : un lecteur d'écran l'annonce sans
  // voler le focus, et une seule fois par voile posé.
  function bulle(bandeau) {
    var b = document.createElement('div');
    b.className = 'szh-analyse-voile' + (bandeau ? ' szh-analyse-voile--bandeau' : '');
    b.setAttribute('role', 'status');
    var roue = document.createElement('span');
    roue.className = 'szh-analyse-roue';
    roue.setAttribute('aria-hidden', 'true');
    b.appendChild(roue);
    var mot = document.createElement('span');
    mot.className = 'szh-analyse-texte';
    mot.textContent = voile.texte || '';
    b.appendChild(mot);
    return b;
  }

  function lireVoile(v) {
    var cles = [];
    if (v && v.actif) {
      if (Array.isArray(v.cles)) { cles = v.cles.map(String).filter(Boolean); }
      else if (v.cle) { cles = [String(v.cle)]; }
    }
    voile = (v && v.actif)
      ? { actif: true, cles: cles, texte: String(v.texte || '') }
      : { actif: false, cles: [], texte: '' };
  }

  var liste = SZH.listeCartes({
    conteneur: lignes,
    textes: function () { return TXT; },
    onOuvrir: function (cle) { api.postMessage({ type: SZH.MSG.OUVRIR, cle: cle }); },
    onAction: function (cle, id) { api.postMessage({ type: SZH.MSG.ACTION, id: id, cle: cle }); },
    onFermer: function (empreinte) {
      api.postMessage({ type: SZH.MSG.CONSTAT_FERMER, empreinte: empreinte });
    }
  });

  var recu = false;
  window.addEventListener('message', function (ev) {
    var msg = ev.data || {};
    recu = true;
    // Le panneau était déjà ouvert : l'hôte envoie ce message à part, sans reconstruire la
    // liste (revue F03, boutons de constat qui visent le dépôt Word par nom de fichier).
    if (msg.type === SZH.MSG.FOCALISER) { liste.focaliser(msg.focus); return; }
    // Le voile seul, sans reconstruire la liste : la compilation démarre ou s'achève.
    if (msg.type === SZH.MSG.ANALYSE) { lireVoile(msg); poserVoile(); return; }
    if (msg.type !== SZH.MSG.VALEURS) {
      if (msg.type === SZH.MSG.ETAT) { if (ctlEtat) { ctlEtat.textContent = msg.message || ''; } }
      else { console.warn('vue d’ensemble : type de message inconnu', msg.type); }
      return;
    }
    if (msg.i18n) { TXT = msg.i18n; }
    SZH.poserAccent(msg.accent);
    titre.textContent = msg.titre || '';
    ctlEtat = SZH.barreBoutons(barre, msg.boutons || [], function (id) {
      api.postMessage({ type: SZH.MSG.ACTION, id: id });
    });
    liste.rendre(msg.lignes || []);
    // Les vues sans voile (« Traductions », « Word en attente ») n'envoient pas le champ :
    // lu comme inactif, il n'y pose jamais rien.
    lireVoile(msg.analyse);
    poserVoile();
    // Le panneau vient de s'ouvrir : le focus voyage dans cette toute première « valeurs ».
    if (msg.focus) { liste.focaliser(msg.focus); }
  });
  SZH.annoncerPret(api, function () { return recu; });
})();
