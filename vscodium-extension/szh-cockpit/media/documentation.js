(function () {
'use strict';
// La Documentation d'un numéro — « Actualité et ressources » / « News & Ressourcen » — en UN
// SEUL formulaire : les rubriques de texte riche (références du dossier, tour d'horizon…)
// puis les fiches structurées (livres, films, interventions parlementaires, agenda…).
// Remplace les deux pages séparées ressources-article.* et rubriques-article.* — demande de
// Robin du 02.09.2026 : « fais un seul formulaire avec rubriques et les ressources ».
//
// Quatre partis de mise en page, tous demandés le même jour :
//
//   1. TOUT est pliable. Une rubrique est un accordéon à elle seule : elle n'a qu'un bloc de
//      prose, son titre EST son en-tête. Une catégorie de fiches est un intertitre suivi
//      d'une carte pliable par fiche. Un seul accordéon ouvert à la fois dans toute la page :
//      replié, on lit la structure ; ouvert, on saisit sans rien d'autre autour.
//   2. Un sommaire collant à droite : la structure entière d'un coup d'œil, le nombre de
//      fiches par catégorie, et les rubriques encore vides signalées comme telles.
//   3. Rien d'incomplet n'est refusé. Une fiche s'enregistre dès qu'un champ porte quelque
//      chose, et c'est une pastille « non complet » dans son en-tête qui dit ce qui manque —
//      l'ancien pavé « À compléter avant l'enregistrement : … » a disparu avec le refus
//      d'écrire qu'il annonçait.
//   4. Rien ne dépasse d'une carte repliée. Le lien, la zone d'image et l'état de la fiche
//      vivent DANS le corps pliable — ils restaient visibles sous les en-têtes repliés, et
//      l'accordéon ne repliait alors presque rien.
//
// Les rubriques n'ont PAS de bouton « Ajouter » : chaque type a un bloc, un seul, toujours
// présent et toujours éditable. Vider ce bloc le retire du .md ; le remplir l'y remet. Les
// fiches, elles, gardent leur bouton d'ajout par catégorie — il y en a autant qu'on veut.
//
// Le moteur reste générique : chaque catégorie de fiches est décrite par `typesConfig` et
// chaque rubrique par `typesRubrique`, tous deux construits par l'hôte depuis
// lib/ressources.js et lib/rubriques.js. Cette page ne connaît AUCUN nom de type ni de champ
// en dur, hormis les quatre champs communs à toute fiche (titre, lien, descriptif, image),
// qui sont le contrat du moteur lui-même. Un champ peut arriver avec une liste fermée de
// valeurs (`options` — le canton d'une intervention) ou une saisie de date (`saisie`) : il se
// rend alors en <select> ou en <input type="date"> sans qu'une ligne d'ici ne le sache.
//
// Identité d'une carte : un identifiant que CETTE page choisit à la création (nouvelId()),
// jamais recalculé par l'hôte — voir lib/ressources.js. Une carte neuve n'existe que dans le
// navigateur tant qu'« Enregistrer » n'a pas été demandé ; la retirer ne dérange donc pas
// l'hôte pour rien.
//
// Protocole. Vers l'hôte :
//   pret ; modifie { modifie } ; enregistrer { auto, ressources, rubriques } ;
//   retirer { famille, id } ; deposer-image { id, nomFichier, donneesBase64 } ;
//   detacher { id } ; envoyer { id } ; retourArticle { modifie, ressources, rubriques }
// où ressources = [{ id, type, valeurs }], valeurs = { titre, lien, descriptif, image,
// …champs du type }, et rubriques = [{ id, type, contenu }] — les rubriques VIDES en font
// partie, c'est ainsi que l'hôte apprend qu'un bloc doit sortir du .md.
// Depuis l'hôte :
//   charger { slug, ressources, rubriques, typesConfig, typesRubrique, accent, i18n } ;
//   enregistre { auto } ; erreur { message } ; image-deposee { id, image, apercu } ;
//   image-erreur { id, message }
// où une fiche reçue vaut { id, type, valeurs, apercu }, une rubrique { id, type, contenu },
// un type de typesConfig { valeur, libelleSection, libelleAjouter, libelleAjouterTip,
// avecImage, champs: [{ cle, libelle, options?, saisie? }] } et un type de typesRubrique
// { valeur, libelleSection }.
var api = acquireVsCodeApi();
// Mêmes plafonds que l'hôte, qui recontrôle tout : répondre tout de suite plutôt que
// d'envoyer un fichier que l'hôte refusera de toute façon.
var IMAGE = {
  maxi: 50 * 1024 * 1024, extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'],
  format: 'errFormat', poids: 'errTropVolumineuse'
};
var TXT = {}, ctl = {}, cartes = [], sections = [], TYPES = [], TYPES_RUBRIQUE = [];
var dernierModifie = false;
var barre = document.getElementById('barre');
var zoneSections = document.getElementById('sections');
var zoneSommaire = document.getElementById('sommaire');
var compteurId = 0;
var compteurIndex = 0;

function nouvelId() {
  compteurId += 1;
  return 'r' + Date.now().toString(36) + compteurId.toString(36) + Math.random().toString(36).slice(2, 6);
}

function bouton(txt, fn, cls, titre) {
  var b = document.createElement('button');
  b.type = 'button';
  b.textContent = txt;
  b.className = 'szh-bouton' + (cls ? ' ' + cls : '');
  if (titre) { b.title = titre; }
  b.addEventListener('click', fn);
  return b;
}
function boutonIcone(nom, titre, fn, cls) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'szh-ico' + (cls ? ' ' + cls : '');
  b.title = titre || '';
  b.setAttribute('aria-label', titre || '');
  b.appendChild(SZH.icone(nom));
  b.addEventListener('click', fn);
  return b;
}
function texte(parent, balise, cls, contenu) {
  var e = document.createElement(balise);
  if (cls) { e.className = cls; }
  if (contenu !== undefined && contenu !== null) { e.textContent = contenu; }
  parent.appendChild(e);
  return e;
}
function ligne(v) { return String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' ').trim(); }
function remplir(cle, valeurs) {
  var t = String(TXT[cle] || '');
  for (var i = 0; i < (valeurs || []).length; i++) { t = t.split('{' + i + '}').join(String(valeurs[i])); }
  return t;
}
function etat(msg) { if (ctl.etat) { ctl.etat.textContent = msg || ''; } }
function allerA(el) {
  try { if (el && typeof el.scrollIntoView === 'function') { el.scrollIntoView({ block: 'start' }); } }
  catch (e) { /* environnement sans mise en page (tests) */ }
}

// ---- Barre d'outils de texte riche (rubriques) ----------------------------------------
// Reprise telle quelle de l'ancien rubriques-article.js, y compris ses pièges éprouvés.
// Le style (gras, italique) est porté par la classe, jamais par le texte du bouton : le
// libellé affiché reste celui de l'hôte (i18n), rien n'est écrit en dur ici.
function outilBouton(cls, libelle, titre, fn) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'szh-bouton doc-outil doc-outil--' + cls;
  b.textContent = libelle || '';
  if (titre) { b.title = titre; b.setAttribute('aria-label', titre); }
  // Empêche le bouton de voler le focus du textarea : sans ce garde-fou, la sélection en
  // cours serait perdue avant même que le clic ne s'exécute sur certains moteurs.
  b.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
  b.addEventListener('click', fn);
  return b;
}

// Convention fixe, sans ambiguïté : le GRAS est toujours la couche EXTÉRIEURE (**…**),
// l'ITALIQUE toujours la couche INTÉRIEURE, collée au texte (*…*). Un texte à la fois gras
// et italique s'écrit donc ***texte*** — markdown valide, que pandoc rend en <strong><em>.
//
// ⚠ Piège éprouvé : sélectionner « gras » à l'intérieur de « **gras** » et cliquer Italique
// ne doit PAS produire ***gras*** en ajoutant un astérisque de chaque côté SANS COMPTER ceux
// déjà présents (l'erreur classique d'une bascule qui ne regarde que le caractère collé à la
// sélection, et confond la moitié d'un double astérisque avec un simple astérisque isolé) —
// ni, à l'inverse, perdre le gras existant en le prenant pour de l'italique. La bascule
// compte donc le nombre RÉEL d'astérisques de bord après avoir étendu la sélection pour les
// absorber tous.
function compterAstDebut(s) {
  var n = 0;
  while (n < s.length && s.charAt(n) === '*') { n++; }
  return n;
}
function compterAstFin(s) {
  var n = 0;
  while (n < s.length - n && s.charAt(s.length - 1 - n) === '*') { n++; }
  return n;
}
function etendreSelection(valeur, debut, fin) {
  while (debut > 0 && valeur.charAt(debut - 1) === '*') { debut--; }
  while (fin < valeur.length && valeur.charAt(fin) === '*') { fin++; }
  return { debut: debut, fin: fin };
}
function basculerEmphase(valeur, debut, fin, gras) {
  var e = etendreSelection(valeur, debut, fin);
  var sel = valeur.slice(e.debut, e.fin);
  var avant = compterAstDebut(sel);
  var apres = compterAstFin(sel);
  // Garde-fou : une sélection qui ne serait QUE des astérisques (cas pathologique, jamais un
  // vrai contenu de bibliographie) ne doit pas produire un texte nu de longueur négative.
  if (avant + apres > sel.length) { var moitie = Math.floor(sel.length / 2); avant = moitie; apres = sel.length - moitie; }
  var texteNu = sel.slice(avant, sel.length - apres);
  var aBold = avant >= 2 && apres >= 2;
  var aItalique = (avant % 2 === 1) && (apres % 2 === 1);
  // Chaque bouton ne bascule QUE sa propre couche : Gras ne touche jamais l'état italique,
  // et réciproquement.
  var nvBold = gras ? !aBold : aBold;
  var nvItalique = gras ? aItalique : !aItalique;
  var nv = texteNu;
  if (nvItalique) { nv = '*' + nv + '*'; }
  if (nvBold) { nv = '**' + nv + '**'; }
  var debutTexte = e.debut + (nvBold ? 2 : 0) + (nvItalique ? 1 : 0);
  return {
    valeur: valeur.slice(0, e.debut) + nv + valeur.slice(e.fin),
    debut: debutTexte, fin: debutTexte + texteNu.length
  };
}

// Lien : texte -> [texte](https://), l'URL de repli sélectionnée pour être remplacée aussitôt ;
// sélection vide -> [](https://), curseur entre les crochets pour taper le libellé.
function creerLien(valeur, debut, fin) {
  var sel = valeur.slice(debut, fin);
  var url = 'https://';
  if (sel === '') {
    var nv0 = '[](' + url + ')';
    var pos = debut + 1;
    return { valeur: valeur.slice(0, debut) + nv0 + valeur.slice(fin), debut: pos, fin: pos };
  }
  var prefixe = '[' + sel + '](';
  var urlDebut = debut + prefixe.length;
  var nv = prefixe + url + ')';
  return {
    valeur: valeur.slice(0, debut) + nv + valeur.slice(fin),
    debut: urlDebut, fin: urlDebut + url.length
  };
}

// Liste : préfixe chaque ligne NON VIDE de la sélection par « - », et bascule — les lignes
// vides (celles qui séparent deux entrées d'une bibliographie) ne comptent jamais, ni pour
// décider si tout est déjà en liste, ni pour recevoir un « - ».
function basculerListe(valeur, debut, fin) {
  var debutLigne = valeur.lastIndexOf('\n', debut - 1) + 1;
  var finLigne = valeur.indexOf('\n', fin);
  if (finLigne === -1) { finLigne = valeur.length; }
  var bloc = valeur.slice(debutLigne, finLigne);
  var lignes = bloc.split('\n');
  var nonVides = lignes.filter(function (l) { return l.trim() !== ''; });
  var toutesEnListe = nonVides.length > 0 && nonVides.every(function (l) { return /^\s*-\s/.test(l); });
  var nvLignes = lignes.map(function (l) {
    if (l.trim() === '') { return l; }
    if (toutesEnListe) { return l.replace(/^(\s*)-\s/, '$1'); }
    return (/^\s*-\s/).test(l) ? l : '- ' + l;
  });
  var nvBloc = nvLignes.join('\n');
  return {
    valeur: valeur.slice(0, debutLigne) + nvBloc + valeur.slice(finLigne),
    debut: debutLigne, fin: debutLigne + nvBloc.length
  };
}

// Le textarea grandit avec son contenu, borné : passé ce point il garde sa propre barre de
// défilement plutôt que de pousser la page à l'infini.
var HAUTEUR_MAX = 480;
function ajusterHauteur(zone) {
  try {
    zone.style.height = 'auto';
    if (typeof zone.scrollHeight === 'number' && zone.scrollHeight > 0) {
      zone.style.height = Math.min(zone.scrollHeight, HAUTEUR_MAX) + 'px';
      zone.style.overflowY = zone.scrollHeight > HAUTEUR_MAX ? 'auto' : 'hidden';
    }
  } catch (e) { /* environnement sans mesure de disposition (tests) */ }
}

// Applique une transformation pure à la sélection courante du textarea d'une rubrique, puis
// restaure le focus et une sélection cohérente — sans cela, la souris repartirait du haut du
// formulaire à chaque clic d'outil.
function appliquer(c, fn) {
  var zone = c.ctl.contenu;
  var debut = zone.selectionStart || 0;
  var fin = zone.selectionEnd || 0;
  var res = fn(String(zone.value || ''), debut, fin);
  zone.value = res.valeur;
  c.touchee = true;
  ajusterHauteur(zone);
  try { zone.focus(); zone.setSelectionRange(res.debut, res.fin); } catch (e) { /* sélection indisponible (tests) */ }
  etat('');
  majEtatCarte(c);
  majModifie();
}

// ---- Valeurs, complétude, modification ------------------------------------------------
//
// Champs requis d'une fiche : les mêmes que REQUIS dans lib/ressources.js (titre,
// descriptif, image) — mais ils ne conditionnent plus l'ÉCRITURE, seulement la pastille
// « non complet ». Ce qui conditionne l'écriture est plus bas : estEcrivable().
var REQUIS = ['titre', 'descriptif', 'image'];
var LIBELLE_REQUIS = { titre: 'champTitre', descriptif: 'champDescriptif', image: 'champImage' };

function valeursFiche(c) {
  var v = {
    titre: ligne(c.ctl.titre.value), lien: ligne(c.ctl.lien.value),
    descriptif: String(c.ctl.descriptif.value || '').replace(/\r\n/g, '\n'),
    image: c.avecImage ? (c.image || '') : ''
  };
  for (var i = 0; i < c.champs.length; i++) {
    var cle = c.champs[i].cle;
    v[cle] = ligne(c.ctl[cle].value);
  }
  return v;
}
function valeurs(c) {
  return c.famille === 'rubrique'
    ? { contenu: String(c.ctl.contenu.value || '').replace(/\r\n/g, '\n') }
    : valeursFiche(c);
}

function champsManquants(c) {
  if (c.famille === 'rubrique') { return valeurs(c).contenu.trim() === '' ? ['contenu'] : []; }
  var v = valeurs(c);
  var manque = [];
  for (var i = 0; i < REQUIS.length; i++) {
    var cle = REQUIS[i];
    if (cle === 'image' && !c.avecImage) { continue; }
    if (v[cle] === '') { manque.push(cle); }
  }
  return manque;
}
// Ce qui part à l'hôte. Une fiche neuve part dès qu'UN champ porte quelque chose — c'est le
// « permet enregistrement » demandé le 02.09.2026, en remplacement du refus d'écrire une
// fiche incomplète. Une fiche déjà dans le .md part toujours, même vidée : sans cela, effacer
// un champ ne s'enregistrerait jamais et l'ancienne valeur reviendrait au rechargement.
// Une rubrique part toujours elle aussi, vide comprise : c'est ainsi que l'hôte apprend
// qu'un bloc doit sortir du .md (voir la table de protocole en tête de fichier).
function aQuelqueChose(c) {
  var v = valeurs(c);
  for (var cle in v) {
    if (Object.prototype.hasOwnProperty.call(v, cle) && String(v[cle] || '').trim() !== '') { return true; }
  }
  return false;
}
function estEcrivable(c) { return c.famille === 'rubrique' || c.persistee || aQuelqueChose(c); }

function estModifieCarte(c) {
  // Une carte neuve jamais touchée ne compte pas : ouvrir puis revenir aussitôt ne doit pas
  // déclencher l'avertissement « non enregistré ».
  if (!c.touchee) { return false; }
  if (!estEcrivable(c)) { return false; }         // rien d'écrivable : rien à perdre
  if (!c.enregistree) { return aQuelqueChose(c); }
  return JSON.stringify(valeurs(c)) !== JSON.stringify(c.enregistree);
}
function estModifie() {
  for (var i = 0; i < cartes.length; i++) { if (estModifieCarte(cartes[i])) { return true; } }
  return false;
}
function majModifie() {
  var m = estModifie();
  if (ctl.indic) {
    ctl.indic.textContent = m ? '●' : '';
    ctl.indic.title = m ? (TXT.nonEnregistre || '') : '';
  }
  if (m !== dernierModifie) { dernierModifie = m; api.postMessage({ type: 'modifie', modifie: m }); }
}

function aEnvoyer(famille) {
  var res = [];
  for (var i = 0; i < cartes.length; i++) {
    var c = cartes[i];
    if (c.famille !== famille || !estEcrivable(c)) { continue; }
    res.push(famille === 'rubrique'
      ? { id: c.id, type: c.type, contenu: valeurs(c).contenu }
      : { id: c.id, type: c.type, valeurs: valeurs(c) });
  }
  return res;
}

// ---- La pastille d'état d'une carte ---------------------------------------------------
// Remplace le pavé « À compléter avant l'enregistrement : … », supprimé avec le refus
// d'écrire (02.09.2026). Ce qui manque n'a pas disparu pour autant : il est dans l'infobulle
// de la pastille, là où on le cherche quand on se demande pourquoi elle est là.
function majEtatCarte(c) {
  var manque = champsManquants(c);
  if (c.ctl.badge) {
    c.ctl.badge.hidden = manque.length === 0;
    if (manque.length > 0) {
      var libelles = manque.map(function (cle) {
        return c.famille === 'rubrique' ? (TXT.champContenu || cle) : (TXT[LIBELLE_REQUIS[cle]] || cle);
      });
      c.ctl.badge.title = remplir('manque', [libelles.join(', ')]);
    } else {
      c.ctl.badge.title = '';
    }
  }
  majSommaire();
}

// ---- Un champ : texte, liste fermée, ou date ------------------------------------------
// `options` (liste fermée) et `saisie` ('date') viennent de l'hôte, par champ et par type :
// voir typesRessourceConfig() dans extension.js. Un champ sans ni l'un ni l'autre reste une
// simple ligne de texte, ce qu'ils sont presque tous.
function poserValeurChoix(sel, v) {
  var valeur = String(v === undefined || v === null ? '' : v);
  if (valeur !== '') {
    var connue = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === valeur) { connue = true; break; }
    }
    // Une valeur que la liste ne connaît pas — bloc écrit à la main, liste raccourcie depuis —
    // s'ajoute en fin de liste plutôt que d'être perdue au premier enregistrement.
    if (!connue) {
      var extra = document.createElement('option');
      extra.value = valeur;
      extra.textContent = valeur;
      sel.appendChild(extra);
    }
  }
  sel.value = valeur;
}

function champ(parent, c, cle, libelle, indice, multiligne, options, saisie) {
  var d = texte(parent, 'div', 'szh-champ');
  var id = 'ch-' + cle + '-' + c.index;
  var l = texte(d, 'label', null, libelle || '');
  l.setAttribute('for', id);
  var i;
  var surChangement = function () {
    c.touchee = true;
    etat('');
    majEtatCarte(c);
    majModifie();
  };
  if (options && options.length > 0) {
    i = document.createElement('select');
    var vide = document.createElement('option');
    vide.value = '';
    vide.textContent = TXT.optionVide || '—';
    i.appendChild(vide);
    for (var k = 0; k < options.length; k++) {
      var o = document.createElement('option');
      o.value = String(options[k].valeur || '');
      o.textContent = String(options[k].libelle || options[k].valeur || '');
      i.appendChild(o);
    }
    i.addEventListener('change', surChangement);
  } else {
    i = document.createElement(multiligne ? 'textarea' : 'input');
    if (multiligne) { i.rows = 3; } else { i.type = (saisie === 'date' ? 'date' : 'text'); }
    i.maxLength = multiligne ? 4000 : 300;
    if (indice) { i.placeholder = indice; }
    i.addEventListener('input', surChangement);
  }
  i.id = id;
  d.appendChild(i);
  c.ctl[cle] = i;
  c.estChoix = c.estChoix || {};
  c.estChoix[cle] = !!(options && options.length > 0);
  return d;
}

// ---- L'image de couverture, toujours décorative --------------------------------------
function poserVignette(c) {
  var zone = c.ctl.vignette;
  zone.textContent = '';
  if (!c.apercu) { texte(zone, 'p', 'absent', TXT.imageAbsente || ''); return; }
  var img = document.createElement('img');
  img.src = c.apercu;
  img.alt = '';                                    // décorative jusque dans l'aperçu de saisie
  zone.appendChild(img);
}
function poserEtatDepot(c, message, erreur) {
  var e = c.ctl.depotEtat;
  if (!e) { return; }
  e.textContent = message || '';
  e.className = 'doc-depot-etat' + (erreur ? ' erreur' : '');
}
function envoyerImage(c, f) {
  var ext = (String(f.name || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  if (IMAGE.extensions.indexOf(ext) === -1) { poserEtatDepot(c, '⚠ ' + (TXT[IMAGE.format] || ''), true); return; }
  if (f.size > IMAGE.maxi) { poserEtatDepot(c, '⚠ ' + (TXT[IMAGE.poids] || ''), true); return; }
  poserEtatDepot(c, '…');
  var lecteur = new FileReader();
  lecteur.onerror = function () { poserEtatDepot(c, '⚠ ' + (TXT[IMAGE.format] || ''), true); };
  lecteur.onload = function () {
    var t = String(lecteur.result || '');
    var virgule = t.indexOf(',');
    if (virgule === -1) { poserEtatDepot(c, '⚠ ' + (TXT[IMAGE.format] || ''), true); return; }
    api.postMessage({
      type: 'deposer-image', id: c.id, nomFichier: f.name, donneesBase64: t.slice(virgule + 1)
    });
  };
  lecteur.readAsDataURL(f);
}
function construireDepot(parent, c) {
  var d = texte(parent, 'div', 'doc-depot');
  var titreZone = texte(d, 'span', 'depot-titre');
  var choisir = bouton(TXT.choisirFichier || '', function () { fichier.click(); });
  var fichier = document.createElement('input');
  fichier.type = 'file';
  fichier.accept = IMAGE.extensions.map(function (e) { return '.' + e; }).join(',');
  fichier.hidden = true;
  fichier.addEventListener('change', function () {
    if (fichier.files && fichier.files[0]) { envoyerImage(c, fichier.files[0]); }
    fichier.value = '';
  });
  d.appendChild(titreZone);
  d.appendChild(choisir);
  d.appendChild(fichier);
  d.addEventListener('dragover', function (e) { e.preventDefault(); d.classList.add('survol'); });
  d.addEventListener('dragleave', function () { d.classList.remove('survol'); });
  d.addEventListener('drop', function (e) {
    e.preventDefault();
    d.classList.remove('survol');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { envoyerImage(c, f); }
  });
  c.ctl.depotEtat = texte(d, 'span', 'doc-depot-etat');
  return d;
}

// ---- Accordéon : un seul ouvert dans toute la page -----------------------------------
// Rubriques comprises, et non deux groupes séparés : la page est longue (une douzaine
// d'entrées), et deux accordéons ouverts en même temps rendraient le sommaire inutile.
// Fermer ne perd rien — les valeurs restent dans les champs, seul l'affichage se replie.
function ouvrirCarte(c, ouvrir) {
  for (var i = 0; i < cartes.length; i++) {
    var autre = cartes[i];
    if (!autre.ctl.corps) { continue; }
    var vise = (autre === c) && ouvrir;
    autre.ctl.corps.hidden = !vise;
    if (autre.ctl.bascule) { autre.ctl.bascule.setAttribute('aria-expanded', vise ? 'true' : 'false'); }
    if (autre.element) {
      if (vise) { autre.element.classList.add('doc-carte--ouverte'); }
      else { autre.element.classList.remove('doc-carte--ouverte'); }
    }
  }
}
function basculerCarte(c) {
  ouvrirCarte(c, !!(c.ctl.corps && c.ctl.corps.hidden));
}

// Le libellé de l'en-tête d'une fiche : sa position dans sa catégorie, puis son titre. La
// position est celle du .md — les fiches y sont rangées à l'enregistrement
// (lib/ressources.js, reordonnerRessources) — de sorte que ce numéro dit vraiment où la
// fiche s'imprimera.
function majTitreBascule(c) {
  if (!c.ctl.libelle) { return; }
  if (c.famille === 'rubrique') { return; }        // son titre est celui de la rubrique
  var t = c.ctl.titre ? ligne(c.ctl.titre.value) : '';
  if (t === '') { t = TXT.sansTitre || '—'; }
  c.ctl.libelle.textContent = String(c.position || 1) + ' · ' + t;
}

// Renumérote toutes les fiches, catégorie par catégorie : une fiche ajoutée ou retirée
// décale celles qui la suivent, et un numéro périmé serait pire que pas de numéro du tout.
function majPositions() {
  var compte = {};
  for (var i = 0; i < cartes.length; i++) {
    var c = cartes[i];
    if (c.famille !== 'fiche') { continue; }
    compte[c.type] = (compte[c.type] || 0) + 1;
    c.position = compte[c.type];
    majTitreBascule(c);
  }
}

// L'en-tête pliable, commun aux deux familles : un vrai <button>, pas un <div> cliquable —
// sans quoi la carte ne s'ouvrirait ni au clavier ni au lecteur d'écran, ce qui n'a pas sa
// place dans un outil de pédagogie spécialisée. aria-expanded dit l'état.
function construireTete(c, parent, cls) {
  var tete = texte(parent, 'header', cls);
  c.ctl.bascule = texte(tete, 'button', 'doc-bascule');
  c.ctl.bascule.type = 'button';
  c.ctl.bascule.setAttribute('aria-expanded', 'false');
  c.ctl.bascule.addEventListener('click', function () { basculerCarte(c); });
  c.ctl.libelle = texte(c.ctl.bascule, 'span', 'doc-bascule-libelle');
  c.ctl.badge = texte(c.ctl.bascule, 'span',
    'szh-pastille szh-pastille--attention doc-badge',
    c.famille === 'rubrique' ? (TXT.badgeVide || '') : (TXT.badgeIncomplet || ''));
  c.ctl.badge.hidden = true;
  texte(tete, 'span', 'szh-pousse');
  return tete;
}

// ---- Une carte de fiche ---------------------------------------------------------------
// `persistee` dit si la fiche existe déjà dans le .md (chargée depuis l'hôte) : la retirer
// doit alors le lui dire. Une fiche neuve n'existe nulle part ailleurs que dans cette page
// tant qu'elle n'a pas été enregistrée.
function construireFiche(section, ressource, persistee) {
  var c = {
    famille: 'fiche', id: ressource.id, type: section.type, index: ++compteurIndex, ctl: {},
    champs: section.champs, avecImage: section.avecImage,
    image: (ressource.valeurs || {}).image || '', apercu: ressource.apercu || null,
    persistee: !!persistee, touchee: false, enregistree: null
  };
  var s = document.createElement('section');
  s.className = 'szh-carte doc-carte doc-fiche';
  c.element = s;

  var tete = construireTete(c, s, 'doc-tete');
  // Réserve et échange entre les deux revues. Ces deux gestes n'ont de sens que sur une
  // fiche DÉJÀ DANS LE .MD : l'hôte les traite en relisant le fichier par identifiant, et
  // une carte jamais enregistrée n'y est pas — d'où le masquage, refait à chaque
  // enregistrement (voir majGestesReserve).
  c.ctl.detacher = boutonIcone('bas', TXT.detacherTip || '', function () {
    api.postMessage({ type: 'detacher', id: c.id });
  });
  c.ctl.envoyer = boutonIcone('traduction', TXT.envoyerTip || '', function () {
    api.postMessage({ type: 'envoyer', id: c.id });
  });
  tete.appendChild(c.ctl.detacher);
  tete.appendChild(c.ctl.envoyer);
  majGestesReserve(c);
  tete.appendChild(boutonIcone('poubelle', TXT.retirerTip || '', function () { retirerFiche(c); }, 'szh-ico--danger'));

  // TOUT le reste vit dans le corps pliable — y compris le lien et l'image, qui restaient
  // dehors et dépassaient donc d'une carte repliée (demande du 02.09.2026). `hidden` plutôt
  // qu'une classe : l'élément sort alors de l'arbre d'accessibilité, donc un lecteur d'écran
  // ne lit pas le contenu d'une fiche fermée.
  var corps = texte(s, 'div', 'doc-corps');
  corps.hidden = true;
  c.ctl.corps = corps;

  var v = ressource.valeurs || {};
  champ(corps, c, 'titre', TXT.champTitre, TXT.champTitreIndice, false);

  if (c.champs.length > 0) {
    var biblio = texte(corps, 'div', 'doc-biblio');
    for (var i = 0; i < c.champs.length; i++) {
      champ(biblio, c, c.champs[i].cle, c.champs[i].libelle, '', false,
        c.champs[i].options, c.champs[i].saisie);
    }
  }

  champ(corps, c, 'descriptif', TXT.champDescriptif, TXT.champDescriptifIndice, true);

  // Types sans image (c.avecImage) : aucune zone de dépôt — ni champ vide à ignorer, ni
  // vignette « Aucune image » qui n'aurait jamais de raison de se remplir. Voir
  // lib/ressources.js (SANS_IMAGE) et pipeline/filters/szh-ressource.lua pour le pendant côté
  // rendu, déjà générique sans avoir besoin de connaître cette liste.
  if (c.avecImage) {
    var zoneImage = texte(corps, 'div', 'doc-image');
    c.ctl.vignette = texte(zoneImage, 'div', 'doc-vignette');
    construireDepot(zoneImage, c);
  }

  champ(corps, c, 'lien', TXT.champLien, TXT.champLienIndice, false);

  // Valeurs initiales.
  c.ctl.titre.value = String(v.titre || '');
  c.ctl.lien.value = String(v.lien || '');
  c.ctl.descriptif.value = String(v.descriptif || '');
  for (var k = 0; k < c.champs.length; k++) {
    var cle = c.champs[k].cle;
    if (c.estChoix && c.estChoix[cle]) { poserValeurChoix(c.ctl[cle], v[cle]); }
    else { c.ctl[cle].value = String(v[cle] || ''); }
  }
  if (c.avecImage) { poserVignette(c); }
  c.enregistree = c.persistee ? valeurs(c) : null;

  cartes.push(c);
  // Le libellé de l'accordéon suit le titre à la frappe : sans cela, une fiche qu'on vient de
  // nommer resterait « (sans titre) » jusqu'au prochain rechargement.
  c.ctl.titre.addEventListener('input', function () { majTitreBascule(c); });
  majEtatCarte(c);
  majPositions();
  return c;
}

// Les deux gestes de réserve suivent `persistee` : invisibles tant que la fiche n'existe que
// dans cette page. `hidden` et non une classe, pour que le bouton sorte aussi de l'arbre
// d'accessibilité — un bouton annoncé mais sans effet ne vaut rien.
function majGestesReserve(c) {
  if (c.ctl.detacher) { c.ctl.detacher.hidden = !c.persistee; }
  if (c.ctl.envoyer) { c.ctl.envoyer.hidden = !c.persistee; }
}

function retirerFiche(c) {
  c.element.remove();
  cartes = cartes.filter(function (x) { return x !== c; });
  if (c.persistee) { api.postMessage({ type: 'retirer', famille: 'fiche', id: c.id }); }
  majPositions();          // les fiches suivantes se décalent : leur numéro doit suivre
  majSommaire();
  majModifie();
}

// ---- Une rubrique : un bloc, un seul, toujours là -------------------------------------
// Pas de bouton « Ajouter », pas de carte à créer ni à supprimer : chaque type de rubrique a
// son unique bloc, présent dès l'ouverture, vide ou non (demande du 02.09.2026). La corbeille
// ne retire donc pas la carte — elle en vide le texte, ce qui ôte le bloc du .md et fait
// disparaître la rubrique du PDF. La remplir la fait revenir.
//
// L'accordéon est ici la rubrique ELLE-MÊME : son titre imprimé est son en-tête, il n'y a
// donc ni intertitre ni carte à distinguer. C'est aussi pourquoi ce titre ne se saisit
// jamais — il se déduit du type et de la langue au rendu (pipeline/filters/szh-rubrique.lua).
function construireRubrique(type, rubrique, persistee) {
  var c = {
    famille: 'rubrique', id: rubrique.id, type: type.valeur, index: ++compteurIndex, ctl: {},
    libelleSection: type.libelleSection || type.valeur,
    persistee: !!persistee, touchee: false, enregistree: null
  };
  var s = texte(zoneSections, 'section', 'szh-carte doc-carte doc-rubrique');
  s.id = 'sec-r-' + type.valeur;
  c.element = s;

  var tete = construireTete(c, s, 'doc-tete');
  c.ctl.libelle.textContent = c.libelleSection;
  tete.appendChild(boutonIcone('poubelle', TXT.viderTip || '', function () { viderRubrique(c); }, 'szh-ico--danger'));

  var corps = texte(s, 'div', 'doc-corps');
  corps.hidden = true;
  c.ctl.corps = corps;

  var outils = texte(corps, 'div', 'doc-outils');
  outils.appendChild(outilBouton('gras', TXT.gras, TXT.grasTip,
    function () { appliquer(c, function (v, d, f) { return basculerEmphase(v, d, f, true); }); }));
  outils.appendChild(outilBouton('italique', TXT.italique, TXT.italiqueTip,
    function () { appliquer(c, function (v, d, f) { return basculerEmphase(v, d, f, false); }); }));
  outils.appendChild(outilBouton('lien', TXT.lien, TXT.lienTip, function () { appliquer(c, creerLien); }));
  outils.appendChild(outilBouton('liste', TXT.liste, TXT.listeTip, function () { appliquer(c, basculerListe); }));

  var champDiv = texte(corps, 'div', 'szh-champ doc-champ');
  var idChamp = 'ch-contenu-' + c.index;
  var label = texte(champDiv, 'label', null, TXT.champContenu || '');
  label.setAttribute('for', idChamp);
  var zone = document.createElement('textarea');
  zone.id = idChamp;
  zone.rows = 4;
  if (TXT.champContenuIndice) { zone.placeholder = TXT.champContenuIndice; }
  zone.addEventListener('input', function () {
    c.touchee = true;
    ajusterHauteur(zone);
    etat('');
    majEtatCarte(c);
    majModifie();
  });
  // Ctrl+B / Ctrl+I au clavier, sans remonter à l'éditeur — un rédacteur qui tape au clavier
  // plutôt qu'à la souris ne doit pas perdre ce raccourci au profit de VS Code.
  zone.addEventListener('keydown', function (ev) {
    if (!(ev.ctrlKey || ev.metaKey)) { return; }
    var touche = (ev.key || '').toLowerCase();
    if (touche === 'b') { ev.preventDefault(); appliquer(c, function (v, d, f) { return basculerEmphase(v, d, f, true); }); }
    else if (touche === 'i') { ev.preventDefault(); appliquer(c, function (v, d, f) { return basculerEmphase(v, d, f, false); }); }
  });
  champDiv.appendChild(zone);
  c.ctl.contenu = zone;

  zone.value = String(rubrique.contenu || '');
  ajusterHauteur(zone);
  c.enregistree = c.persistee ? valeurs(c) : null;

  cartes.push(c);
  majEtatCarte(c);
  return c;
}

function viderRubrique(c) {
  c.ctl.contenu.value = '';
  ajusterHauteur(c.ctl.contenu);
  if (c.persistee) { api.postMessage({ type: 'retirer', famille: 'rubrique', id: c.id }); }
  c.persistee = false;
  c.enregistree = null;
  c.touchee = false;
  majEtatCarte(c);
  majModifie();
}

// ---- Une catégorie de fiches ----------------------------------------------------------
function construireSectionFiches(type) {
  var s = {
    famille: 'fiche', type: type.valeur, libelleSection: type.libelleSection || type.valeur,
    champs: type.champs || [], avecImage: type.avecImage !== false
  };
  var tete = texte(zoneSections, 'h2', 'titre-section doc-titre-fiches');
  tete.id = 'sec-f-' + type.valeur;
  texte(tete, 'span', null, s.libelleSection);
  s.compteur = texte(tete, 'span', 'doc-compte-section');
  s.element = tete;
  var conteneur = texte(zoneSections, 'div', 'doc-section');
  s.corps = conteneur;
  s.ajouter = bouton(type.libelleAjouter || '', function () {
    var c = construireFiche(s, { id: nouvelId(), type: s.type, valeurs: {}, apercu: null }, false);
    conteneur.insertBefore(c.element, s.ajouter);
    // Une fiche neuve s'ouvre aussitôt — et referme la précédente, l'accordéon n'en gardant
    // qu'une. Sans cela, enchaîner dix livres demanderait un clic de plus par livre, ce qui
    // irait contre la saisie en série voulue.
    ouvrirCarte(c, true);
    majSommaire();
    try { c.ctl.titre.focus(); } catch (e) { /* pas focalisable */ }
  }, 'szh-bouton--principal doc-ajouter', type.libelleAjouterTip || '');
  conteneur.appendChild(s.ajouter);
  return s;
}

// ---- Le sommaire collant --------------------------------------------------------------
// La structure entière, à droite et toujours visible (demande du 02.09.2026) : les rubriques
// avec leur état — une rubrique vide ne s'imprimera pas, et c'est la seule chose qu'on veuille
// savoir d'elle sans l'ouvrir — puis les catégories de fiches avec leur nombre. Cliquer une
// entrée y mène ; pour une rubrique, l'ouvre au passage, puisqu'une rubrique EST son bloc.
function compteCartes(famille, type) {
  var n = 0;
  for (var i = 0; i < cartes.length; i++) {
    if (cartes[i].famille === famille && cartes[i].type === type) { n++; }
  }
  return n;
}
function carteRubrique(type) {
  for (var i = 0; i < cartes.length; i++) {
    if (cartes[i].famille === 'rubrique' && cartes[i].type === type) { return cartes[i]; }
  }
  return null;
}

function construireSommaire() {
  zoneSommaire.textContent = '';
  // Le <nav> tire son nom accessible du titre affiché, plutôt que d'un aria-label qui
  // dirait la même chose une seconde fois — et qui pourrait diverger de lui.
  var titre = texte(zoneSommaire, 'p', 'doc-sommaire-titre', TXT.sommaire || '');
  titre.id = 'doc-sommaire-titre';
  zoneSommaire.setAttribute('aria-labelledby', titre.id);
  ctl.sommaireEntrees = [];
  var liste = texte(zoneSommaire, 'ul', 'doc-sommaire-liste');
  var groupe = function (libelle) {
    if (libelle) { texte(liste, 'li', 'doc-sommaire-groupe', libelle); }
  };
  var entree = function (famille, type, libelle) {
    var li = texte(liste, 'li', 'doc-sommaire-item');
    var b = texte(li, 'button', 'doc-sommaire-lien');
    b.type = 'button';
    texte(b, 'span', 'doc-sommaire-nom', libelle);
    var marque = texte(b, 'span', 'doc-sommaire-marque');
    b.addEventListener('click', function () {
      var cible = document.getElementById((famille === 'rubrique' ? 'sec-r-' : 'sec-f-') + type);
      if (famille === 'rubrique') {
        var c = carteRubrique(type);
        if (c) { ouvrirCarte(c, true); }
      }
      allerA(cible);
    });
    ctl.sommaireEntrees.push({ famille: famille, type: type, marque: marque });
  };
  if (TYPES_RUBRIQUE.length > 0) {
    groupe(TXT.groupeRubriques);
    for (var i = 0; i < TYPES_RUBRIQUE.length; i++) {
      entree('rubrique', TYPES_RUBRIQUE[i].valeur, TYPES_RUBRIQUE[i].libelleSection || TYPES_RUBRIQUE[i].valeur);
    }
  }
  if (TYPES.length > 0) {
    groupe(TXT.groupeFiches);
    for (var j = 0; j < TYPES.length; j++) {
      entree('fiche', TYPES[j].valeur, TYPES[j].libelleSection || TYPES[j].valeur);
    }
  }
}

function majSommaire() {
  for (var i = 0; i < (ctl.sommaireEntrees || []).length; i++) {
    var e = ctl.sommaireEntrees[i];
    if (e.famille === 'rubrique') {
      var c = carteRubrique(e.type);
      var vide = !c || champsManquants(c).length > 0;
      e.marque.textContent = vide ? (TXT.badgeVide || '') : '';
      e.marque.className = 'doc-sommaire-marque' + (vide ? ' doc-sommaire-marque--vide' : '');
    } else {
      var n = compteCartes('fiche', e.type);
      e.marque.textContent = n > 0 ? String(n) : '';
      e.marque.className = 'doc-sommaire-marque' + (n > 0 ? ' doc-sommaire-marque--compte' : '');
    }
  }
  for (var k = 0; k < sections.length; k++) {
    var s = sections[k];
    if (!s.compteur) { continue; }
    var m = compteCartes('fiche', s.type);
    s.compteur.textContent = m > 0 ? '(' + m + ')' : '';
  }
}

// ---- Barre d'en-tête ------------------------------------------------------------------
function construireBarre() {
  barre.textContent = '';
  barre.className = 'szh-barre';
  ctl.enregistrer = bouton(TXT.enregistrer, function () { enregistrer(false); },
    'szh-bouton--principal', TXT.enregistrerTip);
  barre.appendChild(ctl.enregistrer);
  barre.appendChild(bouton(TXT.retour, function () {
    api.postMessage({
      type: 'retourArticle', modifie: estModifie(),
      ressources: aEnvoyer('fiche'), rubriques: aEnvoyer('rubrique')
    });
  }, '', TXT.retourTip));
  ctl.indic = texte(barre, 'span', 'szh-barre-indic');
  ctl.indic.setAttribute('aria-live', 'polite');
  ctl.etat = texte(barre, 'span', 'szh-barre-etat');
  ctl.etat.setAttribute('role', 'status');
}

function trouverFiche(id) {
  for (var i = 0; i < cartes.length; i++) {
    if (cartes[i].famille === 'fiche' && cartes[i].id === id) { return cartes[i]; }
  }
  return null;
}

// ---- Rendu ----------------------------------------------------------------------------
// Les rubriques d'abord : ouvrir la Documentation doit montrer la liste des rubriques,
// littéralement (demande du 02.09.2026). Les catégories de fiches ensuite.
// `typesRubrique` peut arriver vide — c'est le cas sur un article ordinaire, qui porte des
// fiches mais aucune rubrique : la page n'affiche alors que les catégories de fiches, sans
// une ligne de condition de plus.
function rendre(msg) {
  zoneSections.textContent = '';
  cartes = [];
  sections = [];
  TYPES = Array.isArray(msg.typesConfig) ? msg.typesConfig : [];
  TYPES_RUBRIQUE = Array.isArray(msg.typesRubrique) ? msg.typesRubrique : [];
  construireSommaire();

  var rubriques = Array.isArray(msg.rubriques) ? msg.rubriques : [];
  for (var i = 0; i < TYPES_RUBRIQUE.length; i++) {
    var type = TYPES_RUBRIQUE[i];
    // Un .md écrit à la main peut porter deux blocs du même type : le premier occupe la
    // rubrique, les autres restent dans le fichier sans être touchés (l'hôte ne réécrit que
    // les identifiants que cette page lui rend). Mieux vaut n'en montrer qu'un que d'ouvrir
    // une porte à un second, que le formulaire ne sait plus créer.
    var trouvee = null;
    for (var r = 0; r < rubriques.length; r++) {
      if (rubriques[r].type === type.valeur) { trouvee = rubriques[r]; break; }
    }
    construireRubrique(type, trouvee || { id: nouvelId(), type: type.valeur, contenu: '' }, !!trouvee);
  }

  var fiches = Array.isArray(msg.ressources) ? msg.ressources : [];
  for (var j = 0; j < TYPES.length; j++) { sections.push(construireSectionFiches(TYPES[j])); }
  for (var k = 0; k < fiches.length; k++) {
    var f = fiches[k];
    var section = sections.filter(function (s) { return s.type === f.type; })[0];
    if (!section) { continue; }                    // type inconnu de ce cockpit : ignoré
    var c = construireFiche(section, f, true);
    section.corps.insertBefore(c.element, section.ajouter);
  }
  dernierModifie = false;
  etat('');
  majSommaire();
  majModifie();
}

function enregistrer(auto) {
  var listeFiches = aEnvoyer('fiche');
  var listeRubriques = aEnvoyer('rubrique');
  // Une page sans une seule fiche écrivable et dont aucune rubrique ne porte de texte n'a
  // rien à écrire : le dire une fois vaut mieux qu'un enregistrement qui ne change rien.
  // La modification compte aussi, elle : une rubrique qu'on vient de vider n'a plus de
  // contenu, et c'est précisément ce vidage qu'il faut porter au .md.
  var quelqueChose = listeFiches.length > 0 || listeRubriques.some(function (r) {
    return String(r.contenu || '').trim() !== '';
  });
  if (!quelqueChose && !estModifie()) { if (!auto) { etat(TXT.rienAEcrire || ''); } return; }
  api.postMessage({
    type: 'enregistrer', auto: !!auto, ressources: listeFiches, rubriques: listeRubriques
  });
}
var autoEnr = SZH.autoEnregistrement({ delai: 0, estModifie: estModifie, enregistrer: enregistrer });

document.addEventListener('keydown', function (ev) {
  if (!(ev.ctrlKey || ev.metaKey)) { return; }
  if ((ev.key || '').toLowerCase() === 's') { ev.preventDefault(); enregistrer(false); }
});

var recu = false;
window.addEventListener('message', function (ev) {
  var msg = ev.data || {};
  recu = true;
  if (msg.type === 'charger') {
    SZH.poserAccent(msg.accent);
    if (msg.i18n) { TXT = msg.i18n; construireBarre(); }
    rendre(msg);
    return;
  }
  if (msg.type === 'enregistre') {
    autoEnr.confirme();
    for (var i = 0; i < cartes.length; i++) {
      var c = cartes[i];
      // Ce que l'hôte vient d'écrire est exactement ce que estEcrivable() lui a envoyé — et
      // pour une rubrique, seul un contenu non vide y a survécu : vidée, elle est SORTIE du
      // .md, donc plus persistée.
      var retenue = c.famille === 'rubrique' ? aQuelqueChose(c) : estEcrivable(c);
      c.persistee = retenue;
      c.enregistree = retenue ? valeurs(c) : null;
      if (!retenue) { c.touchee = false; }
      if (c.famille === 'fiche') { majGestesReserve(c); }
    }
    etat(msg.auto ? '' : (TXT.enregistre || ''));
    majModifie();
    return;
  }
  if (msg.type === 'erreur') { autoEnr.confirme(); etat('⚠ ' + msg.message); return; }
  if (msg.type === 'image-deposee' || msg.type === 'image-erreur') {
    var f = trouverFiche(msg.id);
    if (!f || !f.avecImage) { return; }              // type sans image : rien à y poser
    if (msg.type === 'image-deposee') {
      f.image = msg.image || '';
      f.apercu = msg.apercu || null;
      f.touchee = true;
      poserVignette(f);
      poserEtatDepot(f, TXT.imageDeposee || '', false);
      majEtatCarte(f);
      majModifie();
    } else {
      poserEtatDepot(f, '⚠ ' + (msg.message || '?'), true);
    }
    return;
  }
});
SZH.annoncerPret(api, function () { return recu; });
})();
