(function () {
'use strict';
// La Documentation d'un numéro (« Actualité et ressources » / « News & Ressourcen ») : les
// rubriques de texte riche (références du dossier, tour d'horizon…) puis les fiches
// structurées (livres, films, interventions parlementaires, agenda…).
//
// La Documentation est une arborescence Kirby (lib/kirby-contenu.js). Chaque champ d'une
// fiche, titre compris, vient de `typesConfig[].champs`, dans l'ordre du contrat
// (pipeline/kirby/champs-documentation.json). Seuls noms de champs connus ici : `canton`
// (dont dépend l'ordre d'un autre menu, voir rafraichirDependants) et les quatre sous-champs
// de `suivi` (date/genre/libelle/lien, transmis par l'hôte). Les champs se construisent dans
// _fiche-doc.js, que le détail d'une proposition emploie aussi.
//
// Mise en page :
//   1. Tout est pliable. Un seul accordéon ouvert à la fois dans toute la page.
//   2. Rien d'incomplet n'est refusé : une pastille dit ce qui manque.
//   3. Rien ne dépasse d'une carte repliée.
//
// Identité d'une carte : un identifiant choisi à la création (nouvelId()). Une fiche neuve
// n'a pas encore d'Uuid Kirby : l'hôte le crée à l'écriture (ajouterFiche,
// kirby-contenu.js) et le renvoie dans `correspondances` ; l'identifiant de la carte devient
// alors cet Uuid.
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
// La vue « Propositions » a son propre protocole, décrit en tête de _propositions.js.
var api = acquireVsCodeApi();
function imageDepot() {
  return Object.assign({ format: 'errFormat', poids: 'errTropVolumineuse' }, SZH.LIMITES.image);
}
var IMAGE = imageDepot();
var TXT = {}, ctl = {}, cartes = [], sections = [], TYPES = [], TYPES_RUBRIQUE = [];
var etatJeton = { jeton: null };
var dernierModifie = false;
var barre = document.getElementById('barre');
var titreVue = document.getElementById('titreVue');
var barreCategories = document.getElementById('barreCategories');
var panelTraductions = document.getElementById('panel-traductions');
var panelReservoir = document.getElementById('panel-reservoir');
var panelNumero = document.getElementById('panel-numero');
var panelArchive = document.getElementById('panel-archive');
var panelWeb = document.getElementById('panel-web');
var panelPropositions = document.getElementById('panel-propositions');
var corpsPage = document.getElementById('corps');
var zoneSections = document.getElementById('sections');
var compteurId = 0;
var compteurIndex = 0;
// La navigation se fait dans l'arbre : un seul panneau à la fois, choisi par l'hôte
// (charger.vueInitiale au premier chargement, ongletActiver ensuite). « Documentation du
// numéro » s'ouvre sur « Rubriques ». Gardé pour la session du panneau : rendre() ne le
// réinitialise pas.
var vueOnglet = 'numero';
var vueCategorie = 'rubriques';
// L'onglet Archive : toute la bibliothèque de production, lue à la demande (voir
// assurerChargementArchive()). `images` garde l'aperçu d'une fiche par « type|slug »,
// demandé une seule fois (ARCHIVE_IMAGE). `repriseEnCours` désactive les boutons
// « Reprendre » le temps d'un aller-retour.
var archiveEtat = {
  charge: false, chargement: false, erreur: null, fiches: [], images: {},
  filtreTexte: '', filtreType: '', filtreRevue: '', filtreNumero: '', filtreAnnee: '',
  repriseEnCours: false
};
var corpsArchiveOuvert = null;   // un seul aperçu ouvert à la fois, comme le reste de la page
var cleImageArchiveActive = null, zoneImageArchiveActive = null;

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

// ---- Barre d'outils de texte riche (rubriques) -----------------------------------------
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
// La hauteur d'un champ de prose suit son texte : SZH.suivreHauteur (_commun.js).
function appliquer(c, fn) {
  var zone = c.ctl.contenu;
  var debut = zone.selectionStart || 0;
  var fin = zone.selectionEnd || 0;
  var res = fn(String(zone.value || ''), debut, fin);
  zone.value = res.valeur;
  c.touchee = true;
  SZH.ajusterHauteur(zone);
  try { zone.focus(); zone.setSelectionRange(res.debut, res.fin); } catch (e) { /* sélection indisponible (tests) */ }
  etat('');
  majEtatCarte(c);
  majModifie();
}

// ---- Valeurs, complétude, modification --------------------------------------------------
//
// Les valeurs et la complétude d'une fiche viennent de _fiche-doc.js ; une rubrique n'a
// que son contenu.
function valeurs(c) {
  return c.famille === 'rubrique'
    ? { contenu: String(c.ctl.contenu.value || '').replace(/\r\n/g, '\n') }
    : valeursFiche(c);
}
function champsManquants(c) {
  if (c.famille === 'rubrique') { return valeurs(c).contenu.trim() === '' ? ['contenu'] : []; }
  return ficheDoc.champsManquants(c);
}
// Ce qui suffit pour écrire une fiche : au moins un champ non vide (la pastille dit ce qui
// manque encore, l'écriture n'est pas refusée).
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
  majCompteursSection();
}

// ---- Les champs d'une fiche : _fiche-doc.js -------------------------------------------
var ficheDoc = SZH.ficheDoc.creer({
  api: api,
  txt: function () { return TXT; },
  types: function () { return TYPES; },
  index: function () { return ++compteurIndex; },
  etat: etat, majEtatCarte: majEtatCarte, majModifie: majModifie,
  extensionsImage: function () { return IMAGE.extensions; },
  envoyerImage: envoyerImage, poserVignette: poserVignette
});
var champ = ficheDoc.champ, valeursFiche = ficheDoc.valeursFiche;
var majConditionnels = ficheDoc.majConditionnels, majDerives = ficheDoc.majDerives;
var recevoirApercuDate = SZH.ficheDoc.recevoirDate;

// ---- Préremplir depuis un article de l'autre revue -----------------------------------
//
// Sur la fiche que l'hôte désigne (typesConfig[].preremplissage, la fiche « D'une revue à
// l'autre »), un bouton ouvre la liste des articles de l'autre revue, demandée à l'hôte une
// fois par panneau. Un choix remplit la carte comme une saisie, sans rien écrire avant
// l'enregistrement ordinaire. Remplacer un champ déjà rempli demande confirmation.
var autreRevueEtat = { demande: false, donnees: null, carte: null, choix: null, filtre: '' };
var modaleAutreRevue = null;
function preremplissageDuType(type) {
  var t = TYPES.filter(function (x) { return x.valeur === type; })[0];
  return (t && t.preremplissage) || null;
}
function brancherPreremplissage(c, corps) {
  var nom = preremplissageDuType(c.type).revue || '';
  corps.appendChild(bouton(SZH.remplir(TXT, 'autreRevueChoisir', [nom]),
    function () { ouvrirAutreRevue(c); }, 'doc-autrerevue-bouton', TXT.autreRevueChoisirTip || ''));
}
function ouvrirAutreRevue(c) {
  autreRevueEtat.carte = c;
  autreRevueEtat.choix = null;
  if (!modaleAutreRevue) {
    modaleAutreRevue = SZH.modale({
      classeBoite: 'szh-modale-boite doc-autrerevue',
      construire: function (boite) {
        texte(boite, 'h2', 'doc-autrerevue-titre');
        var r = texte(boite, 'input', 'doc-autrerevue-recherche');
        r.type = 'search';
        r.placeholder = TXT.autreRevueRecherche || '';
        r.setAttribute('aria-label', TXT.autreRevueRecherche || '');
        r.addEventListener('input', function () { autreRevueEtat.filtre = r.value; rendreAutreRevue(); });
        texte(boite, 'div', 'doc-autrerevue-zone');
        var pied = texte(boite, 'div', 'szh-modale-pied');
        pied.appendChild(bouton(TXT.autreRevueFermer || '', function () { modaleAutreRevue.fermer(); }));
      },
      surOuverture: function () { rendreAutreRevue(); },
      focus: function () { return modaleAutreRevue.boite().querySelector('input.doc-autrerevue-recherche'); }
    });
  }
  modaleAutreRevue.ouvrir();
  if (!autreRevueEtat.demande) {
    autreRevueEtat.demande = true;
    api.postMessage({ type: SZH.MSG.DOC_AUTREREVUE_CHARGER });
  }
}
function sansAccent(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function rendreAutreRevue() {
  if (!modaleAutreRevue || !modaleAutreRevue.boite()) { return; }
  var boite = modaleAutreRevue.boite();
  var c = autreRevueEtat.carte;
  var nom = ((c && preremplissageDuType(c.type)) || {}).revue || '';
  boite.querySelector('.doc-autrerevue-titre').textContent = SZH.remplir(TXT, 'autreRevueTitre', [nom]);
  var zone = boite.querySelector('.doc-autrerevue-zone');
  zone.textContent = '';
  var d = autreRevueEtat.donnees;
  if (!d) { texte(zone, 'p', 'doc-vue-vide', TXT.autreRevueChargement || ''); return; }
  if (!d.ok) { zone.appendChild(SZH.notif('attention', SZH.remplir(TXT, 'autreRevueEchec', [nom]))); return; }
  if (d.illisibles > 0) { zone.appendChild(SZH.notif('attention', SZH.remplir(TXT, 'autreRevueIllisibles', [d.illisibles]))); }
  if (autreRevueEtat.choix) { construireConfirmation(zone); return; }
  var filtre = sansAccent(autreRevueEtat.filtre).trim();
  var trouves = 0;
  (d.numeros || []).forEach(function (n) {
    var articles = (n.articles || []).filter(function (a) {
      return filtre === '' || sansAccent(a.titreAffiche + ' ' + a.signature).indexOf(filtre) !== -1;
    });
    if (articles.length === 0) { return; }
    var groupe = texte(zone, 'section', 'doc-autrerevue-numero');
    var h = texte(groupe, 'h3', 'doc-vue-titre-section', n.libelle || n.cle || '');
    if (n.archive) { texte(h, 'span', 'szh-pastille doc-autrerevue-archive', TXT.autreRevueArchive || ''); }
    var liste = texte(groupe, 'div', 'doc-vue-liste');
    articles.forEach(function (a) {
      trouves++;
      var b = bouton(a.titreAffiche || TXT.sansTitre || '', function () { choisirAutreRevue(a); }, 'doc-autrerevue-article');
      if (a.signature) { texte(b, 'span', 'doc-vue-origine', a.signature); }
      liste.appendChild(b);
    });
  });
  if (trouves === 0) { texte(zone, 'p', 'doc-vue-vide', SZH.remplir(TXT, 'autreRevueVide', [nom])); }
}
// Remplacer un champ rempli par une autre valeur demande confirmation ; compléter un champ
// vide, non.
function choisirAutreRevue(a) {
  var c = autreRevueEtat.carte;
  if (!c) { return; }
  var conflit = Object.keys(a.valeurs || {}).some(function (cle) {
    var ctlChamp = c.ctl[cle];
    if (!ctlChamp || typeof ctlChamp.value !== 'string') { return false; }
    return ctlChamp.value !== '' && ctlChamp.value !== String(a.valeurs[cle] || '');
  });
  if (!conflit) { remplirAutreRevue(c, a); return; }
  autreRevueEtat.choix = a;
  rendreAutreRevue();
}
function construireConfirmation(zone) {
  var a = autreRevueEtat.choix;
  var z = texte(zone, 'div', 'doc-autrerevue-confirmer');
  texte(z, 'p', null, TXT.autreRevueRemplacer || '');
  texte(z, 'p', 'doc-vue-titre', a.titreAffiche || '');
  var pied = texte(z, 'div', 'szh-modale-pied');
  pied.appendChild(bouton(TXT.autreRevueRemplacerOui || '', function () {
    autreRevueEtat.choix = null;
    remplirAutreRevue(autreRevueEtat.carte, a);
  }, 'szh-bouton--principal doc-autrerevue-oui'));
  pied.appendChild(bouton(TXT.autreRevueAnnuler || '', function () {
    autreRevueEtat.choix = null;
    rendreAutreRevue();
  }, 'doc-autrerevue-annuler'));
}
function remplirAutreRevue(c, a) {
  Object.keys(a.valeurs || {}).forEach(function (cle) {
    var ctlChamp = c.ctl[cle];
    if (ctlChamp && typeof ctlChamp.value === 'string') { ctlChamp.value = String(a.valeurs[cle] || ''); }
  });
  c.touchee = true;
  majEtatCarte(c);
  majConditionnels(c);
  majDerives(c);
  majTitreBascule(c);
  majModifie();
  modaleAutreRevue.fermer();
  etat(SZH.remplir(TXT, 'autreRevueRempli', [a.titreAffiche || '']));
}
function recevoirAutreRevue(msg) {
  autreRevueEtat.donnees = { ok: !!msg.ok, numeros: msg.numeros || [], illisibles: msg.illisibles || 0 };
  // Une lecture en échec se redemandera au prochain clic.
  if (!msg.ok) { autreRevueEtat.demande = false; }
  rendreAutreRevue();
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
  // Retirer du numéro rend la fiche orpheline (l'hôte vide Ausgabe, sans effacer) : elle
  // reste dans la bibliothèque, visible dans « Mes orphelines ». Une carte jamais
  // enregistrée se retire simplement du DOM (voir retirerFiche).
  c.ctl.retirer = boutonIcone('bas', TXT.retirerTip || '', function () { retirerFiche(c); });
  tete.appendChild(c.ctl.retirer);
  // Supprimer efface la fiche définitivement, avec une icône et une infobulle distinctes.
  // L'hôte demande confirmation (modale native) ; une carte jamais enregistrée se retire
  // simplement du DOM (voir supprimerFicheCarte).
  c.ctl.supprimer = boutonIcone('poubelle', TXT.supprimerNumeroTip || '',
    function () { supprimerFicheCarte(c); }, 'szh-ico--danger');
  tete.appendChild(c.ctl.supprimer);

  var corps = texte(s, 'div', 'doc-corps');
  corps.hidden = true;
  c.ctl.corps = corps;
  if (preremplissageDuType(c.type)) { brancherPreremplissage(c, corps); }

  var v = ressource.valeurs || {};
  for (var i = 0; i < c.champs.length; i++) { champ(corps, c, c.champs[i], v); }

  majConditionnels(c);
  majDerives(c);
  c.enregistree = c.persistee ? valeurs(c) : null;

  cartes.push(c);
  if (vueOnglet === 'numero' && barreCategories && !barreCategories.hidden) { construireBarreCategories(); }
  if (c.ctl.title) { c.ctl.title.addEventListener('input', function () { majTitreBascule(c); }); }
  majEtatCarte(c);
  majPositions();
  return c;
}
var retraitsFicheEnAttente = 0;
function retirerFiche(c) {
  c.element.remove();
  cartes = cartes.filter(function (x) { return x !== c; });
  if (vueOnglet === 'numero') { construireBarreCategories(); }
  if (c.persistee) {
    retraitsFicheEnAttente++;
    api.postMessage({ type: SZH.MSG.RETIRER, famille: 'fiche', id: c.id });
  }
  majPositions();
  majCompteursSection();
  majModifie();
}
// Supprimer une carte : l'hôte demande confirmation (modale native), et le panneau se
// recharge entièrement après confirmation (documentation-hote.js), comme pour SUPPRIMER
// (orphelines).
function supprimerFicheCarte(c) {
  if (!c.persistee) { retirerFiche(c); return; }
  api.postMessage({ type: SZH.MSG.SUPPRIMER_FICHE_NUMERO, id: c.id });
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
    c.touchee = true; etat(''); majEtatCarte(c); majModifie();
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
  SZH.suivreHauteur(zone);
  c.enregistree = c.persistee ? valeurs(c) : null;

  cartes.push(c);
  majEtatCarte(c);
  return c;
}
function viderRubrique(c) {
  c.ctl.contenu.value = '';
  SZH.ajusterHauteur(c.ctl.contenu);
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
    majCompteursSection();
    try { if (c.ctl.title) { c.ctl.title.focus(); } } catch (e) { /* pas focalisable */ }
  }, 'szh-bouton--principal doc-ajouter', type.libelleAjouterTip || '');
  conteneur.appendChild(s.ajouter);
  return s;
}

// ---- Compteurs de section ---------------------------------------------------------------
//
// La navigation entre catégories se fait dans l'arbre, qui affiche les comptes. Seul
// l'en-tête de la section affichée porte son compteur (« Livres (2) »).
function compteCartes(famille, type) {
  var n = 0;
  for (var i = 0; i < cartes.length; i++) { if (cartes[i].famille === famille && cartes[i].type === type) { n++; } }
  return n;
}
function majCompteursSection() {
  for (var k = 0; k < sections.length; k++) {
    var s = sections[k];
    if (!s.compteur) { continue; }
    var m = compteCartes('fiche', s.type);
    s.compteur.textContent = m > 0 ? '(' + m + ')' : '';
  }
}

// ---- Barre d'en-tête, avec son bouton bascule « Aperçu du PDF » -----------------------
//
// Ouvre ou ferme l'aperçu de cette page dans la colonne voisine, comme pour un article
// (documentation-hote.js#basculerApercuDocumentation). L'état affiché suit la réponse de
// l'hôte (apercuEtat, ou apercuOuvert dans charger()) : l'aperçu peut se fermer à la croix,
// et c'est alors l'hôte qui le signale (onDidChangeViewState du panneau).
function construireBarre() {
  ctl = SZH.construireBarre(barre, {
    txt: TXT,
    onEnregistrer: function () { enregistrer(false); },
    onApercu: function () { api.postMessage({ type: SZH.MSG.APERCU_BASCULER }); },
    onRetour: function () {
      api.postMessage({
        type: SZH.MSG.RETOUR_ARTICLE, modifie: estModifie(),
        ressources: aEnvoyer('fiche'), rubriques: aEnvoyer('rubrique')
      });
    }
  });
}
// aria-pressed suffit : _design.css donne le fond plein à .szh-bouton[aria-pressed="true"]
// (comme les autres interrupteurs, _fiches.js#traductionsVisibles).
function majApercuBascule(ouvert) {
  if (!ctl.apercu) { return; }
  ctl.apercu.setAttribute('aria-pressed', ouvert ? 'true' : 'false');
}
function trouverFiche(id) {
  for (var i = 0; i < cartes.length; i++) { if (cartes[i].famille === 'fiche' && cartes[i].id === id) { return cartes[i]; } }
  return null;
}

// ---- Vues Traductions à faire et Réservoir ----------------------------------------------
//
// « Mes orphelines » fait partie de la vue Réservoir.
//
// Chaque ligne d'une liste montre le type et le titre (tels qu'écrits dans l'autre langue,
// sans traduction) et une ou deux actions, envoyées à l'hôte avec le `slug` (fiche) ou
// l'`uuid` (décision de statut, indépendante du numéro).
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
      apresEcriture(function () { api.postMessage({ type: SZH.MSG.TRADUIRE_DANS_NUMERO, slug: t.slug }); });
    }, 'doc-vue-bouton', TXT.traduireDansNumeroTip || ''));
  });
}
// Vue « Publier sur le site web » : une notice statique, sans message vers l'hôte. Le
// bouton, sans écouteur, annonce une fonction à venir.
function construireWeb(parent) {
  parent.textContent = '';
  var zone = texte(parent, 'div', 'doc-web');
  zone.appendChild(SZH.notif('info', TXT.webAvenir || ''));
  texte(zone, 'p', 'doc-web-explication', TXT.webExplication || '');
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'szh-bouton doc-web-bouton';
  b.textContent = TXT.webBouton || '';
  b.title = TXT.webBoutonTip || '';
  b.disabled = true;
  b.setAttribute('aria-disabled', 'true');
  zone.appendChild(b);
}
function construireOrphelines(parent, orphelines) {
  var s = texte(parent, 'section', 'doc-vue-orphelines');
  texte(s, 'h3', 'doc-vue-titre-section', TXT.orphelinesTitre || '');
  var liste = texte(s, 'div', 'doc-vue-liste');
  if (orphelines.length === 0) { texte(liste, 'p', 'doc-vue-vide', TXT.orphelinesVide || ''); return; }
  orphelines.forEach(function (o) {
    var l = ligneVue(liste, o.typeLibelle, o.titre);
    l.appendChild(bouton(TXT.tirerDansNumero || '', function () {
      apresEcriture(function () { api.postMessage({ type: SZH.MSG.TIRER_DANS_NUMERO, slug: o.slug }); });
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
  // visibles après filtre), une barre d'actions en lot : À traduire / Ignorer, ou Annuler la
  // décision, selon la vue (comme les boutons par ligne). Un seul message par action en lot,
  // avec un tableau d'uuid.
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
    // Une ligne qui sort du filtre est désélectionnée.
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

  // Réponse ciblée de l'hôte à RESERVOIR_FILTRE (voir le message « reservoir ») : seule
  // cette liste est mise à jour.
  ctl.reservoirMaj = function (avecIgnorees, nouvellesEntrees) {
    toggleCb.checked = avecIgnorees;
    entrees = nouvellesEntrees;
    rendreListe();
  };

  // « Mes orphelines » fait partie de la vue Réservoir.
  construireOrphelines(parent, Array.isArray(msg.orphelines) ? msg.orphelines : []);
}

// Le libellé de la catégorie affichée dans « Documentation du numéro » : « Rubriques » ou
// le libelleSection du type de fiche visé (typesConfig, transmis par charger()).
function libelleCategorieNumero() {
  if (vueCategorie === 'rubriques') { return TXT.groupeRubriques || ''; }
  var t = TYPES.filter(function (x) { return x.valeur === vueCategorie; })[0];
  return t ? (t.libelleSection || t.valeur) : '';
}
// Dans « Documentation du numéro », une seule catégorie à la fois : les cartes de rubrique
// sont cachées hors de la catégorie 'rubriques', les sections de fiches hors de leur type.
// Rien n'est reconstruit, seul .hidden change.
function appliquerFiltreNumero() {
  for (var i = 0; i < cartes.length; i++) {
    var c = cartes[i];
    if (c.famille === 'rubrique') { c.element.hidden = vueCategorie !== 'rubriques'; }
  }
  for (var k = 0; k < sections.length; k++) {
    var s = sections[k];
    var visible = vueCategorie === s.type;
    s.element.hidden = !visible;
    s.corps.hidden = !visible;
  }
}
// La barre des catégories de « Documentation du numéro » : Rubriques, puis un type de fiche
// par onglet, dans l'ordre du contrat, chacun avec son compte. Un clic change la catégorie
// visée et réapplique le filtre, sans rien recharger.
function construireBarreCategories() {
  barreCategories.textContent = '';
  var entrees = [{ cle: 'rubriques', libelle: TXT.groupeRubriques || '', compte: null }];
  for (var i = 0; i < TYPES.length; i++) {
    var t = TYPES[i];
    var n = cartes.filter(function (c) { return c.famille === 'fiche' && c.type === t.valeur; }).length;
    entrees.push({ cle: t.valeur, libelle: t.libelleSection || t.valeur, compte: n });
  }
  entrees.forEach(function (e) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'doc-onglet' + (e.cle === vueCategorie ? ' doc-onglet--actif' : '');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', e.cle === vueCategorie ? 'true' : 'false');
    var l = document.createElement('span');
    l.textContent = e.libelle;
    b.appendChild(l);
    if (e.compte) {
      var k = document.createElement('span');
      k.className = 'doc-onglet-compte';
      k.textContent = String(e.compte);
      b.appendChild(k);
    }
    b.addEventListener('click', function () { vueCategorie = e.cle; appliquerVue(); });
    barreCategories.appendChild(b);
  });
}
// La vue « Propositions » (_propositions.js), montée la première fois qu'on l'ouvre. Ses
// actions qui rechargent la page passent par apresEcriture : les cartes du numéro sont
// d'abord enregistrées.
var propositions = null;
function vuePropositions() {
  if (!propositions) {
    propositions = SZH.vuePropositions({
      api: api, panel: panelPropositions, barreOnglets: barreCategories, titre: titreVue,
      txt: function () { return TXT; }, types: function () { return TYPES; },
      apresEcriture: apresEcriture
    });
  }
  return propositions;
}

// Affiche le panneau de la vue choisie et pose son titre, après chaque rendre() et à chaque
// message ongletActiver (arbre, panneau déjà ouvert). Lance aussi, une fois, la lecture de
// la bibliothèque de production à l'arrivée sur Archive.
function appliquerVue() {
  panelTraductions.hidden = vueOnglet !== 'traductions';
  panelReservoir.hidden = vueOnglet !== 'reservoir';
  panelNumero.hidden = vueOnglet !== 'numero';
  panelArchive.hidden = vueOnglet !== 'archive';
  panelWeb.hidden = vueOnglet !== 'web';
  panelPropositions.hidden = vueOnglet !== 'propositions';
  corpsPage.classList.toggle('prop-plein', vueOnglet === 'propositions');
  if (vueOnglet === 'numero') { appliquerFiltreNumero(); }
  barreCategories.hidden = vueOnglet !== 'numero';
  if (vueOnglet === 'numero') { construireBarreCategories(); }
  var titre;
  if (vueOnglet === 'traductions') { titre = TXT.ongletTraductions || ''; }
  else if (vueOnglet === 'reservoir') { titre = TXT.ongletReservoir || ''; }
  else if (vueOnglet === 'archive') { titre = TXT.ongletArchive || ''; }
  else if (vueOnglet === 'web') { titre = TXT.webTitre || ''; }
  else if (vueOnglet === 'propositions') { titre = TXT.propVue || ''; }
  else {
    var categorieLibelle = libelleCategorieNumero();
    titre = (TXT.ongletNumero || '') + (categorieLibelle ? ' – ' + categorieLibelle : '');
  }
  titreVue.textContent = titre;
  if (vueOnglet === 'archive') { assurerChargementArchive(); }
  // La vue Propositions pose elle-même ses onglets de type et son titre.
  if (vueOnglet === 'propositions') { vuePropositions().afficher(); }
}

// ---- Onglet Archive : toute la bibliothèque de production, lecture seule ----------------
//
// Lue une fois par session de panneau (assurerChargementArchive), pas à charger() : des
// centaines de fiches sur OneDrive ralentiraient l'ouverture du formulaire. « Actualiser »
// (actualiserArchive) force une relecture. L'image d'une fiche est demandée au clic sur son
// aperçu (demanderImageArchive), pour ne pas toutes les envoyer à chaque lecture.
function assurerChargementArchive() {
  if (archiveEtat.charge || archiveEtat.chargement) { return; }
  archiveEtat.chargement = true;
  rendreArchive();
  api.postMessage({ type: SZH.MSG.ARCHIVE_CHARGER });
}
function actualiserArchive() {
  archiveEtat.chargement = true;
  archiveEtat.erreur = null;
  corpsArchiveOuvert = null;
  rendreArchive();
  api.postMessage({ type: SZH.MSG.ARCHIVE_ACTUALISER });
}
function cleFicheArchive(f) { return f.type + '|' + f.slug; }
function libelleTypeArchive(type) {
  for (var i = 0; i < TYPES.length; i++) { if (TYPES[i].valeur === type) { return TYPES[i].libelleSection || type; } }
  return type;
}
function champsTypeArchive(type) {
  for (var i = 0; i < TYPES.length; i++) { if (TYPES[i].valeur === type) { return TYPES[i].champs || []; } }
  return [];
}
function titreLigneArchive(f) {
  var parts = [];
  f.langues.forEach(function (l) { if (f.titres[l]) { parts.push(f.titres[l]); } });
  return parts.length > 0 ? parts.join(' / ') : (TXT.sansTitre || '');
}
function numerosLigneArchive(f) {
  if (!f.numeros || f.numeros.length === 0) { return TXT.archiveSansNumero || ''; }
  return f.numeros.map(function (n) { return n.label; }).join(', ');
}
// « Les deux revues » et les noms des revues ne se traduisent pas, comme dans
// lib/yaml.js#titreNumero.
var NOMS_REVUE_ARCHIVE = { revue: 'Revue', zeitschrift: 'Zeitschrift' };

function optionsDistinctesArchive(extraire) {
  var vues = {}, options = [];
  archiveEtat.fiches.forEach(function (f) {
    (f.numeros || []).forEach(function (n) {
      var v = extraire(n);
      if (!v || Object.prototype.hasOwnProperty.call(vues, v.valeur)) { return; }
      vues[v.valeur] = true;
      options.push(v);
    });
  });
  return options;
}
function optionsNumerosArchive() {
  return optionsDistinctesArchive(function (n) { return n.id ? { valeur: n.id, libelle: n.label } : null; })
    .sort(function (a, b) { return b.libelle.localeCompare(a.libelle, undefined, { numeric: true }); });
}
function optionsAnneesArchive() {
  return optionsDistinctesArchive(function (n) { return n.annee ? { valeur: n.annee, libelle: n.annee } : null; })
    .sort(function (a, b) { return b.valeur.localeCompare(a.valeur); });
}
function optionsRevuesArchive() {
  var vues = {}, options = [];
  archiveEtat.fiches.forEach(function (f) {
    (f.numeros || []).forEach(function (n) {
      if (!n.revue || vues[n.revue]) { return; }
      vues[n.revue] = true;
      options.push({ valeur: n.revue, libelle: NOMS_REVUE_ARCHIVE[n.revue] || n.revue });
    });
  });
  return options;
}
function optionsTypesArchive() {
  var vus = {};
  archiveEtat.fiches.forEach(function (f) { vus[f.type] = true; });
  return TYPES.filter(function (t) { return vus[t.valeur]; })
    .map(function (t) { return { valeur: t.valeur, libelle: t.libelleSection || t.valeur }; });
}

function champSelectArchive(parent, libelleChamp, libelleTous, options, valeurCourante, surChangement) {
  var d = texte(parent, 'div', 'doc-archive-filtre-champ');
  texte(d, 'span', 'doc-archive-filtre-label', libelleChamp || '');
  var sel = document.createElement('select');
  var opVide = document.createElement('option');
  opVide.value = '';
  opVide.textContent = libelleTous || '';
  sel.appendChild(opVide);
  options.forEach(function (o) {
    var op = document.createElement('option');
    op.value = o.valeur;
    op.textContent = o.libelle;
    sel.appendChild(op);
  });
  sel.value = valeurCourante || '';
  sel.addEventListener('change', function () { surChangement(sel.value); });
  d.appendChild(sel);
  return d;
}

function ficheCorrespondFiltresArchive(f) {
  if (archiveEtat.filtreType && f.type !== archiveEtat.filtreType) { return false; }
  if (archiveEtat.filtreRevue && !(f.numeros || []).some(function (n) { return n.revue === archiveEtat.filtreRevue; })) { return false; }
  if (archiveEtat.filtreNumero && !(f.numeros || []).some(function (n) { return n.id === archiveEtat.filtreNumero; })) { return false; }
  if (archiveEtat.filtreAnnee && !(f.numeros || []).some(function (n) { return n.annee === archiveEtat.filtreAnnee; })) { return false; }
  var q = String(archiveEtat.filtreTexte || '').trim().toLowerCase();
  if (q && String(f.recherche || '').indexOf(q) === -1) { return false; }
  return true;
}

function demanderImageArchive(f, zoneImg) {
  var cle = cleFicheArchive(f);
  if (Object.prototype.hasOwnProperty.call(archiveEtat.images, cle)) {
    afficherImageArchive(zoneImg, archiveEtat.images[cle]);
    return;
  }
  zoneImg.textContent = '';
  texte(zoneImg, 'p', 'absent', TXT.archiveApercuImageChargement || '');
  api.postMessage({ type: SZH.MSG.ARCHIVE_IMAGE, ficheType: f.type, slug: f.slug });
}
function afficherImageArchive(zoneImg, apercu) {
  zoneImg.textContent = '';
  if (!apercu) { texte(zoneImg, 'p', 'absent', TXT.imageAbsente || ''); return; }
  var img = document.createElement('img');
  img.src = apercu;
  img.alt = '';
  zoneImg.appendChild(img);
}

function remplirApercuArchive(f, corps) {
  corps.textContent = '';
  var champsType = champsTypeArchive(f.type);
  f.langues.forEach(function (l) {
    var v = f.valeurs[l];
    if (!v) { return; }
    var bloc = texte(corps, 'div', 'doc-archive-apercu-langue');
    texte(bloc, 'p', 'doc-archive-apercu-langue-nom', l.toUpperCase());
    champsType.forEach(function (cfg) {
      if (cfg.saisie === 'fichier') { return; }
      var val = v[cfg.cle];
      var texteValeur = '';
      if (cfg.saisie === 'structure') {
        if (Array.isArray(val) && val.length > 0) {
          texteValeur = val.map(function (ligneStruct) {
            return (cfg.structureChamps || []).map(function (sc) { return ligneStruct[sc.cle]; })
              .filter(function (x) { return x; }).join(' · ');
          }).join(' ; ');
        }
      } else if (cfg.saisie === 'liste_multiple') {
        // Le jeton seul (« FR ») n'est pas lisible : on l'habille du libellé du contrat
        // (cfg.options, posé par typesRessourceConfig() même pour un aperçu Archive).
        if (Array.isArray(val) && val.length > 0) {
          texteValeur = val.map(function (jeton) {
            var o = (cfg.options || []).filter(function (x) { return x.valeur === jeton; })[0];
            return o ? o.libelle : jeton;
          }).join(', ');
        }
      } else {
        texteValeur = val === undefined || val === null ? '' : String(val);
      }
      if (!texteValeur) { return; }
      var champDiv = texte(bloc, 'div', 'doc-archive-apercu-champ');
      texte(champDiv, 'span', 'doc-archive-apercu-cle', cfg.libelle || cfg.cle);
      texte(champDiv, 'span', 'doc-archive-apercu-valeur', texteValeur);
    });
  });
  var zoneImg = texte(corps, 'div', 'doc-vignette doc-archive-apercu-image');
  cleImageArchiveActive = cleFicheArchive(f);
  zoneImageArchiveActive = zoneImg;
  demanderImageArchive(f, zoneImg);
}

function basculerApercuArchive(f, corps) {
  var ouvrir = corps.hidden;
  if (corpsArchiveOuvert && corpsArchiveOuvert !== corps) { corpsArchiveOuvert.hidden = true; }
  corps.hidden = !ouvrir;
  corpsArchiveOuvert = corps.hidden ? null : corps;
  if (!corps.hidden && !corps.dataset.rempli) {
    remplirApercuArchive(f, corps);
    corps.dataset.rempli = '1';
  }
  if (corps.hidden) { cleImageArchiveActive = null; zoneImageArchiveActive = null; }
}

function reprendreArchive(f, boutonReprendre) {
  if (archiveEtat.repriseEnCours) { return; }
  archiveEtat.repriseEnCours = true;
  if (boutonReprendre) { boutonReprendre.disabled = true; }
  etat('');
  api.postMessage({ type: SZH.MSG.ARCHIVE_REPRENDRE, ficheType: f.type, slug: f.slug });
}

// Trois icônes, dans cet ordre : Reprendre (flèche), Aperçu (œil), Éditer (crayon, grisé :
// l'édition d'une fiche archivée n'est pas encore branchée).
function rendreListeArchive(zoneListe) {
  zoneListe.textContent = '';
  var visibles = archiveEtat.fiches.filter(ficheCorrespondFiltresArchive);
  if (visibles.length === 0) { texte(zoneListe, 'p', 'doc-vue-vide', TXT.archiveAucunResultat || ''); return; }
  visibles.forEach(function (f) {
    var item = texte(zoneListe, 'div', 'doc-archive-item');
    var ligneEl = ligneVue(item, libelleTypeArchive(f.type), titreLigneArchive(f));
    texte(ligneEl, 'span', 'doc-vue-origine', numerosLigneArchive(f));
    var corps = texte(item, 'div', 'doc-corps doc-archive-corps');
    corps.hidden = true;
    var boutonReprendre = boutonIcone('fleche', TXT.archiveReprendreTip || '',
      function () { reprendreArchive(f, boutonReprendre); }, 'doc-archive-reprendre');
    boutonReprendre.disabled = archiveEtat.repriseEnCours;
    ligneEl.appendChild(boutonReprendre);
    var boutonApercu = boutonIcone('oeil', TXT.archiveApercuTitre || '',
      function () { basculerApercuArchive(f, corps); }, 'doc-archive-apercu');
    ligneEl.appendChild(boutonApercu);
    var boutonEditer = boutonIcone('crayon', TXT.archiveEditerTip || '', function () {}, 'doc-archive-editer');
    boutonEditer.disabled = true;
    ligneEl.appendChild(boutonEditer);
    item.appendChild(corps);
  });
}

function rendreArchive() {
  panelArchive.textContent = '';
  var barreHaut = texte(panelArchive, 'div', 'doc-archive-barre');
  barreHaut.appendChild(bouton(TXT.archiveActualiser || '', actualiserArchive,
    'doc-archive-actualiser', TXT.archiveActualiserTip || ''));
  if (archiveEtat.charge) {
    texte(barreHaut, 'span', 'doc-archive-compteur', remplir('archiveCompteur', [String(archiveEtat.fiches.length)]));
  }

  if (archiveEtat.chargement) {
    texte(panelArchive, 'p', 'doc-vue-vide', TXT.archiveChargement || '');
    return;
  }
  if (!archiveEtat.charge) {
    texte(panelArchive, 'p', 'doc-archive-erreur', archiveEtat.erreur || TXT.archiveAncrageIntrouvable || '');
    return;
  }
  if (archiveEtat.fiches.length === 0) {
    texte(panelArchive, 'p', 'doc-vue-vide', TXT.archiveVide || '');
    return;
  }

  var barreFiltres = texte(panelArchive, 'div', 'doc-archive-filtres');
  var champRecherche = document.createElement('input');
  champRecherche.type = 'search';
  champRecherche.className = 'doc-archive-recherche';
  champRecherche.placeholder = TXT.archiveRechercheIndice || '';
  champRecherche.value = archiveEtat.filtreTexte;
  champRecherche.addEventListener('input', function () {
    archiveEtat.filtreTexte = champRecherche.value;
    rendreListeArchive(zoneListe);
  });
  barreFiltres.appendChild(champRecherche);
  champSelectArchive(barreFiltres, TXT.archiveFiltreType, TXT.archiveFiltreTypeTous,
    optionsTypesArchive(), archiveEtat.filtreType, function (v) { archiveEtat.filtreType = v; rendreListeArchive(zoneListe); });
  champSelectArchive(barreFiltres, TXT.archiveFiltreRevue, TXT.archiveFiltreRevueToutes,
    optionsRevuesArchive(), archiveEtat.filtreRevue, function (v) { archiveEtat.filtreRevue = v; rendreListeArchive(zoneListe); });
  champSelectArchive(barreFiltres, TXT.archiveFiltreNumero, TXT.archiveFiltreNumeroTous,
    optionsNumerosArchive(), archiveEtat.filtreNumero, function (v) { archiveEtat.filtreNumero = v; rendreListeArchive(zoneListe); });
  champSelectArchive(barreFiltres, TXT.archiveFiltreAnnee, TXT.archiveFiltreAnneeToutes,
    optionsAnneesArchive(), archiveEtat.filtreAnnee, function (v) { archiveEtat.filtreAnnee = v; rendreListeArchive(zoneListe); });

  var zoneListe = texte(panelArchive, 'div', 'doc-vue-liste doc-archive-liste');
  rendreListeArchive(zoneListe);
}

function rendre(msg) {
  zoneSections.textContent = '';
  cartes = [];
  sections = [];
  construireTraductions(panelTraductions, Array.isArray(msg.traductions) ? msg.traductions : []);
  construireReservoir(panelReservoir, msg);
  construireWeb(panelWeb);
  TYPES = Array.isArray(msg.typesConfig) ? msg.typesConfig : [];
  TYPES_RUBRIQUE = Array.isArray(msg.typesRubrique) ? msg.typesRubrique : [];

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
  majCompteursSection();
  appliquerVue();
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

// Une action que l'hôte fait suivre d'un rechargement (tirer, traduire) attend que les
// cartes soient écrites, sinon le rechargement les remettrait à leur valeur du disque.
// L'écriture passe par autoEnr, qui ne double pas un envoi en cours.
var gesteApresEcriture = null;
function apresEcriture(geste) {
  if (!estModifie()) { geste(); return; }
  gesteApresEcriture = geste;
  autoEnr.ecrire();
}

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
    // La vue demandée par une entrée de l'arbre (extension.js#_itemsActualite /
    // _itemsDocumentationNumero), envoyée seulement dans le premier « charger »
    // (documentation-hote.js#ouvrirDocumentation). Aux rechargements suivants,
    // vueOnglet/vueCategorie restent ce qui était affiché.
    if (msg.vueInitiale && msg.vueInitiale.onglet) {
      vueOnglet = String(msg.vueInitiale.onglet);
      vueCategorie = String(msg.vueInitiale.categorie || 'rubriques');
    }
    rendre(msg);
    majApercuBascule(!!msg.apercuOuvert);
    return;
  }
  if (msg.type === SZH.MSG.DOC_DATE_FORMEE) {
    recevoirApercuDate(msg);
    return;
  }
  if (msg.type === SZH.MSG.DOC_AUTREREVUE_DONNEES) {
    recevoirAutreRevue(msg);
    return;
  }
  // Un panneau déjà ouvert qu'une entrée de l'arbre rappelle sur une autre vue : bascule
  // seulement, sans rechargement (documentation-hote.js#ouvrirDocumentation).
  if (msg.type === SZH.MSG.ONGLET_ACTIVER) {
    vueOnglet = String(msg.cle || 'numero');
    vueCategorie = String(msg.categorie || 'rubriques');
    appliquerVue();
    return;
  }
  // L'état réel du bouton « Aperçu du PDF » : réponse à APERCU_BASCULER, ou envoyé quand le
  // panneau redevient actif (l'aperçu a pu être fermé à la croix).
  if (msg.type === SZH.MSG.APERCU_ETAT) {
    majApercuBascule(!!msg.ouvert);
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
    if (gesteApresEcriture && !estModifie()) {
      var geste = gesteApresEcriture;
      gesteApresEcriture = null;
      geste();
    }
    return;
  }
  if (msg.type === SZH.MSG.ERREUR) {
    gesteApresEcriture = null;
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
  // Réponse ciblée à RESERVOIR_FILTRE (l'interrupteur « afficher les ignorées ») : seule la
  // liste du réservoir est reconstruite.
  if (msg.type === 'reservoir') {
    if (ctl.reservoirMaj) { ctl.reservoirMaj(!!msg.avecIgnorees, Array.isArray(msg.entrees) ? msg.entrees : []); }
    return;
  }
  // Onglet Archive : la lecture (première ouverture ou « Actualiser »), l'image demandée à
  // part au clic sur un aperçu, et la réponse au geste « Reprendre dans ce numéro ».
  if (msg.type === SZH.MSG.ARCHIVE_DONNEES) {
    archiveEtat.chargement = false;
    archiveEtat.charge = !!msg.ok;
    archiveEtat.erreur = msg.ok ? null : (msg.message || '');
    archiveEtat.fiches = Array.isArray(msg.fiches) ? msg.fiches : [];
    corpsArchiveOuvert = null;
    if (ctl.onglets && ctl.onglets.archive) {
      var compte = ctl.onglets.archive.querySelector('.doc-onglet-compte');
      if (archiveEtat.fiches.length > 0) {
        if (!compte) { compte = texte(ctl.onglets.archive, 'span', 'doc-onglet-compte'); }
        compte.textContent = String(archiveEtat.fiches.length);
      } else if (compte) { compte.remove(); }
    }
    rendreArchive();
    return;
  }
  if (msg.type === SZH.MSG.ARCHIVE_IMAGE_DONNEE) {
    var cleRecue = (msg.ficheType || '') + '|' + (msg.slug || '');
    archiveEtat.images[cleRecue] = msg.apercu || null;
    if (cleImageArchiveActive === cleRecue && zoneImageArchiveActive) {
      afficherImageArchive(zoneImageArchiveActive, msg.apercu || null);
    }
    return;
  }
  if (msg.type === SZH.MSG.ARCHIVE_REPRISE) {
    archiveEtat.repriseEnCours = false;
    // Un enregistrement réussi (msg.ok) a déjà déclenché un « charger » séparé côté hôte,
    // qui reconstruit « Documentation du numéro » : ici, on réactive seulement les boutons de
    // la liste Archive et on affiche le message final.
    rendreArchive();
    etat(msg.ok ? (TXT.archiveRepriseOk || '') : ('⚠ ' + (msg.message || '')));
    return;
  }
  if (msg.type === SZH.MSG.PROP_DONNEES || msg.type === SZH.MSG.PROP_VERIFIE) { vuePropositions().recevoir(msg); return; }
  console.warn('documentation : type de message inconnu', msg.type);
});
SZH.annoncerPret(api, function () { return recu; });
})();
