(function () {
'use strict';
// La Documentation d'un numéro — « Actualité et ressources » / « News & Ressourcen » — en un
// seul formulaire : les rubriques de texte riche (références du dossier, tour d'horizon…)
// puis les fiches structurées (livres, films, interventions parlementaires, agenda…).
//
// Depuis que la Documentation est une arborescence Kirby (lib/kirby-contenu.js), CHAQUE champ
// d'une fiche — y compris son titre — vient de `typesConfig[].champs`, dans l'ordre du
// contrat (pipeline/kirby/champs-documentation.json) : cette page ne connaît AUCUN nom de
// champ en dur, hormis `canton` (le seul dont dépend l'ordre d'un autre menu, voir
// rafraichirDependants) et les quatre sous-champs de `suivi` (date/genre/libelle/lien, eux
// aussi transmis par l'hôte, jamais supposés).
//
// Quatre partis de mise en page, inchangés depuis l'ancienne version :
//   1. Tout est pliable. Un seul accordéon ouvert à la fois dans toute la page.
//   2. Un sommaire collant à droite.
//   3. Rien d'incomplet n'est refusé — une pastille dit ce qui manque.
//   4. Rien ne dépasse d'une carte repliée.
//
// Identité d'une carte : un identifiant que cette page choisit à la création (nouvelId()).
// Une fiche neuve n'a pas encore d'Uuid Kirby — l'hôte le crée à l'écriture (kirby-contenu.js,
// ajouterFiche) et le renvoie dans `correspondances` (voir le protocole ci-dessous) : c'est
// alors, et alors seulement, que l'identifiant de la carte change pour devenir cet Uuid.
//
// Protocole. Vers l'hôte :
//   pret ; modifie { modifie } ; enregistrer { auto, ressources, rubriques } ;
//   retirer { famille: 'fiche', id } ; deposer-image { id, nomFichier, donneesBase64 } ;
//   detacher { id } ; envoyer { id } ; retourArticle { modifie, ressources, rubriques }
// où ressources = [{ id, type, valeurs }], valeurs = { <cle du contrat>: <chaîne ou tableau
// pour `structure`>, … }, et rubriques = [{ id, type, contenu }] — id et type valent tous
// deux la clé de la rubrique (dossier_references…), id étant celui d'une carte comme pour
// une fiche.
// Depuis l'hôte :
//   charger { slug, ressources, rubriques, typesConfig, typesRubrique, accent, i18n, limites } ;
//   enregistre { auto, correspondances: [{ avant, apres }] } ; erreur { message } ;
//   image-deposee { id, image, apercu } ; image-erreur { id, message }
// où une fiche reçue vaut { id, type, valeurs, apercu }, une rubrique { id, type, contenu },
// un type de typesConfig { valeur, libelleSection, libelleAjouter, libelleAjouterTip,
// avecImage, champFichier, champs: [{ cle, libelle, saisie, requis, quand?, options?,
// dependDe?, optionsParCanton?, structureChamps?, extensions?, depuis?, table? }] }.
var api = acquireVsCodeApi();
function imageDepot() {
  return Object.assign({ format: 'errFormat', poids: 'errTropVolumineuse' }, SZH.LIMITES.image);
}
var IMAGE = imageDepot();
var TXT = {}, ctl = {}, cartes = [], sections = [], TYPES = [], TYPES_RUBRIQUE = [];
var etatJeton = { jeton: null };
var dernierModifie = false;
var barre = document.getElementById('barre');
var zoneOnglets = document.getElementById('onglets');
var panelTraductions = document.getElementById('panel-traductions');
var panelReservoir = document.getElementById('panel-reservoir');
var panelNumero = document.getElementById('panel-numero');
var zoneSections = document.getElementById('sections');
var zoneSommaire = document.getElementById('sommaire');
var compteurId = 0;
var compteurIndex = 0;
// L'onglet ouvert : mémorisé pour la session du panneau (jamais réinitialisé par rendre(),
// rejoué à chaque charger()) — « Documentation du numéro » par défaut, comme demandé.
var ongletActif = 'numero';

function nouvelId() {
  compteurId += 1;
  return 'r' + Date.now().toString(36) + compteurId.toString(36) + Math.random().toString(36).slice(2, 6);
}

var bouton = SZH.bouton;
var boutonIcone = SZH.boutonIcone;
var texte = SZH.poser;
var ligne = SZH.ligne;
function remplir(cle, valeurs) { return SZH.remplir(TXT, cle, valeurs); }
function etat(msg) { SZH.poserEtat(ctl.etat, msg); }
function allerA(el) {
  try { if (el && typeof el.scrollIntoView === 'function') { el.scrollIntoView({ block: 'start' }); } }
  catch (e) { /* environnement sans mise en page (tests) */ }
}

// ---- Barre d'outils de texte riche (rubriques) — inchangée -----------------------------
function outilBouton(cls, libelle, titre, fn) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'szh-bouton doc-outil doc-outil--' + cls;
  b.textContent = libelle || '';
  if (titre) { b.title = titre; b.setAttribute('aria-label', titre); }
  b.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
  b.addEventListener('click', fn);
  return b;
}
function compterAstDebut(s) { var n = 0; while (n < s.length && s.charAt(n) === '*') { n++; } return n; }
function compterAstFin(s) { var n = 0; while (n < s.length - n && s.charAt(s.length - 1 - n) === '*') { n++; } return n; }
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
  if (avant + apres > sel.length) { var moitie = Math.floor(sel.length / 2); avant = moitie; apres = sel.length - moitie; }
  var texteNu = sel.slice(avant, sel.length - apres);
  var aBold = avant >= 2 && apres >= 2;
  var aItalique = (avant % 2 === 1) && (apres % 2 === 1);
  var nvBold = gras ? !aBold : aBold;
  var nvItalique = gras ? aItalique : !aItalique;
  var nv = texteNu;
  if (nvItalique) { nv = '*' + nv + '*'; }
  if (nvBold) { nv = '**' + nv + '**'; }
  var debutTexte = e.debut + (nvBold ? 2 : 0) + (nvItalique ? 1 : 0);
  return { valeur: valeur.slice(0, e.debut) + nv + valeur.slice(e.fin), debut: debutTexte, fin: debutTexte + texteNu.length };
}
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
  return { valeur: valeur.slice(0, debut) + nv + valeur.slice(fin), debut: urlDebut, fin: urlDebut + url.length };
}
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
  return { valeur: valeur.slice(0, debutLigne) + nvBloc + valeur.slice(finLigne), debut: debutLigne, fin: debutLigne + nvBloc.length };
}
var HAUTEUR_MAX = 480;
function ajusterHauteur(zone) {
  try {
    if (zone.dataset.hauteurTiree === '1') { return; }
    if (zone.dataset.hauteurPosee && zone.style.height && zone.style.height !== zone.dataset.hauteurPosee) {
      zone.dataset.hauteurTiree = '1'; zone.style.overflowY = 'auto'; return;
    }
    zone.style.height = 'auto';
    if (typeof zone.scrollHeight === 'number' && zone.scrollHeight > 0) {
      zone.style.height = Math.min(zone.scrollHeight, HAUTEUR_MAX) + 'px';
      zone.dataset.hauteurPosee = zone.style.height;
      zone.style.overflowY = zone.scrollHeight > HAUTEUR_MAX ? 'auto' : 'hidden';
    }
  } catch (e) { /* environnement sans mesure de disposition (tests) */ }
}
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

// ---- Valeurs, complétude, modification --------------------------------------------------
//
// La complétude reprend exactement la règle de kirby-contenu.js#champsManquants : un champ
// `requis` dont `quand` ne tient pas ne compte pas, `structure` est vide si aucune ligne
// n'a rien.
function valeurChamp(c, champCfg) {
  // `fichier` ne pose pas de contrôle dans c.ctl (la zone de dépôt n'est pas un champ de
  // texte) : sa valeur vit à part, dans c.image — voir champFichier() plus bas.
  if (champCfg.saisie === 'fichier') { return c.image || ''; }
  var ctlChamp = c.ctl[champCfg.cle];
  if (!ctlChamp) { return champCfg.saisie === 'structure' ? [] : ''; }
  if (champCfg.saisie === 'structure') { return lireStructure(ctlChamp); }
  if (champCfg.saisie === 'derive') { return ctlChamp.valeur || ''; }
  return ligne(ctlChamp.value);
}
function valeursFiche(c) {
  var v = {};
  for (var i = 0; i < c.champs.length; i++) { v[c.champs[i].cle] = valeurChamp(c, c.champs[i]); }
  return v;
}
function valeurs(c) {
  return c.famille === 'rubrique'
    ? { contenu: String(c.ctl.contenu.value || '').replace(/\r\n/g, '\n') }
    : valeursFiche(c);
}
function quandSatisfait(quand, v) {
  if (!quand) { return true; }
  return Object.keys(quand).every(function (cle) { return String(v[cle] || '') === String(quand[cle]); });
}
function champsManquants(c) {
  if (c.famille === 'rubrique') { return valeurs(c).contenu.trim() === '' ? ['contenu'] : []; }
  var v = valeursFiche(c);
  var manque = [];
  for (var i = 0; i < c.champs.length; i++) {
    var cfg = c.champs[i];
    if (!cfg.requis) { continue; }
    if (cfg.quand && !quandSatisfait(cfg.quand, v)) { continue; }
    var val = v[cfg.cle];
    var vide = cfg.saisie === 'structure' ? !(Array.isArray(val) && val.length > 0) : String(val || '').trim() === '';
    if (vide) { manque.push(cfg.cle); }
  }
  return manque;
}
// Ce qui suffit pour écrire une fiche : au moins un champ non vide (la pastille dit ce qui
// manque encore, ce n'est jamais un refus d'écrire).
function aQuelqueChose(c) {
  var v = valeurs(c);
  for (var cle in v) {
    if (!Object.prototype.hasOwnProperty.call(v, cle)) { continue; }
    var val = v[cle];
    if (Array.isArray(val)) { if (val.length > 0) { return true; } continue; }
    if (String(val || '').trim() !== '') { return true; }
  }
  return false;
}
function estEcrivable(c) { return c.famille === 'rubrique' || c.persistee || aQuelqueChose(c); }

function estModifieCarte(c) {
  if (!c.touchee) { return false; }
  if (!estEcrivable(c)) { return false; }
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
  if (m !== dernierModifie) { dernierModifie = m; api.postMessage({ type: SZH.MSG.MODIFIE, modifie: m }); }
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

// ---- La pastille d'état d'une carte -----------------------------------------------------
function majEtatCarte(c) {
  var manque = champsManquants(c);
  if (c.ctl.badge) {
    c.ctl.badge.hidden = manque.length === 0;
    if (manque.length > 0) {
      var libelles = manque.map(function (cle) {
        if (c.famille === 'rubrique') { return TXT.champContenu || cle; }
        var cfg = c.champs.filter(function (x) { return x.cle === cle; })[0];
        return (cfg && cfg.libelle) || cle;
      });
      c.ctl.badge.title = remplir('manque', [libelles.join(', ')]);
    } else {
      c.ctl.badge.title = '';
    }
  }
  majSommaire();
}

// ---- Visibilité conditionnelle (`quand`) et champs dépendants (instruments) ------------
function majConditionnels(c) {
  if (!c.conditionnels) { return; }
  var v = valeursFiche(c);
  for (var i = 0; i < c.conditionnels.length; i++) {
    var cd = c.conditionnels[i];
    cd.conteneur.hidden = !quandSatisfait(cd.quand, v);
  }
}
// Le menu des instruments d'une intervention : quand le canton change, ses options
// reviennent recomposées (celles qui l'observent en tête), la valeur choisie conservée si
// elle existe encore dans le nouveau jeu.
function rafraichirDependants(c, cleChangee) {
  if (!c.dependants) { return; }
  for (var i = 0; i < c.dependants.length; i++) {
    var d = c.dependants[i];
    if (d.dependDe !== cleChangee) { continue; }
    var sel = c.ctl[d.cle];
    if (!sel) { continue; }
    var valeurActuelle = sel.value;
    var canton = String(c.ctl[d.dependDe] ? c.ctl[d.dependDe].value : '');
    var options = d.optionsParCanton[canton] || d.optionsParCanton[''] || [];
    poserOptions(sel, options, valeurActuelle);
  }
}
// Les valeurs `derive` (curia…) affichées en lecture seule, recalculées depuis le champ
// dont elles dépendent — jamais saisies, voir kirby-contenu.js#valeurDerive.
function majDerives(c) {
  if (!c.derives) { return; }
  for (var i = 0; i < c.derives.length; i++) {
    var d = c.derives[i];
    var source = c.ctl[d.depuis] ? String(c.ctl[d.depuis].value || '') : '';
    var val = (d.table || {})[source] || '';
    d.affichage.textContent = val;
    d.valeur = val;
  }
}

// ---- Un champ : texte, texte_long, url, date, date_partielle, annee, liste, derive,
//      structure, fichier — tout vient de champCfg, rien n'est un nom de champ en dur -----
function poserOptions(sel, options, valeurGardee) {
  var courant = valeurGardee !== undefined ? valeurGardee : sel.value;
  sel.textContent = '';
  var vide = document.createElement('option');
  vide.value = '';
  vide.textContent = TXT.optionVide || '–';
  sel.appendChild(vide);
  var connue = courant === '';
  for (var i = 0; i < options.length; i++) {
    var o = document.createElement('option');
    o.value = String(options[i].valeur || '');
    o.textContent = String(options[i].libelle || options[i].valeur || '');
    sel.appendChild(o);
    if (o.value === courant) { connue = true; }
  }
  if (!connue && courant !== '') {
    var extra = document.createElement('option');
    extra.value = courant;
    extra.textContent = courant;
    sel.appendChild(extra);
  }
  sel.value = courant;
}

function lireStructure(ctlChamp) {
  return ctlChamp.lignes.map(function (ligneCtl) {
    var o = {};
    ctlChamp.sousChamps.forEach(function (sc) { o[sc.cle] = ligne(ligneCtl[sc.cle].value); });
    return o;
  }).filter(function (o) {
    return ctlChamp.sousChamps.some(function (sc) { return o[sc.cle] !== ''; });
  });
}

function champStructure(parent, c, champCfg, valeursInitiales) {
  var d = texte(parent, 'div', 'szh-champ doc-champ-structure');
  texte(d, 'span', 'doc-structure-label', champCfg.libelle || '');
  var zoneLignes = texte(d, 'div', 'doc-structure-lignes');
  var ctlChamp = { conteneur: zoneLignes, lignes: [], sousChamps: champCfg.structureChamps || [] };
  c.ctl[champCfg.cle] = ctlChamp;

  function surChangementLigne() {
    c.touchee = true; etat(''); majEtatCarte(c); majModifie();
  }
  function ajouterLigne(valeurs0) {
    var row = texte(zoneLignes, 'div', 'doc-structure-ligne');
    var ligneCtl = {};
    for (var i = 0; i < ctlChamp.sousChamps.length; i++) {
      var sc = ctlChamp.sousChamps[i];
      var sousDiv = texte(row, 'div', 'doc-structure-souschamp');
      var idSous = 'sc-' + champCfg.cle + '-' + sc.cle + '-' + (++compteurIndex);
      var lab = texte(sousDiv, 'label', null, sc.libelle || '');
      lab.setAttribute('for', idSous);
      var valeurInitiale = String((valeurs0 || {})[sc.cle] || '');
      var input;
      if (sc.saisie === 'liste' && sc.options) {
        input = document.createElement('select');
        poserOptions(input, sc.options, valeurInitiale);
        input.addEventListener('change', surChangementLigne);
      } else {
        input = document.createElement('input');
        input.type = sc.saisie === 'date' ? 'date' : (sc.saisie === 'url' ? 'url' : 'text');
        input.maxLength = 300;
        input.value = valeurInitiale;
        input.addEventListener('input', surChangementLigne);
      }
      input.id = idSous;
      sousDiv.appendChild(input);
      ligneCtl[sc.cle] = input;
    }
    row.appendChild(boutonIcone('poubelle', TXT.retirerLigneTip || '', function () {
      row.remove();
      var idx = ctlChamp.lignes.indexOf(ligneCtl);
      if (idx !== -1) { ctlChamp.lignes.splice(idx, 1); }
      surChangementLigne();
    }, 'szh-ico--danger'));
    ctlChamp.lignes.push(ligneCtl);
  }
  for (var i = 0; i < (valeursInitiales || []).length; i++) { ajouterLigne(valeursInitiales[i]); }
  d.appendChild(bouton(TXT.ajouterLigne || '+', function () { ajouterLigne({}); surChangementLigne(); },
    'doc-structure-ajouter', TXT.ajouterLigneTip || ''));
  return d;
}

function champDerive(parent, c, champCfg) {
  var d = texte(parent, 'div', 'szh-champ doc-champ-derive');
  texte(d, 'span', null, champCfg.libelle || '');
  var affichage = texte(d, 'span', 'doc-derive-valeur', '');
  var obj = { affichage: affichage, depuis: champCfg.depuis, table: champCfg.table || {}, valeur: '' };
  c.ctl[champCfg.cle] = obj;
  c.derives = c.derives || [];
  c.derives.push(obj);
  return d;
}

function champFichier(parent, c, champCfg) {
  var zone = texte(parent, 'div', 'doc-image');
  var vignette = texte(zone, 'div', 'doc-vignette');
  c.ctl.vignette = vignette;
  c.avecImage = true;
  c.champFichier = champCfg.cle;
  var d = SZH.construireDepot({
    parent: zone, extensions: champCfg.extensions || IMAGE.extensions, texteChoisir: TXT.choisirFichier || '',
    surFichier: function (f) { envoyerImage(c, f); }
  });
  c.ctl.depotEtat = d.etat;
  poserVignette(c);
  return zone;
}

function champOrdinaire(parent, c, champCfg) {
  var d = texte(parent, 'div', 'szh-champ');
  var id = 'ch-' + champCfg.cle + '-' + c.index;
  var l = texte(d, 'label', null, champCfg.libelle || '');
  l.setAttribute('for', id);
  var i;
  var surChangement = function () {
    c.touchee = true;
    etat('');
    majEtatCarte(c);
    majConditionnels(c);
    majDerives(c);
    rafraichirDependants(c, champCfg.cle);
    majModifie();
  };
  if (champCfg.saisie === 'liste') {
    i = document.createElement('select');
    poserOptions(i, champCfg.options || [], '');
    if (champCfg.dependDe) {
      c.dependants = c.dependants || [];
      c.dependants.push({ cle: champCfg.cle, dependDe: champCfg.dependDe, optionsParCanton: champCfg.optionsParCanton || {} });
    }
    i.addEventListener('change', surChangement);
  } else if (champCfg.saisie === 'texte_long') {
    i = document.createElement('textarea');
    i.rows = 3;
    i.maxLength = 4000;
    i.addEventListener('input', surChangement);
  } else {
    i = document.createElement('input');
    i.maxLength = champCfg.saisie === 'annee' ? 4 : 300;
    if (champCfg.saisie === 'date') { i.type = 'date'; }
    else if (champCfg.saisie === 'url') { i.type = 'url'; }
    else if (champCfg.saisie === 'annee') { i.type = 'text'; i.inputMode = 'numeric'; i.pattern = '\\d{4}'; i.placeholder = 'AAAA'; }
    else if (champCfg.saisie === 'date_partielle') { i.type = 'text'; i.pattern = '\\d{4}(-\\d{2}(-\\d{2})?)?'; i.placeholder = 'AAAA[-MM[-JJ]]'; }
    else { i.type = 'text'; }
    i.addEventListener('input', surChangement);
  }
  i.id = id;
  d.appendChild(i);
  c.ctl[champCfg.cle] = i;
  return d;
}

// Un champ visible seulement si `quand` est satisfait : la carte suit dès la construction,
// et à chaque changement (majConditionnels ci-dessus).
function champ(parent, c, champCfg, valeursInitiales) {
  var conteneur;
  if (champCfg.saisie === 'structure') { conteneur = champStructure(parent, c, champCfg, valeursInitiales && valeursInitiales[champCfg.cle]); }
  else if (champCfg.saisie === 'derive') { conteneur = champDerive(parent, c, champCfg); }
  else if (champCfg.saisie === 'fichier') { conteneur = champFichier(parent, c, champCfg); }
  else { conteneur = champOrdinaire(parent, c, champCfg); }
  if (champCfg.saisie !== 'fichier' && valeursInitiales) {
    var v0 = valeursInitiales[champCfg.cle];
    if (champCfg.saisie === 'liste') { poserOptions(c.ctl[champCfg.cle], champCfg.options || [], String(v0 || '')); }
    else if (champCfg.saisie === 'structure' || champCfg.saisie === 'derive') { /* déjà posées */ }
    else { c.ctl[champCfg.cle].value = String(v0 || ''); }
  }
  if (champCfg.quand) {
    c.conditionnels = c.conditionnels || [];
    c.conditionnels.push({ conteneur: conteneur, quand: champCfg.quand });
  }
  return conteneur;
}

// ---- L'image de couverture, toujours décorative --------------------------------------
function poserVignette(c) {
  var zone = c.ctl.vignette;
  if (!zone) { return; }
  zone.textContent = '';
  if (!c.apercu) { texte(zone, 'p', 'absent', TXT.imageAbsente || ''); return; }
  var img = document.createElement('img');
  img.src = c.apercu;
  img.alt = '';
  zone.appendChild(img);
}
function poserEtatDepot(c, message, erreur) {
  var e = c.ctl.depotEtat;
  if (!e) { return; }
  e.textContent = message || '';
  e.className = 'szh-depot-etat' + (erreur ? ' erreur' : '');
}
function envoyerImage(c, f) {
  SZH.lireBase64(f, {
    extensions: IMAGE.extensions, maxi: IMAGE.maxi,
    msgFormat: '⚠ ' + (TXT[IMAGE.format] || ''), msgPoids: '⚠ ' + (TXT[IMAGE.poids] || ''),
    surLecture: function () { poserEtatDepot(c, '…'); },
    surErreur: function (message) { poserEtatDepot(c, message, true); },
    surDonnees: function (fichier, base64) {
      api.postMessage({ type: SZH.MSG.DEPOSER_IMAGE, id: c.id, nomFichier: fichier.name, donneesBase64: base64 });
    }
  });
}

// ---- Accordéon : un seul ouvert dans toute la page -----------------------------------
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
function basculerCarte(c) { ouvrirCarte(c, !!(c.ctl.corps && c.ctl.corps.hidden)); }

function titreDeCarte(c) {
  var ctlTitre = c.ctl.title;
  if (!ctlTitre || typeof ctlTitre.value !== 'string') { return ''; }
  return ligne(ctlTitre.value);
}
function majTitreBascule(c) {
  if (!c.ctl.libelle) { return; }
  if (c.famille === 'rubrique') { return; }
  var t = titreDeCarte(c);
  if (t === '') { t = TXT.sansTitre || '–'; }
  c.ctl.libelle.textContent = String(c.position || 1) + ' · ' + t;
}
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
function construireFiche(section, ressource, persistee) {
  var c = {
    famille: 'fiche', id: ressource.id, type: section.type, index: ++compteurIndex, ctl: {},
    champs: section.champs, avecImage: false,
    image: (ressource.valeurs || {})[section.champFichier] || '', apercu: ressource.apercu || null,
    persistee: !!persistee, touchee: false, enregistree: null
  };
  var s = document.createElement('section');
  s.className = 'szh-carte doc-carte doc-fiche';
  c.element = s;

  var tete = construireTete(c, s, 'doc-tete');
  // Retirer du numéro = rendre orpheline (l'hôte vide Ausgabe, jamais un effacement) : la
  // fiche reste dans la bibliothèque, disponible depuis « Mes orphelines ». Une carte neuve,
  // jamais enregistrée, se retire simplement du DOM (voir retirerFiche).
  c.ctl.retirer = boutonIcone('bas', TXT.retirerTip || '', function () { retirerFiche(c); });
  tete.appendChild(c.ctl.retirer);

  var corps = texte(s, 'div', 'doc-corps');
  corps.hidden = true;
  c.ctl.corps = corps;

  var v = ressource.valeurs || {};
  for (var i = 0; i < c.champs.length; i++) { champ(corps, c, c.champs[i], v); }

  majConditionnels(c);
  majDerives(c);
  c.enregistree = c.persistee ? valeurs(c) : null;

  cartes.push(c);
  if (c.ctl.title) { c.ctl.title.addEventListener('input', function () { majTitreBascule(c); }); }
  majEtatCarte(c);
  majPositions();
  return c;
}
var retraitsFicheEnAttente = 0;
function retirerFiche(c) {
  c.element.remove();
  cartes = cartes.filter(function (x) { return x !== c; });
  if (c.persistee) {
    retraitsFicheEnAttente++;
    api.postMessage({ type: SZH.MSG.RETIRER, famille: 'fiche', id: c.id });
  }
  majPositions();
  majSommaire();
  majModifie();
}

// ---- Une rubrique : un bloc, un seul, toujours là -------------------------------------
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
    c.touchee = true; ajusterHauteur(zone); etat(''); majEtatCarte(c); majModifie();
  });
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
  c.touchee = true;
  majEtatCarte(c);
  majModifie();
}

// ---- Une catégorie de fiches ----------------------------------------------------------
function construireSectionFiches(type) {
  var s = {
    famille: 'fiche', type: type.valeur, libelleSection: type.libelleSection || type.valeur,
    champs: type.champs || [], champFichier: type.champFichier || null
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
    ouvrirCarte(c, true);
    majSommaire();
    try { if (c.ctl.title) { c.ctl.title.focus(); } } catch (e) { /* pas focalisable */ }
  }, 'szh-bouton--principal doc-ajouter', type.libelleAjouterTip || '');
  conteneur.appendChild(s.ajouter);
  return s;
}

// ---- Le sommaire collant --------------------------------------------------------------
function compteCartes(famille, type) {
  var n = 0;
  for (var i = 0; i < cartes.length; i++) { if (cartes[i].famille === famille && cartes[i].type === type) { n++; } }
  return n;
}
function carteRubrique(type) {
  for (var i = 0; i < cartes.length; i++) { if (cartes[i].famille === 'rubrique' && cartes[i].type === type) { return cartes[i]; } }
  return null;
}
function construireSommaire() {
  zoneSommaire.textContent = '';
  var titre = texte(zoneSommaire, 'p', 'doc-sommaire-titre', TXT.sommaire || '');
  titre.id = 'doc-sommaire-titre';
  zoneSommaire.setAttribute('aria-labelledby', titre.id);
  ctl.sommaireEntrees = [];
  var liste = texte(zoneSommaire, 'ul', 'doc-sommaire-liste');
  var groupe = function (libelle) { if (libelle) { texte(liste, 'li', 'doc-sommaire-groupe', libelle); } };
  var entree = function (famille, type, libelle) {
    var li = texte(liste, 'li', 'doc-sommaire-item');
    var b = texte(li, 'button', 'doc-sommaire-lien');
    b.type = 'button';
    texte(b, 'span', 'doc-sommaire-nom', libelle);
    var marque = texte(b, 'span', 'doc-sommaire-marque');
    b.addEventListener('click', function () {
      var cible = document.getElementById((famille === 'rubrique' ? 'sec-r-' : 'sec-f-') + type);
      if (famille === 'rubrique') { var c = carteRubrique(type); if (c) { ouvrirCarte(c, true); } }
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
    for (var j = 0; j < TYPES.length; j++) { entree('fiche', TYPES[j].valeur, TYPES[j].libelleSection || TYPES[j].valeur); }
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
  ctl = SZH.construireBarre(barre, {
    txt: TXT,
    onEnregistrer: function () { enregistrer(false); },
    onRetour: function () {
      api.postMessage({
        type: SZH.MSG.RETOUR_ARTICLE, modifie: estModifie(),
        ressources: aEnvoyer('fiche'), rubriques: aEnvoyer('rubrique')
      });
    }
  });
}
function trouverFiche(id) {
  for (var i = 0; i < cartes.length; i++) { if (cartes[i].famille === 'fiche' && cartes[i].id === id) { return cartes[i]; } }
  return null;
}

// ---- Onglets : Traductions à faire | Réservoir | Documentation du numéro --------------
//
// Trois onglets, dans cet ordre — Robin a demandé des onglets, pas des sections empilées
// (23.09.2026). « Mes orphelines » est une PARTIE de l'onglet Réservoir, pas un onglet à
// part. « Documentation du numéro » (rubriques + fiches rattachées, l'ancien contenu de
// cette page) est ouvert par défaut ; les deux autres portent un compteur du nombre
// d'éléments en attente. L'onglet choisi est mémorisé pour la session du panneau — rien ne
// réinitialise `ongletActif`, y compris un rechargement complet (rendre() le relit sans le
// changer).
//
// Chaque ligne d'une liste montre le type et le titre (tels qu'écrits dans l'AUTRE langue —
// jamais traduits ici) et un ou deux gestes, envoyés à l'hôte par leur `slug` (fiche) ou
// leur `uuid` (décision de statut, indépendante du numéro).
function ligneVue(parent, libelleType, titre) {
  var l = texte(parent, 'div', 'doc-vue-ligne');
  texte(l, 'span', 'doc-vue-type', libelleType || '');
  texte(l, 'span', 'doc-vue-titre', titre || TXT.sansTitre || '');
  return l;
}
function construireTraductions(parent, traductions) {
  parent.textContent = '';
  var liste = texte(parent, 'div', 'doc-vue-liste');
  if (traductions.length === 0) { texte(liste, 'p', 'doc-vue-vide', TXT.traductionsVide || ''); return; }
  traductions.forEach(function (t) {
    var l = ligneVue(liste, t.typeLibelle, t.titre);
    if (t.origine) { texte(l, 'span', 'doc-vue-origine', t.origine); }
    l.appendChild(bouton(TXT.traduireDansNumero || '', function () {
      api.postMessage({ type: SZH.MSG.TRADUIRE_DANS_NUMERO, slug: t.slug });
    }, 'doc-vue-bouton', TXT.traduireDansNumeroTip || ''));
  });
}
function construireOrphelines(parent, orphelines) {
  var s = texte(parent, 'section', 'doc-vue-orphelines');
  texte(s, 'h3', 'doc-vue-titre-section', TXT.orphelinesTitre || '');
  var liste = texte(s, 'div', 'doc-vue-liste');
  if (orphelines.length === 0) { texte(liste, 'p', 'doc-vue-vide', TXT.orphelinesVide || ''); return; }
  orphelines.forEach(function (o) {
    var l = ligneVue(liste, o.typeLibelle, o.titre);
    l.appendChild(bouton(TXT.tirerDansNumero || '', function () {
      api.postMessage({ type: SZH.MSG.TIRER_DANS_NUMERO, slug: o.slug });
    }, 'doc-vue-bouton', TXT.tirerDansNumeroTip || ''));
    l.appendChild(boutonIcone('poubelle', TXT.supprimerTip || '', function () {
      api.postMessage({ type: SZH.MSG.SUPPRIMER, slug: o.slug });
    }, 'szh-ico--danger'));
  });
}
function construireReservoir(parent, msg) {
  parent.textContent = '';
  var numeros = Array.isArray(msg.reservoirNumeros) ? msg.reservoirNumeros : [];
  var actifs = {};
  if (numeros.length > 0) {
    var filtre = texte(parent, 'div', 'doc-reservoir-filtre');
    texte(filtre, 'span', 'doc-reservoir-filtre-label', TXT.reservoirFiltre || '');
    numeros.forEach(function (n) {
      var lab = texte(filtre, 'label', 'doc-reservoir-case');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', function () { actifs[n.id] = cb.checked; rendreListe(); });
      lab.appendChild(cb);
      texte(lab, 'span', null, n.nom);
    });
  }
  var toggle = texte(parent, 'label', 'doc-reservoir-case doc-reservoir-toggle');
  var toggleCb = document.createElement('input');
  toggleCb.type = 'checkbox';
  toggle.appendChild(toggleCb);
  texte(toggle, 'span', null, TXT.reservoirAfficherIgnorees || '');

  // ---- Sélection multiple : une case par ligne, « Tout sélectionner » (sur les lignes
  // visibles après filtre), une barre d'actions en lot — À traduire / Ignorer d'un côté,
  // Annuler la décision de l'autre (même bascule que les boutons par ligne, jamais les deux
  // jeux en même temps). Un seul message par geste en lot, un tableau d'uuid.
  var selectionnes = new Set();
  var visiblesCourantes = [];

  var barreLot = texte(parent, 'div', 'doc-reservoir-lot');
  var labelTout = texte(barreLot, 'label', 'doc-reservoir-case');
  var caseTout = document.createElement('input');
  caseTout.type = 'checkbox';
  caseTout.className = 'doc-reservoir-case-tout';
  labelTout.appendChild(caseTout);
  texte(labelTout, 'span', null, TXT.reservoirToutSelectionner || '');
  var boutonsLot = texte(barreLot, 'div', 'doc-reservoir-lot-boutons');
  var boutonLotATraduire = bouton(TXT.reservoirATraduire || '', function () {
    api.postMessage({ type: SZH.MSG.MARQUER_A_TRADUIRE, uuids: Array.from(selectionnes) });
  }, 'doc-vue-bouton', TXT.reservoirATraduireTip || '');
  var boutonLotIgnorer = bouton(TXT.reservoirIgnorer || '', function () {
    api.postMessage({ type: SZH.MSG.IGNORER_TRADUCTION, uuids: Array.from(selectionnes) });
  }, 'doc-vue-bouton', TXT.reservoirIgnorerTip || '');
  var boutonLotAnnuler = bouton(TXT.reservoirAnnuler || '', function () {
    api.postMessage({ type: SZH.MSG.ANNULER_DECISION, uuids: Array.from(selectionnes) });
  }, 'doc-vue-bouton', TXT.reservoirAnnulerTip || '');
  boutonsLot.appendChild(boutonLotATraduire);
  boutonsLot.appendChild(boutonLotIgnorer);
  boutonsLot.appendChild(boutonLotAnnuler);

  function libelleCompte(base, n) { return (base || '') + ' (' + n + ')'; }
  function majBarreLot() {
    var n = selectionnes.size;
    boutonLotATraduire.hidden = toggleCb.checked;
    boutonLotIgnorer.hidden = toggleCb.checked;
    boutonLotAnnuler.hidden = !toggleCb.checked;
    boutonLotATraduire.disabled = n === 0;
    boutonLotIgnorer.disabled = n === 0;
    boutonLotAnnuler.disabled = n === 0;
    boutonLotATraduire.textContent = libelleCompte(TXT.reservoirATraduire, n);
    boutonLotIgnorer.textContent = libelleCompte(TXT.reservoirIgnorer, n);
    boutonLotAnnuler.textContent = libelleCompte(TXT.reservoirAnnuler, n);
    var visiblesAvecUuid = visiblesCourantes.filter(function (r) { return !!r.uuid; });
    caseTout.checked = visiblesAvecUuid.length > 0
      && visiblesAvecUuid.every(function (r) { return selectionnes.has(r.uuid); });
    caseTout.disabled = visiblesAvecUuid.length === 0;
  }
  caseTout.addEventListener('change', function () {
    visiblesCourantes.forEach(function (r) {
      if (!r.uuid) { return; }
      if (caseTout.checked) { selectionnes.add(r.uuid); } else { selectionnes.delete(r.uuid); }
    });
    rendreListe();
  });

  var liste = texte(parent, 'div', 'doc-vue-liste');
  var entrees = Array.isArray(msg.reservoir) ? msg.reservoir : [];

  function rendreListe() {
    liste.textContent = '';
    var choisis = Object.keys(actifs).filter(function (id) { return actifs[id]; });
    var visibles = entrees.filter(function (r) { return choisis.length === 0 || choisis.indexOf(r.ausgabeSource) !== -1; });
    visiblesCourantes = visibles;
    // Une ligne qui sort du filtre ne doit pas rester sélectionnée en silence.
    var visiblesUuid = new Set(visibles.map(function (r) { return r.uuid; }));
    selectionnes.forEach(function (u) { if (!visiblesUuid.has(u)) { selectionnes.delete(u); } });
    if (visibles.length === 0) { texte(liste, 'p', 'doc-vue-vide', TXT.reservoirVide || ''); majBarreLot(); return; }
    visibles.forEach(function (r) {
      var l = ligneVue(liste, r.typeLibelle, r.titre);
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'doc-vue-case';
      cb.checked = selectionnes.has(r.uuid);
      cb.addEventListener('change', function () {
        if (cb.checked) { selectionnes.add(r.uuid); } else { selectionnes.delete(r.uuid); }
        majBarreLot();
      });
      l.insertBefore(cb, l.firstChild);
      if (toggleCb.checked) {
        l.appendChild(bouton(TXT.reservoirAnnuler || '', function () {
          api.postMessage({ type: SZH.MSG.ANNULER_DECISION, uuid: r.uuid });
        }, 'doc-vue-bouton', TXT.reservoirAnnulerTip || ''));
      } else {
        l.appendChild(bouton(TXT.reservoirATraduire || '', function () {
          api.postMessage({ type: SZH.MSG.MARQUER_A_TRADUIRE, uuid: r.uuid });
        }, 'doc-vue-bouton', TXT.reservoirATraduireTip || ''));
        l.appendChild(bouton(TXT.reservoirIgnorer || '', function () {
          api.postMessage({ type: SZH.MSG.IGNORER_TRADUCTION, uuid: r.uuid });
        }, 'doc-vue-bouton', TXT.reservoirIgnorerTip || ''));
      }
    });
    majBarreLot();
  }
  toggleCb.addEventListener('change', function () {
    selectionnes.clear();
    api.postMessage({ type: SZH.MSG.RESERVOIR_FILTRE, avecIgnorees: toggleCb.checked });
  });
  rendreListe();

  // Réponse ciblée de l'hôte à RESERVOIR_FILTRE (voir le message « reservoir » plus bas) :
  // seule cette liste se remet à jour, jamais tout le formulaire.
  ctl.reservoirMaj = function (avecIgnorees, nouvellesEntrees) {
    toggleCb.checked = avecIgnorees;
    entrees = nouvellesEntrees;
    rendreListe();
  };

  // « Mes orphelines » est une PARTIE de l'onglet Réservoir, pas un onglet à part.
  construireOrphelines(parent, Array.isArray(msg.orphelines) ? msg.orphelines : []);
}

// La barre d'onglets, avec un compteur sur les deux onglets qui ne sont pas ouverts par
// défaut — le nombre d'éléments en attente de décision sur chacun.
function construireOnglets(msg) {
  zoneOnglets.textContent = '';
  var nTraductions = Array.isArray(msg.traductions) ? msg.traductions.length : 0;
  var nReservoir = (Array.isArray(msg.reservoir) ? msg.reservoir.length : 0)
    + (Array.isArray(msg.orphelines) ? msg.orphelines.length : 0);
  var defs = [
    { cle: 'traductions', libelle: TXT.ongletTraductions || '', compte: nTraductions },
    { cle: 'reservoir', libelle: TXT.ongletReservoir || '', compte: nReservoir },
    { cle: 'numero', libelle: TXT.ongletNumero || '', compte: 0 }
  ];
  ctl.onglets = {};
  defs.forEach(function (d) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'doc-onglet';
    b.setAttribute('role', 'tab');
    texte(b, 'span', 'doc-onglet-libelle', d.libelle);
    if (d.compte > 0) { texte(b, 'span', 'doc-onglet-compte', String(d.compte)); }
    b.addEventListener('click', function () { ongletActif = d.cle; appliquerOnglet(); });
    zoneOnglets.appendChild(b);
    ctl.onglets[d.cle] = b;
  });
  appliquerOnglet();
}
// Bascule la visibilité des trois panneaux et l'état visuel des onglets, sans rien
// reconstruire — appelée après chaque rendre() et à chaque clic d'onglet.
function appliquerOnglet() {
  panelTraductions.hidden = ongletActif !== 'traductions';
  panelReservoir.hidden = ongletActif !== 'reservoir';
  panelNumero.hidden = ongletActif !== 'numero';
  // Le sommaire ne décrit que « Documentation du numéro » (rubriques + fiches) : il n'a rien
  // à dire sur les deux autres onglets.
  zoneSommaire.hidden = ongletActif !== 'numero';
  for (var cle in ctl.onglets) {
    if (!Object.prototype.hasOwnProperty.call(ctl.onglets, cle)) { continue; }
    var actif = cle === ongletActif;
    ctl.onglets[cle].classList.toggle('doc-onglet--actif', actif);
    ctl.onglets[cle].setAttribute('aria-selected', actif ? 'true' : 'false');
  }
}

function rendre(msg) {
  zoneSections.textContent = '';
  cartes = [];
  sections = [];
  construireOnglets(msg);
  construireTraductions(panelTraductions, Array.isArray(msg.traductions) ? msg.traductions : []);
  construireReservoir(panelReservoir, msg);
  TYPES = Array.isArray(msg.typesConfig) ? msg.typesConfig : [];
  TYPES_RUBRIQUE = Array.isArray(msg.typesRubrique) ? msg.typesRubrique : [];
  construireSommaire();

  var rubriques = Array.isArray(msg.rubriques) ? msg.rubriques : [];
  for (var i = 0; i < TYPES_RUBRIQUE.length; i++) {
    var type = TYPES_RUBRIQUE[i];
    var trouvee = null;
    for (var r = 0; r < rubriques.length; r++) { if (rubriques[r].type === type.valeur) { trouvee = rubriques[r]; break; } }
    construireRubrique(type, trouvee || { id: type.valeur, type: type.valeur, contenu: '' }, true);
  }

  var fiches = Array.isArray(msg.ressources) ? msg.ressources : [];
  for (var j = 0; j < TYPES.length; j++) { sections.push(construireSectionFiches(TYPES[j])); }
  for (var k = 0; k < fiches.length; k++) {
    var f = fiches[k];
    var section = sections.filter(function (s) { return s.type === f.type; })[0];
    if (!section) { continue; }
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
  var quelqueChose = listeFiches.length > 0 || listeRubriques.some(function (r) { return String(r.contenu || '').trim() !== ''; });
  if (!quelqueChose && !estModifie()) { if (!auto) { etat(TXT.rienAEcrire || ''); } return; }
  api.postMessage({ type: SZH.MSG.ENREGISTRER, auto: !!auto, ressources: listeFiches, rubriques: listeRubriques });
}
var autoEnr = SZH.autoEnregistrement({ delai: 0, estModifie: estModifie, enregistrer: enregistrer });

document.addEventListener('keydown', function (ev) {
  if (!(ev.ctrlKey || ev.metaKey)) { return; }
  if ((ev.key || '').toLowerCase() === 's') { ev.preventDefault(); enregistrer(false); }
});

// Une fiche neuve reçoit son Uuid Kirby à l'écriture : `correspondances` fait passer
// l'identifiant provisoire de la carte à cet Uuid, sans quoi un second enregistrement la
// prendrait pour une fiche neuve de plus.
function appliquerCorrespondances(correspondances) {
  for (var i = 0; i < (correspondances || []).length; i++) {
    var f = trouverFiche(correspondances[i].avant);
    if (f) { f.id = correspondances[i].apres; }
  }
}

var recu = false;
window.addEventListener('message', function (ev) {
  var msg = ev.data || {};
  recu = true;
  if (msg.type === SZH.MSG.CHARGER) {
    if (SZH.jetonDejaTraite(etatJeton, msg)) { return; }
    SZH.poserAccent(msg.accent);
    SZH.appliquerLimites(msg.limites);
    IMAGE = imageDepot();
    if (msg.i18n) { TXT = msg.i18n; construireBarre(); }
    rendre(msg);
    return;
  }
  if (msg.type === SZH.MSG.ENREGISTRE) {
    autoEnr.confirme();
    appliquerCorrespondances(msg.correspondances);
    for (var i = 0; i < cartes.length; i++) {
      var c = cartes[i];
      var retenue = c.famille === 'rubrique' ? true : estEcrivable(c);
      c.persistee = retenue;
      c.enregistree = retenue ? valeurs(c) : null;
      if (!retenue) { c.touchee = false; }
    }
    etat(msg.auto ? '' : (TXT.enregistre || ''));
    majModifie();
    return;
  }
  if (msg.type === SZH.MSG.ERREUR) {
    autoEnr.confirme();
    etat('⚠ ' + msg.message);
    if (retraitsFicheEnAttente > 0) { retraitsFicheEnAttente--; api.postMessage({ type: SZH.MSG.PRET }); }
    return;
  }
  if (msg.type === SZH.MSG.IMAGE_DEPOSEE || msg.type === SZH.MSG.IMAGE_ERREUR) {
    var f = trouverFiche(msg.id);
    if (!f || !f.avecImage) { return; }
    if (msg.type === SZH.MSG.IMAGE_DEPOSEE) {
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
  // Réponse ciblée à RESERVOIR_FILTRE (l'interrupteur « afficher les ignorées ») : ne
  // reconstruit que la liste du réservoir, jamais tout le formulaire.
  if (msg.type === 'reservoir') {
    if (ctl.reservoirMaj) { ctl.reservoirMaj(!!msg.avecIgnorees, Array.isArray(msg.entrees) ? msg.entrees : []); }
    return;
  }
  console.warn('documentation : type de message inconnu', msg.type);
});
SZH.annoncerPret(api, function () { return recu; });
})();
