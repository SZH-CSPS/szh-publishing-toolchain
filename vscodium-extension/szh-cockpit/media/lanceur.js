// Le lanceur dans l'éditeur : six onglets, Produits ouvert d'office. Chaque tâche fréquente
// tient en un ou deux clics : tout ce qui se déduit est déjà choisi.
//
// Protocole. Vers l'hôte : pret, lanceurOnglet { onglet }, lanceurOuvrir { chemin },
// lanceurVersions, lanceurCreer { produit, annee, numero, volume, volumeManuel } ou
// { produit, titre, annee, reference, genre, maquette, format },
// lanceurExporter { commande, revue, numeros | cles }, lanceurOjsCharger { revue, depuisAnnee },
// lanceurInterrompre { commande }, lanceurAfficher { chemin },
// lanceurJournalLire { rang }, lanceurJournalEditeur { rang }, lanceurSignaler { phrase, rang }.
// Depuis l'hôte :
//   charger { langue, produit?, anneeCourante, modeTest, ancrageAbsent, version, exports,
//             produits: [{ jeton, libelle, type: 'numero' | 'livre', racine, anneeZeroVolume,
//                          hors: { nombre, dossier }, enCours: [entrée], archives: [entrée] }],
//             dernierOuvert, historique: { edudoc: { <revue>: { <clé>: <date> } }, caracteres },
//             journaux: [{ rang, date, verdict, ko }] }
//     entrée : { nom, titre, chemin, modifie, verrouillee }
//   lanceurCree { ok, texte }   la création a été refusée (ok faux) ; sinon la fenêtre change
//   lanceurDebut { commande }   une tâche ou le chargement des numéros (« numeros-ojs ») part
//   lanceurLigne { commande, ligne }   une ligne JSON de secretariat-cli.js, telle quelle
//   lanceurFin { commande, ok, texte, annule, dossier, date }
//   lanceurJournalTexte { rang, texte, lignes } ou { rang, erreur }
//   lanceurSignale { issue: 'fait' | 'attente' | 'refuse', courriel }
(function () {
  'use strict';
  var TXT = __TXT__;
  var MSG = SZH.MSG;
  var poser = SZH.poser;
  var api = acquireVsCodeApi();
  var recu = false;
  var racine = document.getElementById('lanceur');

  // Un vrai pluriel : chaque texte compté a sa forme au singulier (…Un) et au pluriel (…Plus).
  function pluriel(n, cle, valeurs) { return SZH.remplir(TXT, cle + (n === 1 ? 'Un' : 'Plus'), valeurs); }
  function avis(zone, ton, texte) {
    zone.textContent = '';
    if (texte) { zone.appendChild(SZH.notif(ton, texte)); }
  }
  // Un bouton qui se lit comme un lien : une action secondaire, qui ne doit pas peser autant
  // que le bouton de la tâche.
  function lien(texte, fn) { return SZH.bouton(texte, fn, 'lanceur-lien'); }

  var donnees = { langue: 'fr', anneeCourante: 0, produits: [], historique: {}, exports: '' };
  function produitDe(jeton) { return donnees.produits.filter(function (p) { return p.jeton === jeton; })[0] || null; }
  function revues() { return donnees.produits.filter(function (p) { return p.type !== 'livre'; }); }

  // ---- Onglets ----
  // Navigation au clavier selon WAI-ARIA : flèches, Origine et Fin, l'onglet atteint s'active.
  var ONGLETS = [
    { cle: 'produits', libelle: TXT.ongletProduits },
    { cle: 'nouveau', libelle: TXT.ongletNouveau },
    { cle: 'preproc', libelle: TXT.ongletPreproc },
    { cle: 'secretariat', libelle: TXT.ongletSecretariat },
    { cle: 'reglages', libelle: TXT.ongletReglages },
    { cle: 'journal', libelle: TXT.ongletJournal }
  ];
  var tablist = poser(racine, 'div', 'lanceur-onglets');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', TXT.ongletsAria);
  var boutonsOnglet = [];
  var panneaux = {};
  ONGLETS.forEach(function (o, i) {
    var b = poser(tablist, 'button', 'lanceur-onglet', o.libelle);
    b.type = 'button';
    b.id = 'onglet-' + o.cle;
    // Le pseudo-élément ::after réserve la largeur du libellé en gras : l'onglet choisi ne
    // pousse plus ses voisins.
    b.dataset.libelle = o.libelle;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', 'panneau-' + o.cle);
    b.addEventListener('click', function () {
      activer(o.cle, true);
      // Au clic, le bouton de création reçoit le focus : Entrée crée ce qui est proposé.
      if (o.cle === 'nouveau') { focaliserNouveau(); }
    });
    b.addEventListener('keydown', function (ev) {
      var cible = -1;
      if (ev.key === 'ArrowRight') { cible = (i + 1) % ONGLETS.length; }
      else if (ev.key === 'ArrowLeft') { cible = (i - 1 + ONGLETS.length) % ONGLETS.length; }
      else if (ev.key === 'Home') { cible = 0; }
      else if (ev.key === 'End') { cible = ONGLETS.length - 1; }
      if (cible === -1) { return; }
      ev.preventDefault();
      activer(ONGLETS[cible].cle, true);
      boutonsOnglet[cible].focus();
    });
    boutonsOnglet.push(b);
    var p = poser(racine, 'section', 'lanceur-panneau');
    p.id = 'panneau-' + o.cle;
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', b.id);
    p.setAttribute('tabindex', '-1');
    panneaux[o.cle] = p;
  });
  var ongletActif = '';

  function activer(cle, parGeste) {
    if (!panneaux[cle]) { cle = ONGLETS[0].cle; }
    ongletActif = cle;
    ONGLETS.forEach(function (o, i) {
      var choisi = o.cle === cle;
      boutonsOnglet[i].setAttribute('aria-selected', choisi ? 'true' : 'false');
      boutonsOnglet[i].setAttribute('tabindex', choisi ? '0' : '-1');
      panneaux[o.cle].hidden = !choisi;
    });
    if (parGeste) { api.postMessage({ type: MSG.LANCEUR_ONGLET, onglet: cle }); }
    if (!recu) { return; }
    if (cle === 'secretariat') { assurerOjs(revueSec()); }
    if (cle === 'journal') { ouvrirJournalRecent(); }
  }
  // Produits d'abord, toujours : c'est le geste de tous les quinze jours.
  activer('produits', false);

  ['preproc', 'reglages'].forEach(function (cle) {
    panneaux[cle].appendChild(SZH.notif('info', TXT.avenir));
  });

  // ---- Le produit choisi ----
  // Un seul choix pour Produits, Nouveau et Secrétariat : passer à la Zeitschrift dans un
  // onglet la montre dans les deux autres. Le défaut suit la langue de l'interface, sauf
  // si l'hôte transmet un produit choisi dans les Paramètres.
  var produitChoisi = '';
  var groupesProduit = [];
  function produitParDefaut(msg) {
    var jetons = (msg.produits || []).map(function (p) { return p.jeton; });
    if (msg.produit && jetons.indexOf(msg.produit) !== -1) { return msg.produit; }
    var parLangue = msg.langue === 'fr' ? 'revue' : 'zeitschrift';
    if (jetons.indexOf(parLangue) !== -1) { return parLangue; }
    return jetons[0] || '';
  }
  // Des boutons radio natifs : les flèches passent d'un produit à l'autre sans rien écrire.
  function groupeProduit(parent, nom, filtre) {
    var g = poser(parent, 'div', 'lanceur-segments');
    g.setAttribute('role', 'radiogroup');
    g.setAttribute('aria-label', TXT.prodChoix);
    var entree = { element: g, nom: nom, filtre: filtre, radios: [] };
    groupesProduit.push(entree);
    return entree;
  }
  function rendreGroupes() {
    groupesProduit.forEach(function (g) {
      g.element.textContent = '';
      g.radios = [];
      var liste = donnees.produits.filter(g.filtre);
      g.element.hidden = liste.length < 2;
      liste.forEach(function (p) {
        var l = poser(g.element, 'label', 'lanceur-segment');
        var r = poser(l, 'input', '');
        r.type = 'radio';
        r.name = g.nom;
        r.value = p.jeton;
        r.id = g.nom + '-' + p.jeton;
        r.addEventListener('change', function () { if (r.checked) { choisirProduit(p.jeton); } });
        poser(l, 'span', '', p.libelle);
        g.radios.push(r);
      });
    });
  }
  function choisirProduit(jeton) {
    produitChoisi = jeton;
    groupesProduit.forEach(function (g) {
      var vise = g === groupeSec ? revueSec() : jeton;
      g.radios.forEach(function (r) { r.checked = r.value === vise; });
    });
    rendreProduits(false);
    rendreNouveau();
    rendreSecretariat();
    if (ongletActif === 'secretariat') { assurerOjs(revueSec()); }
  }

  // ---- Liste à choix simple ----
  // Le motif listbox de WAI-ARIA : la liste prend le focus, l'option active se suit par
  // aria-activedescendant et la sélection suit les flèches. Entrée et le double-clic
  // déclenchent `surActiver`.
  function listeChoix(opts) {
    var ul = poser(opts.parent, 'ul', 'lanceur-liste');
    ul.setAttribute('role', 'listbox');
    ul.setAttribute('tabindex', '0');
    ul.setAttribute('aria-labelledby', opts.etiquettePar);
    var lis = [];
    var cles = [];
    var actif = -1;

    function marquer() {
      for (var i = 0; i < lis.length; i++) {
        lis[i].setAttribute('aria-selected', i === actif ? 'true' : 'false');
        lis[i].classList.toggle('actif', i === actif);
      }
      if (actif >= 0 && lis[actif]) {
        ul.setAttribute('aria-activedescendant', lis[actif].id);
        if (lis[actif].scrollIntoView) { lis[actif].scrollIntoView({ block: 'nearest' }); }
      } else {
        ul.removeAttribute('aria-activedescendant');
      }
    }
    function choisir(i, prevenir) {
      actif = i;
      marquer();
      if (prevenir && opts.surChange) { opts.surChange(selection()); }
    }
    ul.addEventListener('keydown', function (ev) {
      if (!lis.length) { return; }
      var cible = -1;
      if (ev.key === 'ArrowDown') { cible = Math.min(lis.length - 1, actif + 1); }
      else if (ev.key === 'ArrowUp') { cible = Math.max(0, actif - 1); }
      else if (ev.key === 'Home') { cible = 0; }
      else if (ev.key === 'End') { cible = lis.length - 1; }
      if (cible !== -1) { ev.preventDefault(); choisir(cible, true); return; }
      if (ev.key === 'Enter' && actif >= 0 && opts.surActiver) { ev.preventDefault(); opts.surActiver(cles[actif]); }
    });

    function remplir(options) {
      ul.textContent = '';
      lis = []; cles = []; actif = -1;
      (options || []).forEach(function (o, i) {
        var li = poser(ul, 'li', 'lanceur-option');
        li.id = opts.prefixe + '-' + i;
        li.setAttribute('role', 'option');
        o.rendre(li);
        li.addEventListener('click', function () {
          if (ul.focus) { ul.focus(); }
          choisir(i, true);
        });
        li.addEventListener('dblclick', function () {
          choisir(i, true);
          if (opts.surActiver) { opts.surActiver(cles[i]); }
        });
        lis.push(li); cles.push(o.cle);
      });
      ul.hidden = lis.length === 0;
      marquer();
    }
    function selection() { return actif >= 0 ? cles[actif] : null; }
    function selectionner(cle) { choisir(cles.indexOf(cle), false); }
    return { remplir: remplir, selection: selection, selectionner: selectionner, element: ul,
      taille: function () { return lis.length; } };
  }

  // ---- Produits ----
  var prod = panneaux.produits;
  var prodAvis = poser(prod, 'div', 'lanceur-avis');
  var prodTete = poser(prod, 'div', 'lanceur-tete');
  groupeProduit(prodTete, 'produit-prod', function () { return true; });
  var prodEtiq = poser(prod, 'p', 'lanceur-etiquette', TXT.prodEnCours);
  prodEtiq.id = 'prod-etiquette';
  var prodVide = poser(prod, 'div', 'lanceur-vide');
  prodVide.hidden = true;
  var prodVideTexte = poser(prodVide, 'p', '');
  var boutonPremier = SZH.bouton(TXT.prodCreer, function () {
    activer('nouveau', true);
    boutonsOnglet[1].focus();
  }, 'szh-bouton--principal');
  boutonPremier.id = 'prod-creer';
  prodVide.appendChild(boutonPremier);
  var listeEnCours = listeChoix({ parent: prod, etiquettePar: 'prod-etiquette', prefixe: 'entree',
    surChange: function () { listeArchives.selectionner(null); majOuvrir(); }, surActiver: ouvrir });
  var archives = poser(prod, 'details', 'lanceur-archives');
  var archivesTitre = poser(archives, 'summary', '');
  archivesTitre.id = 'prod-archives';
  var archivesVide = poser(archives, 'p', 'lanceur-vide', TXT.prodArchivesVide);
  var listeArchives = listeChoix({ parent: archives, etiquettePar: 'prod-archives', prefixe: 'archive',
    surChange: function () { listeEnCours.selectionner(null); majOuvrir(); }, surActiver: ouvrir });
  var prodPied = poser(prod, 'div', 'lanceur-pied-action');
  var prodInfos = poser(prodPied, 'p', 'lanceur-infos');
  poser(prodPied, 'span', 'szh-pousse');
  var prodAstuce = poser(prodPied, 'span', 'lanceur-astuce', TXT.prodAstuce);
  var boutonOuvrir = SZH.bouton(TXT.prodOuvrir, function () {
    var c = listeEnCours.selection() || listeArchives.selection();
    if (c) { ouvrir(c); }
  }, 'szh-bouton--principal');
  boutonOuvrir.id = 'prod-ouvrir';
  prodPied.appendChild(boutonOuvrir);

  function ouvrir(chemin) { if (chemin) { api.postMessage({ type: MSG.LANCEUR_OUVRIR, chemin: chemin }); } }
  function majOuvrir() { boutonOuvrir.disabled = !(listeEnCours.selection() || listeArchives.selection()); }

  function rendreEntree(p, e) {
    return { cle: e.chemin, rendre: function (li) {
      if (p.type === 'livre') {
        poser(li, 'span', 'lanceur-cellule-titre', e.titre || e.nom);
      } else {
        poser(li, 'span', 'lanceur-cellule-nom', e.nom);
        poser(li, 'span', 'lanceur-cellule-titre', e.titre || '');
      }
      if (e.chemin === donnees.dernierOuvert) { poser(li, 'span', 'szh-pastille szh-pastille--accent', TXT.prodDernier); }
      if (e.verrouillee) { poser(li, 'span', 'szh-pastille', TXT.prodVerrouille); }
      if (e.modifie) { poser(li, 'span', 'lanceur-cellule-meta', SZH.remplir(TXT, 'prodModifie', [e.modifie])); }
    } };
  }
  function rendreProduits(focaliser) {
    var p = produitDe(produitChoisi);
    var enCours = p ? p.enCours || [] : [];
    var arch = p ? p.archives || [] : [];
    listeEnCours.remplir(enCours.map(function (e) { return rendreEntree(p, e); }));
    listeArchives.remplir(arch.map(function (e) { return rendreEntree(p, e); }));
    archivesTitre.textContent = SZH.remplir(TXT, 'prodArchives', [arch.length]);
    archivesVide.hidden = arch.length > 0;
    var rien = enCours.length + arch.length === 0;
    prodVide.hidden = !rien;
    prodVideTexte.textContent = p ? SZH.remplir(TXT, 'prodVide', [p.libelle]) : '';
    prodEtiq.hidden = rien;
    archives.hidden = rien;
    prodAstuce.hidden = rien;
    boutonOuvrir.hidden = rien;
    // Le dernier ouvert, s'il est de ce produit ; sinon le plus récemment modifié.
    var dernier = donnees.dernierOuvert;
    var dansArchives = arch.some(function (e) { return e.chemin === dernier; });
    if (enCours.some(function (e) { return e.chemin === dernier; })) { listeEnCours.selectionner(dernier); }
    else if (dansArchives) { archives.open = true; listeArchives.selectionner(dernier); }
    else if (enCours.length) { listeEnCours.selectionner(enCours[0].chemin); }
    majOuvrir();
    rendreInfos(p);
    if (focaliser && ongletActif === 'produits') {
      var cible = dansArchives ? listeArchives : listeEnCours;
      if (cible.taille()) { cible.element.focus(); }
      else if (rien) { boutonPremier.focus(); }
    }
  }
  function rendreInfos(p) {
    prodInfos.textContent = '';
    if (p && p.racine) { poser(prodInfos, 'span', '', SZH.remplir(TXT, 'prodDans', [p.libelle, p.racine])); }
    poser(prodInfos, 'span', '', donnees.version ? SZH.remplir(TXT, 'prodVersion', [donnees.version]) : TXT.prodVersionInconnue);
    var l = lien(TXT.prodVersions, function () { api.postMessage({ type: MSG.LANCEUR_VERSIONS }); });
    l.id = 'prod-versions';
    prodInfos.appendChild(l);
    prodAvis.textContent = '';
    if (donnees.modeTest) { prodAvis.appendChild(SZH.notif('attention', TXT.modeTest)); }
    if (donnees.ancrageAbsent) { prodAvis.appendChild(SZH.notif('danger', TXT.ancrageAbsent)); }
    if (p && p.hors && p.hors.nombre > 0) {
      prodAvis.appendChild(SZH.notif('attention', pluriel(p.hors.nombre, 'prodHors', [p.hors.nombre, p.hors.dossier])));
    }
  }

  // ---- Nouveau ----
  var nv = panneaux.nouveau;
  var nvAvis = poser(nv, 'div', 'lanceur-avis');
  var nvTete = poser(nv, 'div', 'lanceur-tete');
  groupeProduit(nvTete, 'produit-nv', function () { return true; });
  var nvForm = poser(nv, 'div', 'lanceur-formulaire');
  var nvErreur = poser(nv, 'p', 'lanceur-erreur');
  nvErreur.id = 'nv-erreur';
  nvErreur.setAttribute('role', 'alert');
  var nvPied = poser(nv, 'div', 'lanceur-pied-action');
  var nvOu = poser(nvPied, 'p', 'lanceur-infos');
  poser(nvPied, 'span', 'szh-pousse');
  var boutonCreer = SZH.bouton(TXT.nvCreer, creer, 'szh-bouton--principal');
  boutonCreer.id = 'nv-creer';
  nvPied.appendChild(boutonCreer);
  var nvRefus = poser(nv, 'div', 'lanceur-avis');
  nvRefus.setAttribute('role', 'status');
  var nvChamps = {};
  var nvConteneurs = {};
  var volumeLu = null;
  var volumeManuel = false;

  function champ(parent, cle, libelle, type) {
    var c = poser(parent, 'div', 'szh-champ lanceur-champ-' + cle);
    var l = poser(c, 'label', '', libelle);
    var i = poser(c, type === 'select' ? 'select' : 'input', '');
    if (type !== 'select') { i.type = type || 'text'; }
    i.id = 'nv-' + cle;
    l.setAttribute('for', i.id);
    i.addEventListener(type === 'select' ? 'change' : 'input', verifierNouveau);
    i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); creer(); } });
    nvChamps[cle] = i;
    nvConteneurs[cle] = c;
    return c;
  }
  function options(select, liste) {
    liste.forEach(function (o) { var e = poser(select, 'option', '', o[1]); e.value = o[0]; });
  }
  function entreesDe(p) { return p ? (p.enCours || []).concat(p.archives || []) : []; }
  // Le numéro qui suit le plus haut de l'année ; l'année est la courante, ou une suivante
  // si un numéro y est déjà préparé.
  function numeroSuivant(p, annee) {
    var max = 0;
    entreesDe(p).forEach(function (e) {
      var m = /^(\d{4})-(\d{2})$/.exec(e.nom);
      if (m && Number(m[1]) === annee) { max = Math.max(max, Number(m[2])); }
    });
    return max + 1;
  }
  function anneeProposee(p) {
    var annee = donnees.anneeCourante;
    entreesDe(p).forEach(function (e) {
      var m = /^(\d{4})-\d{2}$/.exec(e.nom);
      if (m && Number(m[1]) > annee) { annee = Number(m[1]); }
    });
    return annee;
  }
  function referenceSuivante(p) {
    var max = 0;
    entreesDe(p).forEach(function (e) {
      var m = /^\d{4}-B(\d+)-/.exec(e.nom);
      if (m) { max = Math.max(max, Number(m[1])); }
    });
    return max + 1;
  }
  function deuxChiffres(n) { return (n < 10 ? '0' : '') + n; }

  function rendreNouveau() {
    var p = produitDe(produitChoisi);
    nvForm.textContent = '';
    nvChamps = {};
    nvConteneurs = {};
    volumeManuel = false;
    avis(nvRefus, '', '');
    avis(nvAvis, '', '');
    if (donnees.modeTest) { nvAvis.appendChild(SZH.notif('attention', TXT.modeTest)); }
    if (!p) { return; }
    if (p.type === 'livre') {
      var ligneTitre = poser(nvForm, 'div', 'lanceur-champs');
      champ(ligneTitre, 'titre', TXT.nvTitre, 'text');
      nvChamps.titre.maxLength = 200;
      var ligne = poser(nvForm, 'div', 'lanceur-champs');
      champ(ligne, 'annee', TXT.nvAnnee, 'number');
      champ(ligne, 'reference', TXT.nvReference, 'number');
      champ(ligne, 'genre', TXT.nvType, 'select');
      options(nvChamps.genre, [['monographie', TXT.nvTypeMono], ['collectif', TXT.nvTypeCollectif]]);
      champ(ligne, 'maquette', TXT.nvMaquette, 'select');
      options(nvChamps.maquette, [['normal', TXT.nvMaquetteNormal], ['falc', TXT.nvMaquetteFalc]]);
      champ(ligne, 'format', TXT.nvFormat, 'select');
      options(nvChamps.format, [['standard', TXT.nvFormatStandard], ['a4', TXT.nvFormatA4]]);
      nvChamps.annee.value = String(donnees.anneeCourante);
      nvChamps.reference.value = String(referenceSuivante(p));
    } else {
      var ligneNum = poser(nvForm, 'div', 'lanceur-champs');
      champ(ligneNum, 'annee', TXT.nvAnnee, 'number');
      champ(ligneNum, 'numero', TXT.nvNumero, 'number');
      var cVolume = champ(ligneNum, 'volume', TXT.nvVolumeLibelle, 'number');
      cVolume.hidden = true;
      volumeLu = poser(ligneNum, 'div', 'lanceur-volume');
      var annee = anneeProposee(p);
      nvChamps.annee.value = String(annee);
      nvChamps.numero.value = String(numeroSuivant(p, annee));
      nvChamps.numero.min = '1';
      nvChamps.numero.max = '99';
      nvChamps.annee.addEventListener('change', function () {
        nvChamps.numero.value = String(numeroSuivant(p, Number(nvChamps.annee.value)));
        verifierNouveau();
      });
      nvChamps.numero.setAttribute('aria-describedby', 'nv-erreur');
    }
    verifierNouveau();
  }

  // Ce qui se vérifie sans l'hôte : un nom déjà pris, un titre manquant. Le doublon de
  // volume et de numéro se décide chez l'hôte, qui répond par lanceurCree.
  function verifierNouveau() {
    var p = produitDe(produitChoisi);
    if (!p || !nvChamps.annee) { return; }
    var erreur = '';
    if (p.type === 'livre') {
      var falc = nvChamps.maquette.value === 'falc';
      nvConteneurs.format.hidden = !falc;
      if (!falc) { nvChamps.format.value = 'standard'; }
      var ref = Number(nvChamps.reference.value);
      var prise = entreesDe(p).filter(function (e) { return new RegExp('^\\d{4}-B' + ref + '-').test(e.nom); })[0];
      if (prise) { erreur = SZH.remplir(TXT, 'nvReferencePrise', [ref, prise.titre || prise.nom]); }
      nvOu.textContent = SZH.remplir(TXT, 'nvOu', [p.racine || '']);
      boutonCreer.disabled = !!erreur || !String(nvChamps.titre.value || '').trim();
    } else {
      var annee = Number(nvChamps.annee.value);
      var numero = Number(nvChamps.numero.value);
      var nom = annee + '-' + deuxChiffres(numero);
      var deja = entreesDe(p).filter(function (e) { return e.nom === nom; })[0];
      if (!(numero >= 1 && numero <= 99)) { erreur = TXT.nvNumeroHors; }
      else if (deja) { erreur = SZH.remplir(TXT, 'nvExiste', [nom, deja.titre || deja.nom]); }
      if (!volumeManuel && p.anneeZeroVolume) { nvChamps.volume.value = String(annee - p.anneeZeroVolume); }
      volumeLu.textContent = '';
      poser(volumeLu, 'span', '', SZH.remplir(TXT, 'nvVolume', [nvChamps.volume.value]));
      var b = lien(volumeManuel ? TXT.nvVolumeAuto : TXT.nvVolumeManuel, basculerVolume);
      b.id = 'nv-volume-bascule';
      volumeLu.appendChild(b);
      nvOu.textContent = SZH.remplir(TXT, 'nvDossier', [nom, p.racine || '']);
      boutonCreer.disabled = !!erreur;
      nvChamps.numero.setAttribute('aria-invalid', erreur ? 'true' : 'false');
    }
    nvErreur.textContent = erreur;
    nvErreur.hidden = !erreur;
  }
  // Le volume se déduit de l'année ; le régler à la main reste possible, mais déconseillé :
  // un volume faux s'imprime sur la couverture.
  function basculerVolume() {
    volumeManuel = !volumeManuel;
    nvConteneurs.volume.hidden = !volumeManuel;
    verifierNouveau();
    if (volumeManuel) { nvChamps.volume.focus(); }
  }
  function focaliserNouveau() {
    if (nvChamps.titre) { nvChamps.titre.focus(); }
    else if (!boutonCreer.disabled) { boutonCreer.focus(); }
  }
  function creer() {
    var p = produitDe(produitChoisi);
    if (!p || boutonCreer.disabled) { return; }
    var m = { type: MSG.LANCEUR_CREER, produit: p.jeton, annee: Number(nvChamps.annee.value) };
    if (p.type === 'livre') {
      m.titre = String(nvChamps.titre.value || '').trim();
      m.reference = Number(nvChamps.reference.value);
      m.genre = nvChamps.genre.value;
      m.maquette = nvChamps.maquette.value;
      m.format = nvChamps.format.value;
    } else {
      m.numero = Number(nvChamps.numero.value);
      m.volume = Number(nvChamps.volume.value);
      m.volumeManuel = volumeManuel;
    }
    avis(nvRefus, '', '');
    api.postMessage(m);
  }

  // ---- Secrétariat ----
  // Une ligne par tâche, rangées par fréquence. Chacune a ses réglages déjà remplis et un
  // seul bouton ; son avancement, son issue et ses détails s'affichent sous elle.
  var sec = panneaux.secretariat;
  var secTete = poser(sec, 'div', 'lanceur-tete');
  var groupeSec = groupeProduit(secTete, 'produit-sec', function (p) { return p.type !== 'livre'; });
  var revueChoisie = '';
  function revueSec() {
    var liste = revues();
    if (liste.some(function (p) { return p.jeton === produitChoisi; })) { return produitChoisi; }
    if (liste.some(function (p) { return p.jeton === revueChoisie; })) { return revueChoisie; }
    return liste.length ? liste[0].jeton : '';
  }

  var TACHES = [
    { commande: 'newsletter', nom: TXT.secNewsletter, aide: TXT.secNewsletterAide, bouton: TXT.secCreer,
      reussi: TXT.secReussiNewsletter, local: true },
    { commande: 'metadonnees', nom: TXT.secMetadonnees, aide: TXT.secMetadonneesAide, bouton: TXT.secControler,
      reussi: TXT.secReussiMetadonnees, local: true },
    { commande: 'edudoc', nom: TXT.secEdudoc, aide: TXT.secEdudocAide, bouton: TXT.secExporter,
      reussi: TXT.secReussiEdudoc, trimestriel: true },
    { commande: 'caracteres', nom: TXT.secCaracteres, aide: TXT.secCaracteresAide, bouton: TXT.secExporter,
      reussi: TXT.secReussiCaracteres }
  ];
  var taches = {};
  var tacheEnCours = '';
  var listeTaches = poser(sec, 'div', 'lanceur-taches');

  TACHES.forEach(function (t) {
    if (t.trimestriel) { poser(listeTaches, 'h2', 'lanceur-intertitre', TXT.secTrimestriels); }
    var el = poser(listeTaches, 'div', 'lanceur-tache');
    el.dataset.tache = t.commande;
    el.setAttribute('role', 'group');
    var ligne = poser(el, 'div', 'lanceur-tache-ligne');
    var texte = poser(ligne, 'div', 'lanceur-tache-texte');
    var nom = poser(texte, 'h3', 'lanceur-tache-nom', t.nom);
    nom.id = 'tache-' + t.commande;
    el.setAttribute('aria-labelledby', nom.id);
    poser(texte, 'p', 'lanceur-tache-aide', t.aide);
    var reglage = poser(ligne, 'div', 'lanceur-tache-reglage');
    var action = poser(ligne, 'div', 'lanceur-tache-action');
    var bouton = SZH.bouton(t.bouton, function () { lancer(t); });
    bouton.id = 'sec-' + t.commande;
    action.appendChild(bouton);
    var interrompre = SZH.bouton(TXT.secInterrompre, function () {
      interrompre.disabled = true;
      api.postMessage({ type: MSG.LANCEUR_INTERROMPRE, commande: t.commande });
    });
    interrompre.id = 'sec-' + t.commande + '-interrompre';
    interrompre.hidden = true;
    action.appendChild(interrompre);
    var x = { t: t, el: el, bouton: bouton, interrompre: interrompre, fichiers: [], choix: [] };
    if (t.local) {
      var sel = poser(reglage, 'select', 'lanceur-select');
      sel.id = 'sec-' + t.commande + '-numero';
      sel.setAttribute('aria-label', TXT.secNumero);
      x.select = sel;
    } else {
      x.resume = poser(reglage, 'p', 'lanceur-resume');
      x.resume.id = 'sec-' + t.commande + '-resume';
      x.resume.setAttribute('aria-live', 'polite');
      x.modifier = lien(TXT.secModifier, function () { deplier(x, x.cases.hidden); });
      x.modifier.id = 'sec-' + t.commande + '-modifier';
      x.modifier.setAttribute('aria-expanded', 'false');
      x.modifier.setAttribute('aria-controls', 'sec-' + t.commande + '-cases');
      reglage.appendChild(x.modifier);
      x.cases = poser(el, 'fieldset', 'lanceur-cases');
      x.cases.id = 'sec-' + t.commande + '-cases';
      x.cases.hidden = true;
      poser(x.cases, 'legend', '', TXT.secCasesLegende);
      x.grille = poser(x.cases, 'div', 'lanceur-cases-grille');
      var piedCases = poser(x.cases, 'div', 'lanceur-cases-pied');
      x.plus = lien('', function () { chargerAnneePrecedente(); });
      x.plus.id = 'sec-' + t.commande + '-plus';
      piedCases.appendChild(x.plus);
      x.finCourse = poser(piedCases, 'span', 'lanceur-astuce', TXT.secFinCourse);
    }
    x.barre = poser(el, 'progress', 'lanceur-barre');
    x.barre.setAttribute('aria-labelledby', nom.id);
    x.barre.hidden = true;
    x.issue = poser(el, 'div', 'lanceur-issue');
    x.issue.setAttribute('role', 'status');
    x.details = poser(el, 'details', 'lanceur-details');
    poser(x.details, 'summary', '', TXT.secDetails);
    x.journal = poser(x.details, 'div', 'lanceur-journal');
    x.journal.setAttribute('role', 'log');
    x.journal.setAttribute('aria-labelledby', nom.id);
    x.journal.setAttribute('tabindex', '0');
    x.details.hidden = true;
    taches[t.commande] = x;
  });
  var secDossier = poser(sec, 'p', 'lanceur-infos');

  function cleCourte(n) { return SZH.remplir(TXT, 'secNumeroCourt', [n.annee, Number(n.numero)]); }
  function historiqueDe(commande, revue) {
    var h = (donnees.historique || {})[commande] || {};
    return h[revue] || {};
  }

  // Les numéros publiés en ligne, chargés une fois par revue, dès l'ouverture de l'onglet.
  var ojs = {};
  var ojsRevueEnCours = '';
  function etatOjs(revue) {
    if (!ojs[revue]) { ojs[revue] = { etat: 'vide', numeros: [], recus: [], plancher: 0, demandee: 0, dernierNombre: 0, finDeCourse: false, erreur: '' }; }
    return ojs[revue];
  }
  // Depuis l'année du dernier numéro exporté : tout ce qui n'est pas encore parti y est.
  function anneeDepart(revue) {
    var annee = donnees.anneeCourante;
    ['edudoc', 'caracteres'].forEach(function (c) {
      var cles = Object.keys(historiqueDe(c, revue));
      if (!cles.length) { return; }
      var recente = Math.max.apply(null, cles.map(function (k) { return Number(k.slice(0, 4)) || annee; }));
      annee = Math.min(annee, recente);
    });
    return annee;
  }
  function assurerOjs(revue) {
    if (!revue) { return; }
    var o = etatOjs(revue);
    if (o.etat === 'vide' || o.etat === 'erreur') { chargerOjs(revue, anneeDepart(revue)); }
  }
  function chargerOjs(revue, annee) {
    if (ojsRevueEnCours) { return; }
    var o = etatOjs(revue);
    o.etat = 'charge';
    o.demandee = annee;
    o.recus = [];
    ojsRevueEnCours = revue;
    rendreSecretariat();
    api.postMessage({ type: MSG.LANCEUR_OJS_CHARGER, revue: revue, depuisAnnee: annee });
  }
  function chargerAnneePrecedente() {
    var revue = revueSec();
    var o = etatOjs(revue);
    if (o.etat !== 'pret' || o.finDeCourse) { return; }
    chargerOjs(revue, o.plancher - 1);
  }
  // Cochés d'office : les numéros parus après le dernier que l'historique du compte connaît ;
  // sans historique, ceux de l'année.
  function choixParDefaut(x, revue) {
    var h = historiqueDe(x.t.commande, revue);
    var connus = Object.keys(h).sort();
    var dernier = connus[connus.length - 1];
    return etatOjs(revue).numeros.filter(function (n) {
      return dernier ? n.cle > dernier : Number(n.annee) === donnees.anneeCourante;
    }).map(function (n) { return n.cle; });
  }
  function deplier(x, ouvrirCases) {
    x.cases.hidden = !ouvrirCases;
    x.modifier.setAttribute('aria-expanded', ouvrirCases ? 'true' : 'false');
    if (ouvrirCases) { assurerOjs(revueSec()); }
  }

  function rendreSecretariat() {
    var revue = revueSec();
    revueChoisie = revue;
    groupeSec.radios.forEach(function (r) { r.checked = r.value === revue; });
    var p = produitDe(revue);
    var locaux = entreesDe(p).slice().sort(function (a, b) { return a.nom < b.nom ? 1 : (a.nom > b.nom ? -1 : 0); });
    var o = etatOjs(revue);
    Object.keys(taches).forEach(function (c) {
      var x = taches[c];
      if (x.select) {
        var garde = x.select.value;
        x.select.textContent = '';
        locaux.forEach(function (e) {
          var opt = poser(x.select, 'option', '', e.titre ? SZH.remplir(TXT, 'secOption', [e.nom, e.titre]) : e.nom);
          opt.value = e.chemin;
        });
        if (locaux.some(function (e) { return e.chemin === garde; })) { x.select.value = garde; }
        else if (locaux.length) { x.select.value = locaux[0].chemin; }
        x.pret = locaux.length > 0;
      } else {
        rendreCases(x, revue, o);
      }
      majTache(x);
    });
    secDossier.textContent = donnees.exports ? SZH.remplir(TXT, 'secDossier', [donnees.exports]) : '';
  }
  function rendreCases(x, revue, o) {
    var h = historiqueDe(x.t.commande, revue);
    if (x.choixRevue !== revue || x.choixNombre !== o.numeros.length) {
      x.choix = choixParDefaut(x, revue);
      x.choixModifie = false;
    }
    x.choixRevue = revue;
    x.choixNombre = o.numeros.length;
    x.grille.textContent = '';
    o.numeros.forEach(function (n, i) {
      var l = poser(x.grille, 'label', 'szh-opt lanceur-case');
      var c = poser(l, 'input', '');
      c.type = 'checkbox';
      c.id = 'sec-' + x.t.commande + '-case-' + i;
      c.value = n.cle;
      c.checked = x.choix.indexOf(n.cle) !== -1;
      c.addEventListener('change', function () {
        x.choix = Array.prototype.slice.call(x.grille.querySelectorAll('input'))
          .filter(function (k) { return k.checked; }).map(function (k) { return k.value; });
        x.choixModifie = true;
        rendreResume(x, revue, o);
        majTache(x);
      });
      var corps = poser(l, 'span', 'lanceur-case-corps');
      poser(corps, 'strong', '', cleCourte(n));
      if (n.libelle && n.libelle !== n.cle) { poser(corps, 'span', 'lanceur-case-titre', n.libelle); }
      if (h[n.cle]) { poser(corps, 'span', 'lanceur-cellule-meta', SZH.remplir(TXT, 'secDejaExporte', [h[n.cle]])); }
    });
    var plancher = o.etat === 'charge' ? o.demandee : o.plancher;
    x.plus.textContent = SZH.remplir(TXT, 'secAnneePlus', [plancher - 1]);
    x.plus.hidden = o.etat !== 'pret' || o.finDeCourse;
    x.finCourse.hidden = !(o.etat === 'pret' && o.finDeCourse);
    rendreResume(x, revue, o);
  }
  function rendreResume(x, revue, o) {
    x.resume.textContent = '';
    x.resume.classList.toggle('lanceur-resume--erreur', o.etat === 'erreur');
    x.pret = false;
    if (o.etat === 'erreur') {
      poser(x.resume, 'span', '', SZH.remplir(TXT, 'secChargementEchec', [o.erreur || TXT.secEchecInconnu]));
      var r = lien(TXT.secReessayer, function () { assurerOjs(revue); });
      r.id = 'sec-' + x.t.commande + '-reessayer';
      x.resume.appendChild(r);
      return;
    }
    if (o.etat === 'pret' && !o.numeros.length) { poser(x.resume, 'span', '', TXT.secAucunEnLigne); return; }
    if (o.numeros.length) {
      var choisis = o.numeros.filter(function (n) { return x.choix.indexOf(n.cle) !== -1; }).reverse();
      var liste = choisis.map(cleCourte).join(', ');
      var connus = Object.keys(historiqueDe(x.t.commande, revue)).length > 0;
      var texte;
      if (!choisis.length) { texte = x.choixModifie ? TXT.secRienChoisi : TXT.secToutExporte; }
      else if (x.choixModifie) { texte = pluriel(choisis.length, 'secResumeChoisis', [liste]); }
      else if (connus) { texte = pluriel(choisis.length, 'secResumeNonExportes', [liste]); }
      else { texte = pluriel(choisis.length, 'secResumeAnnee', [liste, donnees.anneeCourante]); }
      poser(x.resume, 'span', '', texte);
      x.pret = choisis.length > 0 && o.etat !== 'charge';
    }
    if (o.etat === 'charge') { poser(x.resume, 'span', 'lanceur-attente', TXT.secChargement); }
  }
  function majTache(x) {
    var moi = tacheEnCours === x.t.commande;
    x.bouton.hidden = moi;
    x.interrompre.hidden = !moi;
    x.bouton.disabled = !!tacheEnCours || !x.pret;
    if (x.select) { x.select.disabled = !!tacheEnCours; }
    if (x.modifier) { x.modifier.disabled = moi; }
    x.barre.hidden = !moi;
  }
  function majTaches() { Object.keys(taches).forEach(function (c) { majTache(taches[c]); }); }

  function lancer(t) {
    var x = taches[t.commande];
    var revue = revueSec();
    var m = { type: MSG.LANCEUR_EXPORTER, commande: t.commande, revue: revue };
    if (x.select) {
      if (!x.select.value) { return; }
      m.numeros = [x.select.value];
    } else {
      m.cles = etatOjs(revue).numeros.filter(function (n) { return x.choix.indexOf(n.cle) !== -1; })
        .map(function (n) { return n.cle; }).reverse();
      if (!m.cles.length) { return; }
      x.lances = m.cles;
    }
    api.postMessage(m);
  }

  function ecrire(x, texte) {
    if (!texte) { return; }
    poser(x.journal, 'div', '', texte);
    x.journal.scrollTop = x.journal.scrollHeight;
  }
  function surDebut(msg) {
    var x = taches[msg.commande];
    if (!x) { return; }
    tacheEnCours = msg.commande;
    x.fichiers = [];
    x.journal.textContent = '';
    x.issue.textContent = '';
    x.details.hidden = false;
    x.details.open = false;
    x.barre.removeAttribute('value');
    x.interrompre.disabled = false;
    if (x.cases) { deplier(x, false); }
    majTaches();
  }
  function surLigne(msg) {
    var l = msg.ligne;
    if (!l) { return; }
    if (msg.commande === 'numeros-ojs') {
      if (l.t === 'numero' && ojsRevueEnCours) {
        etatOjs(ojsRevueEnCours).recus.push({ cle: String(l.cle || ''), libelle: String(l.libelle || ''),
          annee: l.annee, numero: l.numero });
      }
      return;
    }
    var x = taches[msg.commande];
    if (!x) { return; }
    if (l.t === 'etape' || l.t === 'avert') { ecrire(x, String(l.texte || '')); }
    else if (l.t === 'progres') {
      var total = parseInt(l.total, 10) || 0;
      if (total > 0) {
        var fait = Math.max(0, Math.min(total, parseInt(l.fait, 10) || 0));
        x.barre.max = total;
        x.barre.value = fait;
        x.barre.setAttribute('max', String(total));
        x.barre.setAttribute('value', String(fait));
      }
    } else if (l.t === 'fichier' && l.chemin) { x.fichiers.push(String(l.chemin)); }
  }
  function surFinOjs(msg) {
    var revue = ojsRevueEnCours;
    ojsRevueEnCours = '';
    if (!revue) { return; }
    var o = etatOjs(revue);
    if (!msg.ok) {
      o.etat = o.numeros.length ? 'pret' : 'erreur';
      o.erreur = msg.annule ? TXT.secInterrompu : String(msg.texte || '');
    } else {
      // Une année de plus qui n'apporte rien : il n'y a plus rien de plus ancien en ligne.
      if (o.plancher && o.recus.length <= o.dernierNombre) { o.finDeCourse = true; }
      else { o.plancher = o.demandee; o.dernierNombre = o.recus.length; o.numeros = o.recus; }
      o.etat = 'pret';
    }
    rendreSecretariat();
  }
  function surFin(msg) {
    if (msg.commande === 'numeros-ojs') { surFinOjs(msg); return; }
    var x = taches[msg.commande];
    if (!x) { return; }
    tacheEnCours = '';
    var texte = String(msg.texte || '');
    x.issue.textContent = '';
    if (msg.ok) {
      var titre = document.createElement('strong');
      titre.textContent = x.t.reussi;
      var corps = [titre];
      // Le texte du bilan vient du contrat de secretariat-cli.js, tel quel ; vide, rien ne s'ajoute.
      if (texte) { var s = document.createElement('span'); s.textContent = ' ' + texte; corps.push(s); }
      var n = SZH.notif('ok', corps);
      x.issue.appendChild(n);
      var cible = x.fichiers.length === 1 ? x.fichiers[0] : (msg.dossier || x.fichiers[0] || '');
      if (cible) {
        var l = lien(pluriel(x.fichiers.length || 1, 'secAfficher', []), function () {
          api.postMessage({ type: MSG.LANCEUR_AFFICHER, chemin: cible });
        });
        l.id = 'sec-' + x.t.commande + '-afficher';
        n.appendChild(l);
      }
      if (x.lances) {
        var revue = revueSec();
        donnees.historique = donnees.historique || {};
        var h = donnees.historique[x.t.commande] = donnees.historique[x.t.commande] || {};
        var hr = h[revue] = h[revue] || {};
        x.lances.forEach(function (c) { hr[c] = msg.date || ''; });
        x.choixNombre = -1;
      }
      x.details.open = false;
    } else if (msg.annule) {
      x.issue.appendChild(SZH.notif('attention', TXT.secInterrompu));
      x.details.open = false;
    } else {
      x.issue.appendChild(SZH.notif('danger', SZH.remplir(TXT, 'secEchec', [texte || TXT.secEchecInconnu])));
      x.details.open = true;
    }
    x.lances = null;
    rendreSecretariat();
  }

  // ---- Log ----
  var jrn = panneaux.journal;
  var journaux = [];
  var rangLu = -1;
  var jrnGrille = poser(jrn, 'div', 'lanceur-jrn');
  var jrnGauche = poser(jrnGrille, 'div', '');
  var jrnEtiq = poser(jrnGauche, 'p', 'lanceur-etiquette', TXT.jrnListe);
  jrnEtiq.id = 'jrn-etiquette';
  var jrnVide = poser(jrnGauche, 'p', 'lanceur-vide', TXT.jrnVide);
  jrnVide.hidden = true;
  var listeJournaux = listeChoix({ parent: jrnGauche, etiquettePar: 'jrn-etiquette', prefixe: 'journal',
    surChange: function (rang) { lire(rang === null ? -1 : Number(rang)); } });
  var jrnDroite = poser(jrnGrille, 'div', '');
  var jrnTete = poser(jrnDroite, 'div', 'lanceur-jrn-tete');
  var jrnTitre = poser(jrnTete, 'h2', '');
  jrnTitre.id = 'jrn-titre';
  poser(jrnTete, 'span', 'szh-pousse');
  var boutonEditeur = SZH.bouton(TXT.jrnEditeur, function () {
    if (rangLu >= 0) { api.postMessage({ type: MSG.LANCEUR_JOURNAL_EDITEUR, rang: rangLu }); }
  });
  boutonEditeur.disabled = true;
  jrnTete.appendChild(boutonEditeur);
  var jrnExtrait = poser(jrnDroite, 'p', 'lanceur-jrn-extrait');
  jrnExtrait.hidden = true;
  var jrnErreur = poser(jrnDroite, 'div', 'lanceur-avis');
  var jrnTexte = poser(jrnDroite, 'pre', 'lanceur-jrn-texte');
  jrnTexte.setAttribute('tabindex', '0');
  jrnTexte.setAttribute('aria-labelledby', 'jrn-titre');

  var jrnPied = poser(jrn, 'div', 'lanceur-boutons');
  var boutonSignaler = SZH.bouton(TXT.jrnSignaler, function () {
    signal.hidden = false;
    boutonSignaler.hidden = true;
    avis(jrnAvis, '', '');
    champSignal.value = '';
    champSignal.focus();
  });
  boutonSignaler.id = 'jrn-signaler';
  jrnPied.appendChild(boutonSignaler);
  var signal = poser(jrn, 'div', 'lanceur-signal');
  signal.setAttribute('role', 'group');
  signal.setAttribute('aria-label', TXT.jrnSignalerTitre);
  signal.hidden = true;
  var champSig = poser(signal, 'div', 'szh-champ');
  var etiqSignal = poser(champSig, 'label', '', TXT.jrnSignalerQuoi);
  etiqSignal.setAttribute('for', 'jrn-phrase');
  var champSignal = poser(champSig, 'input', '');
  champSignal.id = 'jrn-phrase';
  champSignal.type = 'text';
  champSignal.maxLength = 300;
  champSignal.setAttribute('aria-describedby', 'jrn-signal-aide');
  champSignal.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); envoyerSignal(); }
  });
  var aideSignal = poser(champSig, 'p', 'lanceur-astuce', TXT.jrnSignalerAide);
  aideSignal.id = 'jrn-signal-aide';
  var boutonSignalEnvoyer = SZH.bouton(TXT.jrnSignalerEnvoyer, envoyerSignal, 'szh-bouton--principal');
  boutonSignalEnvoyer.id = 'jrn-signal-envoyer';
  signal.appendChild(boutonSignalEnvoyer);
  signal.appendChild(SZH.bouton(TXT.annuler, function () { fermerSignal(); }));
  var jrnAvis = poser(jrn, 'div', 'lanceur-avis');
  jrnAvis.setAttribute('role', 'status');

  function fermerSignal() {
    signal.hidden = true;
    boutonSignaler.hidden = false;
    boutonSignaler.focus();
  }
  function envoyerSignal() {
    var phrase = String(champSignal.value || '').trim();
    if (!phrase) { champSignal.focus(); return; }
    api.postMessage({ type: MSG.LANCEUR_SIGNALER, phrase: phrase, rang: rangLu });
    fermerSignal();
  }

  var VERDICTS = {
    ok: { ton: 'ok', icone: 'ok', texte: 'jrnOk' },
    echec: { ton: 'danger', icone: 'danger', texte: 'jrnEchec' },
    inconnu: { ton: '', icone: 'cercle', texte: 'jrnInconnu' }
  };
  function verdictDe(j) { return VERDICTS[j.verdict] || VERDICTS.inconnu; }
  function rendreJournaux() {
    listeJournaux.remplir(journaux.map(function (j) {
      return { cle: String(j.rang), rendre: function (li) {
        var v = verdictDe(j);
        poser(li, 'span', 'lanceur-cellule-nom', j.date);
        var p = poser(li, 'span', 'szh-pastille' + (v.ton ? ' szh-pastille--' + v.ton : ''));
        p.appendChild(SZH.icone(v.icone));
        poser(p, 'span', '', TXT[v.texte]);
        poser(li, 'span', 'szh-pousse');
        poser(li, 'span', 'lanceur-cellule-meta', SZH.remplir(TXT, 'jrnTaille', [j.ko]));
      } };
    }));
    jrnVide.hidden = journaux.length > 0;
    jrnDroite.hidden = journaux.length === 0;
    boutonSignaler.disabled = false;
    rangLu = -1;
  }
  // Le plus récent s'ouvre de lui-même, à la première visite de l'onglet.
  function ouvrirJournalRecent() {
    if (rangLu !== -1 || !journaux.length) { return; }
    listeJournaux.selectionner(String(journaux[0].rang));
    lire(journaux[0].rang);
  }
  function journalDe(rang) { return journaux.filter(function (j) { return j.rang === rang; })[0] || null; }
  function lire(rang) {
    rangLu = rang;
    var j = journalDe(rang);
    jrnTitre.textContent = j ? SZH.remplir(TXT, 'jrnLecture', [j.date, TXT[verdictDe(j).texte]]) : '';
    boutonEditeur.disabled = !j;
    jrnTexte.textContent = '';
    jrnTexte.hidden = true;
    jrnExtrait.hidden = true;
    avis(jrnErreur, '', '');
    if (j) { api.postMessage({ type: MSG.LANCEUR_JOURNAL_LIRE, rang: rang }); }
  }
  function surTexteJournal(msg) {
    if (msg.rang !== rangLu) { return; }
    if (msg.erreur) {
      avis(jrnErreur, 'danger', SZH.remplir(TXT, 'jrnIllisible', [msg.erreur]));
      return;
    }
    jrnTexte.textContent = String(msg.texte || '');
    jrnTexte.hidden = false;
    jrnTexte.scrollTop = jrnTexte.scrollHeight;
    if (msg.lignes) {
      jrnExtrait.textContent = SZH.remplir(TXT, 'jrnExtrait', [msg.lignes]);
      jrnExtrait.hidden = false;
    }
  }
  var ISSUES = {
    fait: ['ok', 'jrnSignalerFait'], attente: ['info', 'jrnSignalerAttente'], refuse: ['danger', 'jrnSignalerRefuse']
  };

  // ---- Messages de l'hôte ----
  window.addEventListener('message', function (ev) {
    var msg = (ev && ev.data) || {};
    if (msg.type === MSG.CHARGER) {
      recu = true;
      donnees = {
        langue: msg.langue || 'fr', anneeCourante: msg.anneeCourante || 0, produits: msg.produits || [],
        historique: msg.historique || {}, exports: msg.exports || '', version: msg.version || '',
        modeTest: !!msg.modeTest, ancrageAbsent: !!msg.ancrageAbsent, dernierOuvert: msg.dernierOuvert || ''
      };
      journaux = msg.journaux || [];
      ojs = {};
      rendreGroupes();
      rendreJournaux();
      choisirProduit(produitParDefaut(msg));
      rendreProduits(true);
      activer(ongletActif, false);
    } else if (msg.type === MSG.LANCEUR_CREE) {
      if (!msg.ok) { avis(nvRefus, 'danger', SZH.remplir(TXT, 'nvRefus', [msg.texte || TXT.secEchecInconnu])); }
    } else if (msg.type === MSG.LANCEUR_DEBUT) { surDebut(msg); }
    else if (msg.type === MSG.LANCEUR_LIGNE) { surLigne(msg); }
    else if (msg.type === MSG.LANCEUR_FIN) { surFin(msg); }
    else if (msg.type === MSG.LANCEUR_JOURNAL_TEXTE) { surTexteJournal(msg); }
    else if (msg.type === MSG.LANCEUR_SIGNALE) {
      var issue = ISSUES[msg.issue] || ISSUES.refuse;
      jrnAvis.textContent = '';
      jrnAvis.appendChild(SZH.notif(issue[0], TXT[issue[1]]));
      if (msg.courriel) { jrnAvis.appendChild(SZH.notif('info', TXT.jrnCourriel)); }
    } else {
      console.warn('lanceur : type de message inconnu', msg.type);
    }
  });

  SZH.annoncerPret(api, function () { return recu; });
})();
