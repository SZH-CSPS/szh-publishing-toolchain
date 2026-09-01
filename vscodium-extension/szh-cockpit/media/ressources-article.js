(function () {
'use strict';
// Fiches de « ressources » d'un article (livre, film, …) : une section par type, une carte
// DÉPLIÉE par fiche — pas d'accordéon comme le gestionnaire des médias, la demande de Robin
// étant la vitesse de saisie en série — et un gros bouton « Ajouter » toujours à la portée,
// juste sous la dernière carte de sa section.
//
// Le moteur est générique : chaque type (livre, film, …) est décrit par `typesConfig`, que
// l'hôte construit depuis lib/ressources.js (champsBiblio()) — cette page ne connaît AUCUN
// nom de champ en dur, hormis les quatre champs communs à tout type (titre, lien,
// descriptif, image) qui sont le contrat du moteur lui-même.
//
// Identité d'une carte : un identifiant que CETTE page choisit à la création (nouvelId()),
// jamais recalculé par l'hôte — voir lib/ressources.js. Une carte neuve, jamais enregistrée,
// n'existe que dans le navigateur tant qu'« Enregistrer » n'a pas été demandé ; retirer une
// telle carte ne va donc pas déranger l'hôte pour rien.
//
// Une carte vide (jamais touchée) ne compte pas comme modifiée : cliquer « Ajouter » puis
// revenir aussitôt à l'article ne doit pas déclencher l'avertissement « non enregistré ».
//
// Protocole. Vers l'hôte :
//   pret ; modifie { modifie } ; enregistrer { auto, ressources } ;
//   retirer { id } ; deposer-image { id, nomFichier, donneesBase64 } ;
//   retourArticle { modifie, ressources }
// où ressources = [{ id, type, valeurs }], valeurs = { titre, lien, descriptif, image,
// …champs bibliographiques du type }.
// Depuis l'hôte :
//   charger { slug, ressources, typesConfig, focus, accent, i18n } ; enregistre { auto } ;
//   erreur { message } ; image-deposee { id, image, apercu } ; image-erreur { id, message }
// où une ressource reçue vaut { id, type, valeurs, apercu }, et un type de typesConfig
// { valeur, libelleSection, libelleAjouter, champs: [{ cle, libelle }], avecImage }. Un type
// sans avecImage (intervention, recherche : lib/ressources.js, typeAvecImage()) n'affiche
// aucune zone de dépôt et n'exige jamais d'image pour être complet — voir construireCarte().
var api = acquireVsCodeApi();
// Mêmes plafonds que l'hôte, qui recontrôle tout : répondre tout de suite plutôt que
// d'envoyer un fichier que l'hôte refusera de toute façon.
var IMAGE = {
  maxi: 50 * 1024 * 1024, extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'],
  format: 'errFormat', poids: 'errTropVolumineuse'
};
var TXT = {}, ctl = {}, cartes = [], sections = [], TYPES = [], dernierModifie = false;
var barre = document.getElementById('barre');
var corps = document.getElementById('corps');
var compteurId = 0;

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

// ---- Valeurs et complétude d'une carte ----
// Champs requis : les mêmes que REQUIS dans lib/ressources.js (titre, descriptif, image).
// La bibliographie et le lien restent facultatifs à l'écriture. L'hôte revalide de toute
// façon avant d'écrire quoi que ce soit — cette liste-ci n'est qu'un confort de saisie.
// `image` n'est exigée que pour un type qui en porte une (c.avecImage, posé par l'hôte à
// partir de lib/ressources.js typeAvecImage()) : une carte d'intervention ou de recherche
// n'a tout simplement pas ce champ (voir construireCarte), donc jamais rien à y manquer.
var REQUIS = ['titre', 'descriptif', 'image'];

function valeurs(c) {
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
function champsManquants(c) {
  var v = valeurs(c);
  var manque = [];
  for (var i = 0; i < REQUIS.length; i++) {
    var cle = REQUIS[i];
    if (cle === 'image' && !c.avecImage) { continue; }
    if (v[cle] === '') { manque.push(cle); }
  }
  return manque;
}
function estComplete(c) { return champsManquants(c).length === 0; }

function estModifieCarte(c) {
  // Une carte neuve jamais touchée ne compte pas : ajouter puis revenir aussitôt ne doit
  // pas déclencher l'avertissement « non enregistré ».
  if (!c.touchee) { return false; }
  if (!estComplete(c)) { return true; }
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
// Les cartes complètes seulement : une carte à moitié remplie n'a rien d'écrivable, et
// l'hôte la refuserait de toute façon (lib/ressources.js, champsManquants).
function completes() {
  var res = [];
  for (var i = 0; i < cartes.length; i++) {
    if (estComplete(cartes[i])) { res.push({ id: cartes[i].id, type: cartes[i].type, valeurs: valeurs(cartes[i]) }); }
  }
  return res;
}

// Libellé de champ requis, pour le composer dans le message « à compléter » — même liste
// que REQUIS ci-dessus, dans le même ordre.
var LIBELLE_REQUIS = { titre: 'champTitre', descriptif: 'champDescriptif', image: 'champImage' };
function majEtatCarte(c) {
  var manque = champsManquants(c);
  if (!c.ctl.manque) { return; }
  c.ctl.manque.textContent = '';
  c.ctl.manque.hidden = manque.length === 0;
  if (manque.length > 0) {
    var libelles = manque.map(function (cle) { return TXT[LIBELLE_REQUIS[cle]] || cle; });
    c.ctl.manque.appendChild(SZH.icone('info'));
    texte(c.ctl.manque, 'span', null, remplir('manque', [libelles.join(', ')]));
  }
}

// ---- Un champ texte (input ou textarea) ----
function champ(parent, c, cle, libelle, indice, multiligne) {
  var d = texte(parent, 'div', 'szh-champ');
  var id = 'ch-' + cle + '-' + c.index;
  var l = texte(d, 'label', null, libelle || '');
  l.setAttribute('for', id);
  var i = document.createElement(multiligne ? 'textarea' : 'input');
  if (multiligne) { i.rows = 3; } else { i.type = 'text'; }
  i.id = id; i.maxLength = multiligne ? 4000 : 300;
  if (indice) { i.placeholder = indice; }
  i.addEventListener('input', function () {
    c.touchee = true;
    etat('');
    majEtatCarte(c);
    majModifie();
  });
  d.appendChild(i);
  c.ctl[cle] = i;
  return d;
}

// ---- L'image de couverture, toujours décorative ----
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
  e.className = 'ressource-depot-etat' + (erreur ? ' erreur' : '');
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
  var d = texte(parent, 'div', 'ressource-depot');
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
  c.ctl.depotEtat = texte(d, 'span', 'ressource-depot-etat');
  return d;
}

// ---- Une carte ----
// `persistee` dit si la fiche existe déjà dans le .md (chargée depuis l'hôte) : la
// retirer doit alors le lui dire. Une fiche neuve (bouton « Ajouter ») n'existe nulle
// part ailleurs que dans cette page tant qu'elle n'a pas été enregistrée.
// ---- Accordéon : une seule fiche ouverte à la fois ------------------------------------
//
// Demandé par Robin le 01.09.2026, en remplacement des cartes toutes dépliées. Sur un
// article qui porte huit livres et quatre films, tout déplié ne se lit plus ; et la saisie
// en série reste rapide, puisqu'ajouter une fiche l'ouvre aussitôt.

// Le libellé de l'en-tête : la position dans sa section, puis le titre. La position est
// celle du .md — les fiches y sont rangées à l'enregistrement (lib/ressources.js,
// reordonnerRessources) — de sorte que ce numéro dit vraiment où la fiche s'imprimera.
function majTitreBascule(c) {
  if (!c.ctl.bascule) { return; }
  var t = c.ctl.titre ? ligne(c.ctl.titre.value) : '';
  if (t === '') { t = TXT.sansTitre || '—'; }
  c.ctl.bascule.textContent = String(c.position || 1) + ' · ' + t;
}

// Renumérote toutes les fiches, section par section : une fiche ajoutée ou retirée décale
// celles qui la suivent, et un numéro périmé serait pire que pas de numéro du tout.
function majPositions() {
  var compte = {};
  for (var i = 0; i < cartes.length; i++) {
    var c = cartes[i];
    compte[c.type] = (compte[c.type] || 0) + 1;
    c.position = compte[c.type];
    majTitreBascule(c);
  }
}

// Ouvre une fiche et ferme toutes les autres. Recliquer sur celle qui est ouverte la ferme :
// l'état « tout replié » doit rester atteignable, sans quoi on ne peut plus embrasser la
// liste entière du regard.
function ouvrirCarte(c, ouvrir) {
  for (var i = 0; i < cartes.length; i++) {
    var autre = cartes[i];
    if (!autre.ctl.corps) { continue; }
    var vise = (autre === c) && ouvrir;
    autre.ctl.corps.hidden = !vise;
    if (autre.ctl.bascule) { autre.ctl.bascule.setAttribute('aria-expanded', vise ? 'true' : 'false'); }
    if (autre.element) {
      if (vise) { autre.element.classList.add('ressource-carte--ouverte'); }
      else { autre.element.classList.remove('ressource-carte--ouverte'); }
    }
  }
}

function basculerCarte(c) {
  ouvrirCarte(c, !!(c.ctl.corps && c.ctl.corps.hidden));
}

function construireCarte(section, ressource, persistee) {
  var index = cartes.length;
  var c = {
    id: ressource.id, type: section.type, index: index, ctl: {},
    champs: section.champs, avecImage: section.avecImage, image: (ressource.valeurs || {}).image || '',
    apercu: ressource.apercu || null,
    persistee: !!persistee, touchee: false, enregistree: null
  };
  var s = texte(section.corps, 'section', 'szh-carte ressource-carte');
  c.element = s;

  var tete = texte(s, 'header', 'ressource-tete');

  // En-tête d'accordéon : un vrai <button>, pas un <div> cliquable — sans quoi la fiche ne
  // s'ouvrirait ni au clavier ni au lecteur d'écran, ce qui n'a pas sa place dans un outil
  // de pédagogie spécialisée. aria-expanded dit l'état, le libellé dit la position et le
  // titre (« 3 · Le handicap en Suisse »).
  c.ctl.bascule = texte(tete, 'button', 'ressource-bascule');
  c.ctl.bascule.type = 'button';
  c.ctl.bascule.setAttribute('aria-expanded', 'false');
  c.ctl.bascule.addEventListener('click', function () { basculerCarte(c); });

  texte(tete, 'span', 'szh-pousse');
  tete.appendChild(boutonIcone('poubelle', TXT.retirerTip || '', function () { retirerCarte(c); }, 'szh-ico--danger'));

  // Le corps se replie d'un bloc. `hidden` plutôt qu'une classe : l'élément sort alors de
  // l'arbre d'accessibilité, donc un lecteur d'écran ne lit pas le contenu d'une fiche fermée.
  var corps = texte(s, 'div', 'ressource-corps');
  corps.hidden = true;
  c.ctl.corps = corps;

  var v = ressource.valeurs || {};
  champ(corps, c, 'titre', TXT.champTitre, TXT.champTitreIndice, false);

  if (c.champs.length > 0) {
    var biblio = texte(corps, 'div', 'ressource-biblio');
    for (var i = 0; i < c.champs.length; i++) { champ(biblio, c, c.champs[i].cle, c.champs[i].libelle, '', false); }
  }

  champ(corps, c, 'descriptif', TXT.champDescriptif, TXT.champDescriptifIndice, true);

  // Types sans image (c.avecImage) : aucune zone de dépôt — ni champ vide à ignorer, ni
  // vignette « Aucune image » qui n'aurait jamais de raison de se remplir. Voir
  // lib/ressources.js (SANS_IMAGE) et pipeline/filters/szh-ressource.lua pour le pendant
  // côté rendu, déjà générique sans avoir besoin de connaître cette liste.
  if (c.avecImage) {
    var zoneImage = texte(s, 'div', 'ressource-image');
    c.ctl.vignette = texte(zoneImage, 'div', 'ressource-vignette');
    construireDepot(zoneImage, c);
  }

  champ(s, c, 'lien', TXT.champLien, TXT.champLienIndice, false);
  texte(s, 'p', 'ressource-note', TXT.lienNote || '');

  c.ctl.manque = texte(s, 'p', 'szh-notif szh-notif--info ressource-manque');
  c.ctl.manque.hidden = true;

  // Valeurs initiales.
  c.ctl.titre.value = String(v.titre || '');
  c.ctl.lien.value = String(v.lien || '');
  c.ctl.descriptif.value = String(v.descriptif || '');
  for (var k = 0; k < c.champs.length; k++) { c.ctl[c.champs[k].cle].value = String(v[c.champs[k].cle] || ''); }
  if (c.avecImage) { poserVignette(c); }
  majEtatCarte(c);
  c.enregistree = c.persistee ? valeurs(c) : null;

  cartes.push(c);
  // Le libellé de l'accordéon suit le titre à la frappe : sans cela, une fiche qu'on vient
  // de nommer resterait « (sans titre) » jusqu'au prochain rechargement.
  if (c.ctl.titre) { c.ctl.titre.addEventListener('input', function () { majTitreBascule(c); }); }
  majPositions();
  return c;
}

function retirerCarte(c) {
  c.element.remove();
  cartes = cartes.filter(function (x) { return x !== c; });
  if (c.persistee) { api.postMessage({ type: 'retirer', id: c.id }); }
  majPositions();          // les fiches suivantes se décalent : leur numéro doit suivre
  majModifie();
}

// ---- Une section (un type) ----
function construireSection(type) {
  var s = { type: type.valeur, champs: type.champs || [], avecImage: type.avecImage !== false };
  texte(corps, 'h2', 'titre-section', type.libelleSection || type.valeur);
  var conteneur = texte(corps, 'div', 'ressource-section');
  s.corps = conteneur;
  s.ajouter = bouton(type.libelleAjouter || '', function () {
    var c = construireCarte(s, { id: nouvelId(), type: s.type, valeurs: {}, apercu: null }, false);
    conteneur.insertBefore(c.element, s.ajouter);
    // Une fiche neuve s'ouvre aussitôt — et referme la précédente, l'accordéon n'en gardant
    // qu'une. Sans cela, enchaîner dix livres demanderait un clic de plus par livre, ce qui
    // irait contre la saisie en série voulue.
    ouvrirCarte(c, true);
    try { c.ctl.titre.focus(); } catch (e) { /* pas focalisable */ }
  }, 'szh-bouton--principal ressource-ajouter', type.libelleAjouterTip || '');
  conteneur.appendChild(s.ajouter);
  return s;
}

// ---- Barre d'en-tête ----
function construireBarre() {
  barre.textContent = '';
  barre.className = 'szh-barre';
  ctl.enregistrer = bouton(TXT.enregistrer, function () { enregistrer(false); },
    'szh-bouton--principal', TXT.enregistrerTip);
  barre.appendChild(ctl.enregistrer);
  barre.appendChild(bouton(TXT.retour, function () {
    api.postMessage({ type: 'retourArticle', modifie: estModifie(), ressources: completes() });
  }, '', TXT.retourTip));
  ctl.indic = texte(barre, 'span', 'szh-barre-indic');
  ctl.indic.setAttribute('aria-live', 'polite');
  ctl.etat = texte(barre, 'span', 'szh-barre-etat');
  ctl.etat.setAttribute('role', 'status');
}

function trouverCarte(id) {
  for (var i = 0; i < cartes.length; i++) { if (cartes[i].id === id) { return cartes[i]; } }
  return null;
}

function rendre(msg) {
  corps.textContent = '';
  cartes = [];
  sections = [];
  TYPES = Array.isArray(msg.typesConfig) ? msg.typesConfig : [];
  var listeRessources = Array.isArray(msg.ressources) ? msg.ressources : [];
  for (var i = 0; i < TYPES.length; i++) { sections.push(construireSection(TYPES[i])); }
  for (var j = 0; j < listeRessources.length; j++) {
    var r = listeRessources[j];
    var section = sections.filter(function (s) { return s.type === r.type; })[0];
    if (!section) { continue; }                    // type inconnu de ce cockpit : ignoré
    var c = construireCarte(section, r, true);
    section.corps.insertBefore(c.element, section.ajouter);
  }
  dernierModifie = false;
  etat('');
  majModifie();
}

function enregistrer(auto) {
  var liste = completes();
  if (liste.length === 0) { if (!auto) { etat(TXT.rienAEcrire || ''); } return; }
  api.postMessage({ type: 'enregistrer', auto: !!auto, ressources: liste });
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
      if (estComplete(cartes[i])) {
        cartes[i].persistee = true;
        cartes[i].enregistree = valeurs(cartes[i]);
      }
    }
    etat(msg.auto ? '' : (TXT.enregistre || ''));
    majModifie();
    return;
  }
  if (msg.type === 'erreur') { autoEnr.confirme(); etat('⚠ ' + msg.message); return; }
  if (msg.type === 'image-deposee' || msg.type === 'image-erreur') {
    var c = trouverCarte(msg.id);
    if (!c || !c.avecImage) { return; }              // type sans image : rien à y poser
    if (msg.type === 'image-deposee') {
      c.image = msg.image || '';
      c.apercu = msg.apercu || null;
      c.touchee = true;
      poserVignette(c);
      poserEtatDepot(c, TXT.imageDeposee || '', false);
      majEtatCarte(c);
      majModifie();
    } else {
      poserEtatDepot(c, '⚠ ' + (msg.message || '?'), true);
    }
    return;
  }
});
SZH.annoncerPret(api, function () { return recu; });
})();
