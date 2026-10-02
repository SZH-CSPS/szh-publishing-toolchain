// Le lanceur dans l'éditeur : six onglets, Produits ouvert d'office. Chaque tâche fréquente
// tient en un ou deux clics : tout ce qui se déduit est déjà choisi.
//
// Protocole. Vers l'hôte : pret, lanceurOnglet { onglet }, lanceurOuvrir { chemin },
// lanceurVersions, lanceurCreer { produit, annee, numero, volume, volumeManuel } ou
// { produit, titre, annee, reference, genre, maquette, format },
// lanceurExporter { commande, revue, numeros | cles }, lanceurOjsCharger { revue, depuisAnnee },
// lanceurInterrompre { commande }, lanceurAfficher { chemin },
// lanceurJournalLire { rang }, lanceurJournalEditeur { rang }, lanceurSignaler { phrase, rang },
// regler { cle, valeur }, lanceurService { service, valeur }, deverrouiller { valeur },
// telecharger-proteges, exporterLangue, suggestionsInterface, reglerOjs, reglerBiblio, taches-enregistrer.
// Depuis l'hôte :
//   charger { langue, onglet, produit, anneeCourante, modeTest, ancrageAbsent, version, exports,
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
//   lanceurAller { onglet }   la commande szh.reglages ouvre Paramètres
//   valeurs { valeurs, poste, services, proteges, ojs, biblio, taches, auteursOjs, suggInterface,
//             avertLangue }   les réglages ; une clé n'y figure jamais, seulement « définie » ou non
//   proteges, enregistre { bloc }, erreur { bloc, message }   le verrou et l'issue d'une écriture
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
  // Le mode « Trad » détourne les clics, sauf ici : la barre d'onglets et Paramètres, où on l'éteint.
  tablist.dataset.tradExempt = '1';
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
    if (o.cle === 'reglages') { p.dataset.tradExempt = '1'; }
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

  panneaux.preproc.appendChild(SZH.notif('info', TXT.avenir));

  // ---- Le produit choisi ----
  // Un seul choix pour Produits, Nouveau et Secrétariat : passer à la Zeitschrift dans un
  // onglet la montre dans les deux autres. Le défaut vient de l'hôte, qui seul connaît la
  // règle de langue et le choix du compte.
  var produitChoisi = '';
  var groupesProduit = [];
  function produitParDefaut(msg) {
    var jetons = (msg.produits || []).map(function (p) { return p.jeton; });
    if (msg.produit && jetons.indexOf(msg.produit) !== -1) { return msg.produit; }
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

  function cleCourte(n) { return SZH.remplir(TXT, 'secNumeroCourt', [n.annee, String(Number(n.numero)).padStart(2, '0')]); }
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

  // ---- Paramètres ----
  // Cinq listes de réglages construites comme les tâches du Secrétariat (une rangée : ce qu'elle
  // règle, la valeur, le geste), puis la carte des réglages de la rédaction, verrouillée. Tout
  // arrive par `valeurs` ; chaque geste repart en `regler` (ou `lanceurService`), et la page se
  // règle sur ce que l'hôte répond, jamais sur son propre geste.
  // Les listes sont posées dans un module local pour que leurs noms (ojs, taches, champ…) ne
  // heurtent pas ceux du Secrétariat.
  var reglagesPage = (function (panneau) {
    var zones = poser(panneau, 'div', '');
    var avisReglages = poser(zones, 'div', 'lanceur-avis');
    avisReglages.setAttribute('role', 'alert');
    var rangeeN = 0;

    function afficherErreur(texte) {
      avisReglages.textContent = '';
      if (texte) { avisReglages.appendChild(SZH.notif('danger', String(texte))); }
    }
    function liste(titre) {
      poser(zones, 'h2', 'lanceur-intertitre', titre);
      return poser(zones, 'div', 'lanceur-taches');
    }
    // Même gabarit qu'une tâche du Secrétariat : le texte, le réglage, le geste.
    function rangee(parent, titre, aide, portee) {
      var el = poser(parent, 'div', 'lanceur-tache');
      el.setAttribute('role', 'group');
      var ligne = poser(el, 'div', 'lanceur-tache-ligne');
      var texte = poser(ligne, 'div', 'lanceur-tache-texte');
      var nom = poser(texte, 'h3', 'lanceur-tache-nom', titre);
      nom.id = 'regl-nom-' + (++rangeeN);
      el.setAttribute('aria-labelledby', nom.id);
      if (portee) { poser(nom, 'span', 'szh-pastille lanceur-portee', portee); }
      var aideP = aide ? poser(texte, 'p', 'lanceur-tache-aide', aide) : null;
      return { el: el, nom: nom, aide: aideP, reglage: poser(ligne, 'div', 'lanceur-tache-reglage'),
        action: poser(ligne, 'div', 'lanceur-tache-action') };
    }
    function envoyerRegler(cle, valeur) { api.postMessage({ type: MSG.REGLER, cle: cle, valeur: valeur }); }

    // Un choix parmi quelques valeurs : des radios natifs, nommés d'après la clé du réglage.
    var radios = {};
    function choix(parent, cle, titre, aide, options, portee) {
      var r = rangee(parent, titre, aide, portee);
      var g = poser(r.reglage, 'div', 'lanceur-segments');
      g.setAttribute('role', 'radiogroup');
      g.setAttribute('aria-labelledby', r.nom.id);
      options.forEach(function (o) {
        var l = poser(g, 'label', 'lanceur-segment');
        var radio = poser(l, 'input', '');
        radio.type = 'radio';
        radio.name = cle;
        radio.value = o[0];
        radio.addEventListener('change', function () { if (radio.checked) { envoyerRegler(cle, o[0]); } });
        poser(l, 'span', '', o[1]);
      });
      return r;
    }
    function cocher(valeurs) {
      Object.keys(valeurs).forEach(function (cle) {
        var r = panneau.querySelector('input[name="' + cle + '"][value="' + String(valeurs[cle]) + '"]');
        if (r) { r.checked = true; }
      });
    }
    function bouton(parent, texte, fn) {
      var b = SZH.bouton(texte, fn);
      parent.appendChild(b);
      return b;
    }

    // ---- Affichage ----
    var a = liste(TXT.rgAffichage);
    var rLangue = choix(a, 'langue', TXT.rgLangue, TXT.rgLangueAide, [['fr', 'Français'], ['de', 'Deutsch']]);
    // La discordance des menus de VSCodium et des textes de l'outil se dit sous la langue.
    var zoneLangue = poser(rLangue.el, 'p', 'szh-notif szh-notif--attention szh-notif--discret');
    zoneLangue.hidden = true;
    choix(a, 'theme', TXT.regl_theme, '', [['systeme', TXT.regl_themeSysteme], ['clair', TXT.regl_themeClair], ['sombre', TXT.regl_themeSombre]]);
    choix(a, 'zoom', TXT.regl_zoom, '', [['0', TXT.regl_zoomNormal], ['1', TXT.regl_zoomGrand], ['2', TXT.regl_zoomTresGrand]]);
    choix(a, 'policeMd', TXT.rgPolice, TXT.rgPoliceAide, [['14', '14 px'], ['16', '16 px'], ['18', '18 px']]);

    // ---- Rédaction et aperçu ----
    var b = liste(TXT.rgRedaction);
    choix(b, 'apercu', TXT.regl_apercu, '', [['html', TXT.regl_apercuHtml], ['pdf', TXT.regl_apercuPdf]]);
    choix(b, 'assets', TXT.rgAssets, '', [['oui', TXT.rgOui], ['non', TXT.rgNon]]);
    choix(b, 'warnings', TXT.regl_warnings, '', [['complets', TXT.regl_warningsComplets], ['reduits', TXT.regl_warningsReduits]]);
    choix(b, 'cmyk', TXT.regl_cmyk, '', [['oui', TXT.rgOui], ['non', TXT.rgNon]]);
    choix(b, 'liensReferences', TXT.rgLiens, TXT.rgLiensAide, [['actifs', TXT.rgLiensActifs], ['desactives', TXT.rgLiensDesactives]]);

    // ---- Ce poste ----
    var c = liste(TXT.rgPoste);
    var rProduit = rangee(c, TXT.rgProduit, TXT.rgProduitAide);
    var selProduit = poser(rProduit.reglage, 'select', 'lanceur-select');
    selProduit.setAttribute('aria-labelledby', rProduit.nom.id);
    selProduit.addEventListener('change', function () { envoyerRegler('produit', selProduit.value); });
    choix(c, 'majSilencieuse', TXT.rgMaj, TXT.rgMajAide, [['fenetre', TXT.rgMajFenetre], ['silence', TXT.rgMajSilence]]);
    choix(c, 'modeDev', TXT.rgDev, TXT.rgDevAide, [['inactif', TXT.rgDesactive], ['actif', TXT.rgActive]], TXT.rgPortee);

    // ---- Services en ligne ----
    var d = liste(TXT.rgServices);
    var services = {};
    function service(cle, titre, aide, type) {
      var r = rangee(d, titre, aide);
      var champ = poser(r.reglage, 'div', 'szh-champ lanceur-champ-titre');
      var saisie = poser(champ, 'input', '');
      saisie.type = type;
      saisie.setAttribute('aria-labelledby', r.nom.id);
      saisie.autocomplete = 'off';
      if (type === 'password') { champ.classList.add('lanceur-champ-cle'); }
      var x = { r: r, saisie: saisie, actuel: '', definie: false };
      if (type === 'password') {
        x.pastille = poser(r.reglage, 'span', 'szh-pastille');
        x.effacer = SZH.bouton(TXT.rgEffacer, function () {
          api.postMessage({ type: MSG.LANCEUR_SERVICE, service: cle, valeur: '' });
        }, 'lanceur-lien');
        r.reglage.appendChild(x.effacer);
      }
      x.enregistrer = SZH.bouton(TXT.rgEnregistrer, function () { enregistrer(cle); });
      r.action.appendChild(x.enregistrer);
      saisie.addEventListener('input', function () { majService(cle); });
      saisie.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); enregistrer(cle); }
      });
      services[cle] = x;
      return x;
    }
    service('shlinkUrl', TXT.rgShlinkUrl, TXT.rgShlinkUrlAide, 'text');
    service('shlinkCle', TXT.rgShlinkCle, '', 'password');
    service('ojsCle', TXT.rgOjsCle, TXT.rgOjsCleAide, 'password');
    poser(zones, 'p', 'lanceur-astuce lanceur-coffre', TXT.rgCoffre);
    function majService(cle) {
      var x = services[cle];
      var texte = x.saisie.value.trim();
      // Une clé s'efface en enregistrant un champ vide ; l'adresse aussi.
      x.enregistrer.disabled = cle === 'shlinkUrl' ? texte === x.actuel : (texte === '' && !x.definie);
      if (x.effacer) { x.effacer.hidden = !x.definie; }
    }
    function enregistrer(cle) {
      var x = services[cle];
      if (x.enregistrer.disabled) { return; }
      afficherErreur('');
      api.postMessage({ type: MSG.LANCEUR_SERVICE, service: cle, valeur: x.saisie.value.trim() });
    }
    function rendreServices(s) {
      var url = services.shlinkUrl;
      url.actuel = s.shlinkUrl || '';
      url.saisie.value = url.actuel;
      majService('shlinkUrl');
      [['shlinkCle', s.shlinkCle], ['ojsCle', s.ojsCle]].forEach(function (p) {
        var x = services[p[0]];
        x.definie = !!p[1];
        // Une clé n'est jamais renvoyée à la page : le champ reste vide, la pastille dit l'état.
        x.saisie.value = '';
        x.pastille.textContent = x.definie ? TXT.rgDefinie : TXT.rgAbsente;
        x.pastille.classList.toggle('szh-pastille--ok', x.definie);
        majService(p[0]);
      });
    }

    // ---- Traduction ----
    var e = liste(TXT.rgTraduction);
    choix(e, 'verifTrad', TXT.regl_verifTrad, TXT.rgVerifAide, [['inactif', TXT.rgDesactive], ['actif', TXT.rgActive]], TXT.rgPortee);
    choix(e, 'modeTrad', TXT.rgModeTrad, TXT.rgModeTradAide, [['inactif', TXT.rgDesactive], ['actif', TXT.rgActive]], TXT.rgPortee);
    var rSugg = rangee(e, TXT.regl_suggInterfaceTitre, TXT.rgSuggAucune);
    bouton(rSugg.action, TXT.regl_suggInterfaceOuvrir, function () { api.postMessage({ type: MSG.SUGGESTIONS_INTERFACE }); });
    var rFichier = rangee(e, TXT.regl_exportLangueTitre, TXT.rgFichierLangueAide);
    bouton(rFichier.action, TXT.regl_exportLangue, function () { api.postMessage({ type: MSG.EXPORTER_LANGUE }); });
    function rendreSuggestions(n) {
      var k = Number(n) || 0;
      rSugg.aide.textContent = k === 0 ? TXT.rgSuggAucune : pluriel(k, 'rgSugg', [k]);
    }

    // ---- Réglages de la rédaction : la carte protégée ----
    // Les blocs d'une revue ou d'une Zeitschrift (auteur·e·s, bibliographie, tâches, export OJS)
    // restent masqués tant que l'hôte n'envoie pas leur donnée : il ne l'envoie pas pour un livre.
    var carte = poser(zones, 'section', 'szh-carte lanceur-carte-proteges');
    carte.id = 'regl-proteges';
    var tete = poser(carte, 'div', 'szh-tete');
    poser(tete, 'h2', 'szh-tete-nom', TXT.regl_protegesTitre);
    var etatPastille = poser(tete, 'span', 'szh-pastille szh-pastille--attention');
    var verrou = poser(tete, 'label', 'szh-pousse lanceur-verrou');
    var caseDeverrouiller = poser(verrou, 'input', '');
    caseDeverrouiller.type = 'checkbox';
    // On renvoie l'intention, pas l'état : la case se remet sur ce que l'hôte répond, y compris
    // quand la modale a été refusée.
    caseDeverrouiller.addEventListener('change', function () {
      api.postMessage({ type: MSG.DEVERROUILLER, valeur: caseDeverrouiller.checked });
    });
    poser(verrou, 'span', '', TXT.regl_protegesDeverrouiller);
    var boutonTelecharger = SZH.bouton(TXT.regl_protegesTelecharger, function () {
      api.postMessage({ type: MSG.TELECHARGER_PROTEGES });
    });
    boutonTelecharger.title = TXT.regl_protegesTelechargerTip;
    tete.appendChild(boutonTelecharger);
    var corps = poser(carte, 'div', 'szh-corps');
    corps.appendChild(SZH.notif('info', TXT.regl_protegesVerrouille, { discret: true }));
    var banniere = poser(corps, 'p', 'szh-notif szh-notif--attention szh-notif--discret');
    banniere.hidden = true;

    function blocRevue(id) {
      var s = poser(corps, 'div', 'regl-bloc');
      s.id = id;
      s.hidden = true;
      return s;
    }
    var blocAuteurs = blocRevue('regl-bloc-auteurs');
    poser(blocAuteurs, 'h3', 'lanceur-etiquette', TXT.regl_auteursTitre).style.marginTop = 'var(--e4)';
    var auteursZone = poser(blocAuteurs, 'div', 'lanceur-astuce');
    auteursZone.id = 'regl-auteurs';
    function bloc(id, titre, ouvert) {
      var s = blocRevue('regl-bloc-' + id);
      var det = poser(s, 'details', 'lanceur-details');
      if (ouvert) { det.open = true; }
      var sm = poser(det, 'summary', '', titre);
      var resume = poser(sm, 'span', 'lanceur-astuce');
      var contenu = poser(det, 'div', 'regl-zone');
      contenu.id = 'regl-zone-' + id;
      return { section: s, resume: resume, contenu: contenu, details: det };
    }
    var blocOjs = bloc('ojs', TXT.ojsTitre, false);
    blocOjs.contenu.appendChild(SZH.notif('info', TXT.ojsIntro, { discret: true }));
    var ojsZone = poser(blocOjs.contenu, 'div', '');
    ojsZone.id = 'regl-ojs';
    var blocBiblio = bloc('biblio', TXT.biblioTitre, true);
    blocBiblio.contenu.appendChild(SZH.notif('info', TXT.biblioIntro, { discret: true }));
    var biblioZone = poser(blocBiblio.contenu, 'div', '');
    biblioZone.id = 'regl-biblio';
    var blocTaches = bloc('taches', TXT.artTachesTitre, false);
    blocTaches.contenu.appendChild(SZH.notif('info', TXT.artTachesAide, { discret: true }));
    var tachesZone = poser(blocTaches.contenu, 'div', '');
    tachesZone.id = 'regl-taches';
    function montrer(bl) { (bl.section || bl).hidden = false; }
    function resume(bl, texte) { bl.resume.textContent = texte ? ' – ' + texte : ''; }

    // ---- Auteur·e·s publiés : purement informatif, la liste se rafraîchit seule ----
    function dateLisible(brute) {
      try { return new Date(brute).toLocaleDateString(); }
      catch (err) { return String(brute); }
    }
    function rendreAuteursOjs(infos) {
      auteursZone.textContent = '';
      var ojsP = poser(auteursZone, 'p', '');
      ojsP.style.margin = '0';
      ojsP.textContent = infos.dateFetch
        ? String(TXT.auteursMaj || '').split('{0}').join(dateLisible(infos.dateFetch))
          .split('{1}').join(String(infos.nombre || 0)).split('{2}').join(String(infos.nombreRor || 0))
        : (TXT.auteursJamais || '');
      var corpus = poser(auteursZone, 'p', '');
      corpus.style.margin = '0';
      corpus.textContent = infos.dateCorpus
        ? String(TXT.auteursCorpus || '').split('{0}').join(dateLisible(infos.dateCorpus))
        : (TXT.auteursCorpusJamais || '');
      montrer(blocAuteurs);
    }

    // ---- Briques des grilles ----
    function marquer() { ojsModifie = true; auto.programmer(); }
    function champTexte(valeur, aria, marque, placeholder) {
      var i = document.createElement('input');
      i.type = 'text';
      i.value = valeur === undefined || valeur === null ? '' : String(valeur);
      i.setAttribute('aria-label', aria);
      i.placeholder = placeholder || TXT.ojsVide;
      Object.keys(marque).forEach(function (cle) { i.dataset[cle] = marque[cle]; });
      i.classList.toggle('vide', i.value.trim() === '');
      i.addEventListener('input', function () {
        i.classList.toggle('vide', i.value.trim() === '');
        marquer();
      });
      return i;
    }
    function caseACocher(coche, aria, marque) {
      var c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = !!coche;
      c.setAttribute('aria-label', aria);
      Object.keys(marque).forEach(function (cle) { c.dataset[cle] = marque[cle]; });
      c.addEventListener('change', marquer);
      return c;
    }
    function grille(colonnes) {
      var g = document.createElement('div');
      g.className = 'regl-grille';
      g.style.gridTemplateColumns = colonnes;
      return g;
    }
    function entete(g, libelles) {
      libelles.forEach(function (libelle) {
        var t = document.createElement('span');
        t.className = 'regl-entete';
        t.textContent = libelle;
        g.appendChild(t);
      });
    }
    function zone(legende) {
      var f = document.createElement('fieldset');
      var l = document.createElement('legend');
      l.textContent = legende;
      f.appendChild(l);
      return f;
    }
    function note(parent, texte) {
      var p = document.createElement('p');
      p.className = 'regl-note';
      p.textContent = texte;
      parent.appendChild(p);
      return p;
    }

    // ---- Export OJS ----
    // OJS apparie le genre de fichier, le groupe d'auteur et les rubriques par nom à l'import :
    // un intitulé approximatif crée un doublon ou range l'article ailleurs. Ce bloc est la seule
    // façon de corriger un intitulé, ou d'ajouter une rubrique, sans republier l'extension.
    var ojs = null;              // { config, champs, locales, revues, typesArticle }
    var ojsModifie = false;
    var selectsType = [];        // reconstruits dès qu'une clé de rubrique change

    // Un champ par revue. Les valeurs relevées sur l'instance sont là ; celles qui n'ont
    // jamais pu l'être sont vides, et la note dit dans quel écran d'OJS aller les lire.
    function rendreRevues() {
      var f = zone(TXT.ojsRevues);
      var g = grille('minmax(9em, 1.1fr) repeat(' + ojs.locales.length + ', minmax(8em, 1fr))');
      entete(g, [''].concat(ojs.locales.map(function (l) { return ojs.revues[l]; })));
      ojs.champs.forEach(function (champ) {
        var etiquette = document.createElement('span');
        etiquette.className = 'regl-libelle';
        etiquette.textContent = champ.libelle + (champ.requis ? ' *' : '');
        g.appendChild(etiquette);
        ojs.locales.forEach(function (loc) {
          // Une revue absente de la configuration reçue (poste pas à jour, champ ajouté depuis)
          // se lit vide plutôt que de faire lever toute la page.
          g.appendChild(champTexte((ojs.config.revues[loc] || {})[champ.cle],
            champ.libelle + ' – ' + ojs.revues[loc], { revue: loc, champ: champ.cle }));
        });
      });
      f.appendChild(g);
      ojs.champs.forEach(function (champ) { note(f, champ.libelle + ' – ' + champ.ou); });
      ojsZone.appendChild(f);
    }
    function rangeeRubrique(g, r) {
      var nom = r.cle || TXT.ojsCleNouvelle;
      var cle = champTexte(r.cle, TXT.ojsColCle + ' – ' + nom, { rubriqueCle: '1' }, TXT.ojsCleNouvelle);
      // La clé ne part pas dans le XML : elle relie la rubrique à un type d'article. Celle d'une
      // rubrique livrée ne se renomme pas : l'ancienne resterait en place et le type d'article
      // pointerait dans le vide. Les intitulés, eux, restent modifiables.
      if ((ojs.clesDefaut || []).indexOf(r.cle) !== -1) {
        cle.readOnly = true;
        cle.dataset.livree = '1';
        cle.classList.add('cle-livree');
      } else {
        cle.addEventListener('change', majOptionsTypes);
      }
      g.appendChild(cle);
      ojs.locales.forEach(function (loc) {
        g.appendChild(champTexte(r.abbrev[loc], TXT.ojsColAbbrev + ' ' + ojs.revues[loc] + ' – ' + nom, { rubriqueAbbrev: loc }));
        g.appendChild(champTexte(r.titre[loc], TXT.ojsColTitre + ' ' + ojs.revues[loc] + ' – ' + nom, { rubriqueTitre: loc }));
      });
      g.appendChild(caseACocher(!r.sansResume, TXT.ojsColResume + ' – ' + nom, { rubriqueResume: '1' }));
      g.appendChild(caseACocher(!r.sansDoi, TXT.ojsColDoi + ' – ' + nom, { rubriqueDoi: '1' }));
    }
    function rendreRubriques() {
      var f = zone(TXT.ojsRubriques);
      note(f, TXT.ojsRubriquesAide);
      var g = grille('minmax(4.5em, .6fr)' +
        ' repeat(' + ojs.locales.length + ', minmax(4.5em, .6fr) minmax(8em, 1.4fr))' +
        ' 4.5em 4.5em');
      var titres = [TXT.ojsColCle];
      ojs.locales.forEach(function (loc) {
        titres.push(TXT.ojsColAbbrev + ' ' + loc.toUpperCase());
        titres.push(TXT.ojsColTitre + ' ' + loc.toUpperCase());
      });
      titres.push(TXT.ojsColResume);
      titres.push(TXT.ojsColDoi);
      entete(g, titres);
      ojs.config.rubriques.forEach(function (r) { rangeeRubrique(g, r); });
      f.appendChild(g);
      var plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'regl-ajouter';
      plus.textContent = TXT.ojsAjouter;
      plus.addEventListener('click', function () {
        var vide = {};
        ojs.locales.forEach(function (loc) { vide[loc] = ''; });
        ojs.config = collecter();
        ojs.config.rubriques.push({
          cle: '', sansResume: 1, sansDoi: 1,
          abbrev: Object.assign({}, vide), titre: Object.assign({}, vide)
        });
        ojsModifie = true;
        rendreOjs();
        var champs = ojsZone.querySelectorAll('[data-rubrique-cle]');
        if (champs.length) { champs[champs.length - 1].focus(); }
      });
      f.appendChild(plus);
      ojsZone.appendChild(f);
    }
    // La rubrique qui reçoit chaque type d'article : c'est ce choix qui rend une rubrique ajoutée
    // atteignable par un article, et donc visible dans le XML.
    function rendreTypes() {
      var f = zone(TXT.ojsTypes);
      note(f, TXT.ojsTypesAide);
      var g = grille('minmax(9em, 1fr) minmax(9em, 1fr)');
      selectsType.length = 0;
      ojs.typesArticle.forEach(function (type) {
        var etiquette = document.createElement('span');
        etiquette.className = 'regl-libelle';
        etiquette.textContent = type.libelle;
        g.appendChild(etiquette);
        var select = document.createElement('select');
        select.dataset.type = type.valeur;
        select.setAttribute('aria-label', TXT.ojsTypes + ' – ' + type.libelle);
        select.addEventListener('change', marquer);
        selectsType.push(select);
        g.appendChild(select);
      });
      f.appendChild(g);
      ojsZone.appendChild(f);
      majOptionsTypes();
    }
    function majOptionsTypes() {
      var rubriques = lireRubriques().filter(function (r) { return r.cle !== ''; });
      selectsType.forEach(function (select) {
        var choisi = select.value || ojs.config.types[select.dataset.type] || '';
        select.textContent = '';
        rubriques.forEach(function (r) {
          var opt = document.createElement('option');
          opt.value = r.cle;
          opt.textContent = r.cle + ' – ' + (r.titre[ojs.locales[0]] || r.titre[ojs.locales[1]] || r.cle);
          select.appendChild(opt);
        });
        select.value = rubriques.some(function (r) { return r.cle === choisi; }) ? choisi
          : (rubriques.length ? rubriques[0].cle : '');
      });
    }
    function lireRubriques() {
      var cles = ojsZone.querySelectorAll('[data-rubrique-cle]');
      var abbrevs = ojsZone.querySelectorAll('[data-rubrique-abbrev]');
      var titres = ojsZone.querySelectorAll('[data-rubrique-titre]');
      var resumes = ojsZone.querySelectorAll('[data-rubrique-resume]');
      var dois = ojsZone.querySelectorAll('[data-rubrique-doi]');
      var n = ojs.locales.length;
      var sortie = [];
      for (var i = 0; i < cles.length; i++) {
        var abbrev = {};
        var titre = {};
        for (var l = 0; l < n; l++) {
          var loc = ojs.locales[l];
          abbrev[loc] = abbrevs[i * n + l] ? abbrevs[i * n + l].value.trim() : '';
          titre[loc] = titres[i * n + l] ? titres[i * n + l].value.trim() : '';
        }
        sortie.push({
          cle: cles[i].value.trim(), abbrev: abbrev, titre: titre,
          sansResume: resumes[i] && resumes[i].checked ? 0 : 1,
          sansDoi: dois[i] && dois[i].checked ? 0 : 1
        });
      }
      return sortie;
    }
    // Relit l'écran : ce qui est affiché est ce qui part, sans état parallèle. Même forme que
    // celle envoyée par l'hôte et que celle écrite dans config.json.
    function collecter() {
      var revues = {};
      ojs.locales.forEach(function (loc) { revues[loc] = {}; });
      ojsZone.querySelectorAll('[data-champ]').forEach(function (champ) {
        // Un champ dont la revue n'est plus une locale connue (config rechargée entre-temps)
        // est ignoré plutôt que de faire échouer toute la collecte.
        if (!revues[champ.dataset.revue]) { return; }
        revues[champ.dataset.revue][champ.dataset.champ] = champ.value.trim();
      });
      var types = {};
      selectsType.forEach(function (select) { if (select.value) { types[select.dataset.type] = select.value; } });
      return { revues: revues, rubriques: lireRubriques(), types: types };
    }
    function rendreOjs() {
      ojsZone.textContent = '';
      rendreRevues();
      rendreRubriques();
      rendreTypes();
      appliquerVerrou();                     // le bloc vient d'être reconstruit, à neuf
    }
    var auto = SZH.autoEnregistrement({
      estModifie: function () { return ojsModifie; },
      enregistrer: function (autoEcriture) {
        ojsModifie = false;
        api.postMessage({ type: MSG.REGLER_OJS, ojs: collecter(), auto: autoEcriture });
      }
    });

    // ---- Titre de la bibliographie ----
    // Une rangée par langue, une colonne par revue : ce qui est affiché est ce qui part, et un
    // champ vidé vaut « aucun titre », pas « reprends le défaut ».
    var biblio = null;           // { titres, revues, langues }
    var biblioModifie = false;
    function marquerBiblio() { biblioModifie = true; autoBiblio.programmer(); }
    function rendreBiblio() {
      biblioZone.textContent = '';
      if (!biblio) { return; }
      var f = zone(TXT.biblioTitre);
      var g = grille('minmax(9em, 1.1fr) repeat(' + biblio.revues.length + ', minmax(10em, 1fr))');
      entete(g, [TXT.biblioColLangue].concat(biblio.revues.map(function (r) { return r.libelle; })));
      biblio.langues.forEach(function (langue) {
        var etiquette = document.createElement('span');
        etiquette.className = 'regl-libelle';
        etiquette.textContent = langue.libelle;
        g.appendChild(etiquette);
        biblio.revues.forEach(function (r) {
          var i = document.createElement('input');
          i.type = 'text';
          i.value = String((biblio.titres[r.cle] || {})[langue.cle] || '');
          i.placeholder = TXT.biblioVide;
          i.setAttribute('aria-label', TXT.biblioTitre + ' – ' + r.libelle + ' – ' + langue.libelle);
          i.dataset.biblioRevue = r.cle;
          i.dataset.biblioLangue = langue.cle;
          i.classList.toggle('vide', i.value.trim() === '');
          i.addEventListener('input', function () {
            i.classList.toggle('vide', i.value.trim() === '');
            marquerBiblio();
          });
          g.appendChild(i);
        });
      });
      f.appendChild(g);
      biblioZone.appendChild(f);
    }
    function collecterBiblio() {
      var titres = {};
      biblio.revues.forEach(function (r) { titres[r.cle] = {}; });
      biblioZone.querySelectorAll('[data-biblio-revue]').forEach(function (champ) {
        if (!titres[champ.dataset.biblioRevue]) { return; }   // revue disparue entre-temps
        titres[champ.dataset.biblioRevue][champ.dataset.biblioLangue] = champ.value.trim();
      });
      return titres;
    }
    var autoBiblio = SZH.autoEnregistrement({
      estModifie: function () { return biblioModifie; },
      enregistrer: function (autoEcriture) {
        biblioModifie = false;
        api.postMessage({ type: MSG.REGLER_BIBLIO, titres: collecterBiblio(), auto: autoEcriture });
      }
    });

    // ---- Tâches par article ----
    // Les intitulés décrivent le PROCESSUS éditorial d'une revue : ils valent pour tous ses
    // numéros. L'identifiant n'est PAS à l'écran : c'est lui qui est écrit dans le sidecar de
    // chaque article, et le montrer inviterait à le corriger, ce qui décocherait la tâche
    // partout. Il voyage dans un attribut et ne bouge plus (normaliserTaches, lib/articles.js).
    var taches = null;           // { revues: [{cle, libelle}], table: {revue: [...]}, max }
    var tachesModifie = false;
    function marquerTaches() { tachesModifie = true; autoTaches.programmer(); }
    function rangeeTache(g, revue, tache, index) {
      var num = document.createElement('span');
      num.className = 'regl-libelle';
      num.textContent = String(index + 1);
      g.appendChild(num);
      ['fr', 'de'].forEach(function (langue) {
        var i = document.createElement('input');
        i.type = 'text';
        i.value = String(tache[langue] || '');
        i.setAttribute('aria-label',
          (langue === 'fr' ? TXT.tachesFr : TXT.tachesDe) + ' – ' + revue.libelle + ' ' + String(index + 1));
        i.dataset.tacheRevue = revue.cle;
        i.dataset.tacheLangue = langue;
        i.dataset.tacheId = String(tache.id || '');
        i.dataset.tacheRang = String(index);
        i.addEventListener('input', marquerTaches);
        g.appendChild(i);
      });
      var retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = 'szh-bouton regl-retirer';
      retirer.textContent = '×';
      retirer.title = TXT.tachesRetirer;
      retirer.setAttribute('aria-label', TXT.tachesRetirer + ' – ' + revue.libelle + ' ' + String(index + 1));
      retirer.addEventListener('click', function () {
        taches.table = collecterTaches();
        taches.table[revue.cle].splice(index, 1);
        marquerTaches();
        rendreTaches();
      });
      g.appendChild(retirer);
    }
    function rendreTaches() {
      tachesZone.textContent = '';
      if (!taches) { return; }
      var morceaux = [];
      taches.revues.forEach(function (revue) {
        var f = zone(revue.libelle);
        var g = grille('2.5em minmax(10em, 1fr) minmax(10em, 1fr) 4.5em');
        entete(g, ['', TXT.tachesFr, TXT.tachesDe, '']);
        var liste = taches.table[revue.cle] || [];
        for (var i = 0; i < liste.length; i++) { rangeeTache(g, revue, liste[i], i); }
        // Le nom court du produit pour le résumé : le nom complet de la revue (ISSN compris) est trop long.
        var court = produitDe(revue.cle);
        morceaux.push(pluriel(liste.length, 'rgTachesResume', [court ? court.libelle : revue.libelle, liste.length]));
        f.appendChild(g);
        var plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'regl-ajouter';
        plus.textContent = TXT.tachesAjouter;
        plus.disabled = liste.length >= taches.max;
        plus.addEventListener('click', function () {
          taches.table = collecterTaches();
          taches.table[revue.cle].push({ id: '', fr: '', de: '' });
          marquerTaches();
          rendreTaches();
          var champs = tachesZone.querySelectorAll('[data-tache-revue="' + revue.cle + '"]');
          if (champs.length) { champs[champs.length - 2].focus(); }
        });
        f.appendChild(plus);
        tachesZone.appendChild(f);
      });
      resume(blocTaches, morceaux.join(' – '));
      appliquerVerrou();                     // le bloc vient d'être reconstruit, à neuf
    }
    // Relit l'écran. L'identifiant vient de l'attribut, jamais d'un recalcul : corriger une faute
    // dans un intitulé ne doit pas décocher la tâche sur les articles qui la portent.
    function collecterTaches() {
      var sortie = {};
      taches.revues.forEach(function (revue) { sortie[revue.cle] = []; });
      tachesZone.querySelectorAll('[data-tache-revue]').forEach(function (champ) {
        var liste = sortie[champ.dataset.tacheRevue];
        if (!liste) { return; }              // revue disparue entre-temps : ignorée
        var rang = Number(champ.dataset.tacheRang);
        if (!liste[rang]) { liste[rang] = { id: champ.dataset.tacheId || '', fr: '', de: '' }; }
        liste[rang][champ.dataset.tacheLangue] = champ.value.trim();
      });
      Object.keys(sortie).forEach(function (cle) {
        sortie[cle] = sortie[cle].filter(function (t) { return !!t; });
      });
      return sortie;
    }
    var autoTaches = SZH.autoEnregistrement({
      estModifie: function () { return tachesModifie; },
      enregistrer: function (autoEcriture) {
        tachesModifie = false;
        api.postMessage({ type: MSG.TACHES_ENREGISTRER, taches: collecterTaches(), auto: autoEcriture });
      }
    });

    // ---- Le verrou ----
    // Ces blocs décrivent la chaîne de publication, pas le confort d'une personne : une rubrique
    // renommée sur un seul poste range ses articles dans la mauvaise section de la revue. Ils se
    // lisent donc seulement, et la page ne décide jamais de son verrou : elle demande, et se règle
    // sur ce que l'hôte répond (c'est lui qui pose la modale, qu'une webview ne peut pas bloquer).
    var protegesEtat = { deverrouille: false, divergences: [], avertissement: '' };
    // Posé sur les CONTRÔLES des trois blocs, et non sur chaque fabrique de champ : un champ
    // ajouté plus tard est verrouillé sans qu'on ait à y penser.
    function appliquerVerrou() {
      var verrouille = !protegesEtat.deverrouille;
      [biblioZone, tachesZone, ojsZone].forEach(function (bl) {
        bl.querySelectorAll('input, select, textarea, button').forEach(function (el) {
          // readOnly sur un champ de saisie, disabled sur le reste : un champ désactivé sort de
          // l'ordre de tabulation et n'est plus lisible au lecteur d'écran, alors qu'un réglage
          // qu'on ne peut pas changer doit rester lisible.
          if (el.tagName === 'INPUT' && el.type === 'text') { el.readOnly = verrouille || !!el.dataset.livree; }
          else { el.disabled = verrouille; }
          el.classList.toggle('fige', verrouille);
        });
      });
      caseDeverrouiller.checked = protegesEtat.deverrouille;
      etatPastille.textContent = verrouille ? TXT.rgVerrouilles : TXT.rgDeverrouilles;
      etatPastille.classList.toggle('szh-pastille--attention', verrouille);
      banniere.textContent = String(protegesEtat.avertissement || '');
      banniere.hidden = String(protegesEtat.avertissement || '') === '';
    }
    appliquerVerrou();

    function confirmerBloc(blocNom) {
      if (blocNom === 'biblio') { autoBiblio.confirme(); }
      else if (blocNom === 'tachesArticle') { autoTaches.confirme(); }
      else { auto.confirme(); }
    }

    // Rend vrai quand le message est un message des réglages.
    function surMessage(msg) {
      // Un accusé nomme son bloc : sans cela, l'accusé de l'un confirmerait l'écriture en vol de
      // l'autre. Le bloc sans nom est celui de l'export OJS, le plus ancien des trois.
      if (msg.type === MSG.ENREGISTRE) { confirmerBloc(msg.bloc); return true; }
      // Une écriture ratée relâche le verrou de l'auto-enregistrement autant qu'un succès : sinon
      // plus rien ne s'enregistre jamais après le premier échec.
      if (msg.type === MSG.ERREUR) {
        if (msg.bloc !== 'service') { confirmerBloc(msg.bloc); }
        afficherErreur(msg.message);
        return true;
      }
      if (msg.type === MSG.PROTEGES) { protegesEtat = msg; appliquerVerrou(); return true; }
      if (msg.type !== MSG.VALEURS) { return false; }
      afficherErreur('');
      cocher(msg.valeurs || {});
      zoneLangue.textContent = String(msg.avertLangue || '');
      zoneLangue.hidden = String(msg.avertLangue || '') === '';
      if (msg.poste) { rendreProduit(msg.poste); }
      if (msg.services) { rendreServices(msg.services); }
      rendreSuggestions(msg.suggInterface);
      if (msg.proteges) { protegesEtat = msg.proteges; }
      if (msg.auteursOjs) { rendreAuteursOjs(msg.auteursOjs); }
      // Une saisie en cours ne se fait pas écraser par un renvoi de valeurs.
      if (msg.ojs && !ojsModifie) {
        ojs = msg.ojs;
        montrer(blocOjs);
        resume(blocOjs, SZH.remplir(TXT, 'rgOjsResume', [ojs.locales.length, ojs.config.rubriques.length, ojs.typesArticle.length]));
        rendreOjs();
      }
      if (msg.biblio && !biblioModifie) {
        biblio = msg.biblio;
        montrer(blocBiblio);
        rendreBiblio();
      }
      if (msg.taches && !tachesModifie) {
        taches = msg.taches;
        montrer(blocTaches);
        rendreTaches();
      }
      appliquerVerrou();
      return true;
    }

    // Le produit proposé : « automatique » d'abord, avec le produit que la langue désignerait.
    function rendreProduit(poste) {
      var libelleDe = function (jeton) {
        var p = produitDe(jeton);
        return p ? p.libelle : jeton;
      };
      selProduit.textContent = '';
      var o0 = poser(selProduit, 'option', '', SZH.remplir(TXT, 'rgProduitAuto', [libelleDe(poste.produitAuto)]));
      o0.value = '';
      donnees.produits.forEach(function (p) {
        var o = poser(selProduit, 'option', '', p.libelle);
        o.value = p.jeton;
      });
      selProduit.value = poste.produit || '';
    }

    return { surMessage: surMessage, element: panneau };
  })(panneaux.reglages);

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
      activer(msg.onglet || ongletActif, !!msg.onglet);
    } else if (msg.type === MSG.LANCEUR_ALLER) {
      activer(msg.onglet, true);
    } else if (reglagesPage.surMessage(msg)) {
      return;
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
