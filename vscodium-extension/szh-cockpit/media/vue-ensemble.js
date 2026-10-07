// Vue d'ensemble d'une section de la barre latérale : une barre de commandes et une liste
// de lignes. L'hôte envoie les boutons et les lignes, la page les pose ; le même fichier
// sert « Traductions » et « Word en attente ». La barre et les cartes sont construites par
// SZH.barreBoutons et SZH.listeCartes (_commun.js), partagées avec la vue « Articles ».
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
// `fermable` vient de l'hôte, qui sait quels constats sont effaçables et retient
// l'empreinte de ceux qu'on a fermés.
//
// `focus` (un nom de fichier Word) désigne la carte dont `cle` lui est égal ([data-cle]) :
// elle est amenée à l'écran et marquée quelques secondes. Sans carte correspondante, rien
// ne se passe : lib/constats.js envoie des focus que toutes les cartes ne portent pas. Il
// arrive dans la première « valeurs » (panneau qui s'ouvre) ou dans un message
// « focaliser » (panneau déjà ouvert) ; voir ouvrirVueEnsemble d'extension.js.
//
// « action » vient de la barre sans `cle`, ou du bouton d'une carte avec la `cle` de sa
// ligne ; l'hôte départage.
//
// Le voile « Analyse en cours… » (vue « À corriger ») : { actif, cles, texte }, dans
// « valeurs » (champ `analyse`) ou dans un message ANALYSE. L'hôte le pose au début d'une
// compilation et le lève quand le journal est relu et la validation PDF/UA terminée
// (debuterAnalyse/terminerAnalyse d'extension.js). `cles` nomme les articles recompilés
// (`cle` seul est aussi accepté) : seules leurs cartes sont voilées. Sans carte pour eux,
// un bandeau en tête de liste le signale. Le voile est reposé après chaque « valeurs »,
// car rendre() reconstruit la liste.
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
    // Un article a une carte par gravité : toutes les siennes sont voilées. Sans carte
    // pour lui, seul le bandeau est posé en tête de liste.
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
    // liste.
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
    // Les vues sans voile (« Traductions », « Word en attente ») n'envoient pas le champ,
    // lu alors comme inactif.
    lireVoile(msg.analyse);
    poserVoile();
    // Le panneau vient de s'ouvrir : le focus arrive dans cette première « valeurs ».
    if (msg.focus) { liste.focaliser(msg.focus); }
  });
  SZH.annoncerPret(api, function () { return recu; });
})();
