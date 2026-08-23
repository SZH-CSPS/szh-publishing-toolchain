// Vue d'ensemble d'une section de la barre latérale : une barre de commandes globales, et
// une liste de lignes. Rien n'est décidé ici — l'hôte envoie les boutons et les lignes, la
// page les pose. Un seul fichier sert donc « Traductions » et « Word en attente », et la
// prochaine section qui en aura besoin.
//
// Cliquer l'onglet d'une section ouvre cette vue : les commandes globales y ont un bouton
// avec un texte, au lieu des pictogrammes muets que l'arbre alignait dans sa marge.
//
// Protocole. Vers l'hôte :
//   pret ; action { id } ; ouvrir { cle }
// Depuis l'hôte :
//   valeurs { titre, boutons, lignes, accent, i18n } ; etat { message }
// où un bouton vaut { id, libelle, icone, principal, danger, desactive } et une ligne
// { cle, groupe, titre, meta, pastilles: [{ texte, ton }], notif: { ton, texte }, ouvrir }.
(function () {
  'use strict';
  var api = acquireVsCodeApi();
  var TXT = {};
  var titre = document.getElementById('titre');
  var barre = document.getElementById('barre');
  var lignes = document.getElementById('lignes');

  function texte(parent, balise, cls, contenu) {
    var e = document.createElement(balise);
    if (cls) { e.className = cls; }
    if (contenu !== undefined && contenu !== null) { e.textContent = contenu; }
    parent.appendChild(e);
    return e;
  }

  // Texte court plus pictogramme : le premier dit ce que fait le bouton, le second le fait
  // reconnaître d'un coup d'œil dans une barre qui en porte plusieurs.
  function rendreBarre(boutons) {
    barre.textContent = '';
    for (var i = 0; i < boutons.length; i++) {
      var b = boutons[i];
      var bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'szh-bouton'
        + (b.principal ? ' szh-bouton--principal' : '')
        + (b.danger ? ' bouton-danger' : '');
      if (b.icone) { bouton.appendChild(SZH.icone(b.icone)); }
      texte(bouton, 'span', null, b.libelle || '');
      if (b.tip) { bouton.title = b.tip; }
      bouton.disabled = !!b.desactive;
      bouton.dataset.id = String(b.id || '');
      bouton.addEventListener('click', (function (id) {
        return function () { api.postMessage({ type: 'action', id: id }); };
      }(String(b.id || ''))));
      barre.appendChild(bouton);
    }
    texte(barre, 'span', 'szh-pousse');
    ctlEtat = texte(barre, 'span', 'szh-barre-etat');
    ctlEtat.setAttribute('role', 'status');
  }
  var ctlEtat = null;

  function rendreLignes(liste) {
    lignes.textContent = '';
    if (liste.length === 0) {
      lignes.appendChild(SZH.notif('info', TXT.rien || ''));
      return;
    }
    var groupe = null;
    for (var i = 0; i < liste.length; i++) {
      var l = liste[i];
      if (l.groupe && l.groupe !== groupe) {
        groupe = l.groupe;
        texte(lignes, 'h2', 'titre-section', groupe);
      }
      var carte = texte(lignes, 'section', 'szh-carte ligne');
      var tete = texte(carte, 'header', 'szh-tete');
      texte(tete, 'p', 'szh-tete-nom', l.titre || '');
      if (l.meta) { texte(tete, 'span', 'szh-tete-meta', l.meta); }
      for (var k = 0; k < (l.pastilles || []).length; k++) {
        var p = l.pastilles[k];
        texte(tete, 'span', 'szh-pastille' + (p.ton ? ' szh-pastille--' + p.ton : ''), p.texte || '');
      }
      texte(tete, 'span', 'szh-pousse');
      if (l.ouvrir) {
        var ouvrir = document.createElement('button');
        ouvrir.type = 'button';
        ouvrir.className = 'szh-bouton';
        texte(ouvrir, 'span', null, TXT.ouvrir || '');
        ouvrir.addEventListener('click', (function (cle) {
          return function () { api.postMessage({ type: 'ouvrir', cle: cle }); };
        }(String(l.cle || ''))));
        tete.appendChild(ouvrir);
      }
      // Ce qui demande d'être lu — un message de conversion, une erreur — vit dans le corps
      // de la carte, pas dans une infobulle.
      if (l.notif && l.notif.texte) {
        var corps = texte(carte, 'div', 'szh-corps');
        corps.appendChild(SZH.notif(l.notif.ton || 'info', l.notif.texte));
      }
    }
  }

  var recu = false;
  window.addEventListener('message', function (ev) {
    var msg = ev.data || {};
    recu = true;
    if (msg.type !== 'valeurs') {
      if (msg.type === 'etat' && ctlEtat) { ctlEtat.textContent = msg.message || ''; }
      return;
    }
    if (msg.i18n) { TXT = msg.i18n; }
    SZH.poserAccent(msg.accent);
    titre.textContent = msg.titre || '';
    rendreBarre(msg.boutons || []);
    rendreLignes(msg.lignes || []);
  });
  SZH.annoncerPret(api, function () { return recu; });
})();
