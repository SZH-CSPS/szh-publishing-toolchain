(function () {
'use strict';
// Gestionnaire des médias d'un article : une carte par image de media/, aux mêmes champs
// que l'ancienne fiche image (légende, rôle du texte alternatif, alternative, crédits),
// plus la case « sans légende ni numéro », l'encadré « attention qualité » et le
// remplacement du fichier par dépôt. En pied, les portraits des auteur·e·s, sans champs :
// ils ne sont pas des figures, on n'y juge que la qualité et on les remplace.
//
// Mêmes règles que les autres webviews : aucune donnée dans le HTML, tout arrive par
// postMessage, page construite en DOM sans innerHTML. Les aperçus sont des data: URI
// fournies par l'hôte, d'où le img-src data: de la CSP.
//
// Protocole. Vers l'hôte :
//   pret ; modifie { modifie } ; enregistrer { auto, medias } ;
//   retourArticle { modifie, medias } ; ouvrirMedia { relatif } ;
//   remplacer { relatif, nomFichier, donneesBase64 } ; retirer { relatif } ;
//   inserer { relatif, medias } ; portrait-remplacer { base, nomFichier, donneesBase64 } ;
//   portrait-version { base, version }
// Depuis l'hôte :
//   charger { slug, medias, portraits, focus, i18n } ; enregistre { auto } ;
//   erreur { message } ; focaliser { relatif } ;
//   media-remplace { relatif, description, apercu, qualite } ;
//   media-erreur { relatif, message } ; media-annulee { relatif } ;
//   media-retire { relatif } ;
//   portrait-remplace { base, nom, version, versionActuelle, description, apercu, qualite } ;
//   portrait-erreur { base, message }
// où un média vaut { relatif, description, apercu, occurrences, qualite, doublons,
// sansAlternative, valeurs } et valeurs = { legende, alt, altDefini, copyright, source,
// horsFigure }.
var api = acquireVsCodeApi();
// Mêmes plafonds et mêmes formats que l'hôte, qui recontrôle tout : ici, c'est pour
// répondre tout de suite plutôt que d'envoyer 50 Mo pour rien.
var IMAGE = {
  maxi: 50 * 1024 * 1024, extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'],
  format: 'errFormat', poids: 'errTropVolumineuse'
};
var PORTRAIT = {
  maxi: 20 * 1024 * 1024, extensions: ['png', 'jpg', 'jpeg', 'webp'],
  format: 'errFormatPortrait', poids: 'errTropVolumineusePortrait'
};

var TXT = {}, ctl = {}, cartes = [], portraits = [], dernierModifie = false;
var barre = document.getElementById('barre');
var avis = document.getElementById('avis');
var corps = document.getElementById('corps');

function bouton(txt, fn, cls, titre) {
  var b = document.createElement('button');
  b.type = 'button'; b.textContent = txt;
  if (cls) { b.className = cls; }
  if (titre) { b.title = titre; }
  b.addEventListener('click', fn);
  return b;
}
function etat(msg) { if (ctl.etat) { ctl.etat.textContent = msg || ''; } }
function texte(parent, balise, cls, contenu) {
  var e = document.createElement(balise);
  if (cls) { e.className = cls; }
  if (contenu !== undefined && contenu !== null) { e.textContent = contenu; }
  parent.appendChild(e);
  return e;
}
function ligne(v) { return String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' ').trim(); }

// ---- Valeurs d'une carte ----
// Les deux états du texte alternatif viennent du choix de rôle, jamais d'un champ vide :
//   « décrit »     -> altDefini vaut vrai si le champ porte un texte ; sinon l'attribut
//                     est absent et le pipeline retombe sur la légende ;
//   « décorative » -> altDefini vaut vrai avec une valeur vide, ce qui écrit alt="" et
//                     fait ignorer l'image par les lecteurs d'écran.
// Hors figure, la légende ne s'écrit pas : le champ est verrouillé et sa valeur ignorée,
// comme dans lib/references.js.
function decorative(c) { return !!(c.ctl.roleDeco && c.ctl.roleDeco.checked); }
function horsFigure(c) { return !!(c.ctl.horsFigure && c.ctl.horsFigure.checked); }
function valeurs(c) {
  var alt = decorative(c) ? '' : ligne(c.ctl.alt.value);
  return {
    legende: horsFigure(c) ? '' : ligne(c.ctl.legende.value),
    alt: alt, altDefini: decorative(c) || alt !== '',
    copyright: ligne(c.ctl.copyright.value),
    source: ligne(c.ctl.source.value),
    horsFigure: horsFigure(c)
  };
}
function poserValeurs(c, v) {
  v = v || {};
  c.ctl.legende.value = String(v.legende || '');
  var deco = !!v.altDefini && String(v.alt || '') === '';
  c.ctl.roleDeco.checked = deco;
  c.ctl.roleDecrit.checked = !deco;
  c.ctl.alt.value = deco ? '' : String(v.alt || '');
  c.ctl.copyright.value = String(v.copyright || '');
  c.ctl.source.value = String(v.source || '');
  c.ctl.horsFigure.checked = !!v.horsFigure;
}
function majRole(c) {
  if (!c.ctl.alt) { return; }
  var verrou = c.occurrences === 0;
  c.ctl.alt.disabled = verrou || decorative(c);
  c.ctl.legende.disabled = verrou || horsFigure(c);
  if (c.ctl.aideAlt) { c.ctl.aideAlt.textContent = decorative(c) ? (TXT.altAideDeco || '') : (TXT.altAide || ''); }
  if (c.ctl.aideLegende) {
    c.ctl.aideLegende.textContent = horsFigure(c) ? (TXT.horsFigureAide || '') : (TXT.legendeAide || '');
  }
  majAlerteAlt(c);
}

// Ni texte alternatif, ni légende sur laquelle retomber, et pas déclarée décorative : le
// rendu la traitera en image décorative, ce que personne n'a forcément décidé. Même règle
// que imagesSansAlternative() de lib/references.js, que l'export OJS applique au moment de
// publier ; ici elle se voit pendant la saisie.
function majAlerteAlt(c) {
  if (!c.ctl.alerteAlt) { return; }
  // Carte verrouillée (aucune insertion) : les trois remèdes que le message propose sont
  // hors d'atteinte, et le rendu n'affiche pas l'image. Rien à dire ici.
  var message = '';
  if (c.occurrences > 0) {
    var manque = !decorative(c) && ligne(c.ctl.alt.value) === ''
      && (horsFigure(c) || ligne(c.ctl.legende.value) === '');
    // c.sansAlternative vient de l'hôte, qui a lu TOUTES les insertions : il tombe à
    // l'enregistrement, qui les aligne sur les valeurs de la carte.
    if (manque) { message = TXT.altManquant || ''; }
    else if (c.sansAlternative) { message = TXT.altDivergent || ''; }
  }
  c.ctl.alerteAlt.textContent = message;
  c.ctl.alerteAlt.className = 'alerte-a11y' + (message ? ' visible' : '');
}
function estModifieCarte(c) {
  if (!c.enregistrees) { return false; }
  return JSON.stringify(valeurs(c)) !== JSON.stringify(c.enregistrees);
}
function estModifie() {
  for (var i = 0; i < cartes.length; i++) { if (estModifieCarte(cartes[i])) { return true; } }
  return false;
}
function majModifie() {
  var m = estModifie();
  if (ctl.indic) {
    ctl.indic.textContent = m ? ' ●' : '';
    ctl.indic.title = m ? (TXT.nonEnregistre || '') : '';
  }
  if (m !== dernierModifie) { dernierModifie = m; api.postMessage({ type: 'modifie', modifie: m }); }
}
// Cartes à écrire : celles qui ont au moins une insertion dans le texte, seul endroit où
// une légende et des crédits se rangent.
function medias() {
  var res = [];
  for (var i = 0; i < cartes.length; i++) {
    if (cartes[i].occurrences === 0) { continue; }
    res.push({ relatif: cartes[i].relatif, valeurs: valeurs(cartes[i]) });
  }
  return res;
}

// ---- Fabrique d'une carte ----
function champ(parent, c, cle) {
  var d = texte(parent, 'div', 'champ');
  var id = 'ch-' + cle + '-' + c.index;
  var l = texte(d, 'label', null, TXT[cle] || '');
  l.setAttribute('for', id);
  var i = document.createElement('input');
  i.type = 'text'; i.id = id; i.maxLength = 500;
  i.placeholder = TXT[cle + 'Indice'] || '';
  i.addEventListener('input', function () { etat(''); majAlerteAlt(c); majModifie(); });
  d.appendChild(i);
  c.ctl[cle] = i;
  return d;
}
function radioRole(parent, c, libelle, sous) {
  var l = texte(parent, 'label', 'opt');
  var i = document.createElement('input');
  i.type = 'radio'; i.name = 'role-alt-' + c.index;
  i.addEventListener('change', function () {
    if (i.checked) { etat(''); majRole(c); majModifie(); }
  });
  l.appendChild(i);
  var t = texte(l, 'span', 'txt');
  texte(t, 'span', null, libelle);
  texte(t, 'span', 'sous', sous);
  return i;
}
function caseHorsFigure(parent, c) {
  var z = texte(parent, 'fieldset', 'zone');
  texte(z, 'legend', null, TXT.horsFigureTitre || '');
  var l = texte(z, 'label', 'opt');
  var i = document.createElement('input');
  i.type = 'checkbox';
  i.addEventListener('change', function () { etat(''); majRole(c); majModifie(); });
  l.appendChild(i);
  var t = texte(l, 'span', 'txt');
  texte(t, 'span', null, TXT.horsFigure || '');
  texte(t, 'span', 'sous', TXT.horsFigureSous || '');
  c.ctl.horsFigure = i;
}

// Encadré orange, ou rien quand la qualité suffit. Le verdict vient de l'hôte
// (lib/qualite-image.js), la webview n'en refait pas le calcul.
function poserQualite(boite, qualite) {
  boite.textContent = '';
  boite.className = 'qualite';
  var q = qualite || {};
  if (q.niveau !== 'insuffisant' && q.niveau !== 'juste') { return; }
  boite.classList.add('visible');
  if (q.niveau === 'insuffisant') { boite.classList.add('insuffisant'); }
  texte(boite, 'span', 'titre', TXT.qualiteTitre || '');
  var prefixe = q.famille === 'portrait' ? 'qualitePortrait' : 'qualite';
  var modele = TXT[prefixe + (q.niveau === 'insuffisant' ? 'Insuffisant' : 'Juste')] || '';
  texte(boite, 'span', null, ' ' + modele
    .split('{0}').join(String(q.mesure === null || q.mesure === undefined ? '?' : q.mesure))
    .split('{1}').join(String(q.min)).split('{2}').join(String(q.conseille)));
}

// Avis d'insertion. Sans insertion, la carte se verrouille : il n'y a nulle part où
// écrire légende et crédits, et le seul geste utile est d'insérer l'image dans le texte.
function poserOcc(c) {
  var b = c.ctl.occ;
  b.className = 'occ';
  b.textContent = '';
  if (c.occurrences === 0) {
    b.textContent = TXT.occZero || '';
    b.className = 'occ visible alerte';
  } else if (c.occurrences > 1) {
    b.textContent = (TXT.occPlusieurs || '').split('{0}').join(String(c.occurrences));
    b.className = 'occ visible info';
  }
  var verrou = c.occurrences === 0;
  ['legende', 'alt', 'copyright', 'source'].forEach(function (k) { if (c.ctl[k]) { c.ctl[k].disabled = verrou; } });
  [c.ctl.roleDecrit, c.ctl.roleDeco, c.ctl.horsFigure].forEach(function (e) { if (e) { e.disabled = verrou; } });
  if (verrou) { majAlerteAlt(c); } else { majRole(c); }
}

function poserEtatMedia(c, message, erreur) {
  if (!c.ctl.etatMedia) { return; }
  c.ctl.etatMedia.textContent = message || '';
  c.ctl.etatMedia.classList.toggle('erreur', !!erreur);
}

// Lit le fichier déposé ou choisi et l'envoie à l'hôte, qui demande confirmation, garde
// le nom du fichier cible et répond media-remplace / media-erreur / media-annulee.
function envoyerFichier(c, f, typeMessage, cle, genre) {
  if (c.element.classList.contains('occupe')) { return; }
  var ext = (String(f.name || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  if (genre.extensions.indexOf(ext) === -1) { poserEtatMedia(c, '⚠ ' + (TXT[genre.format] || ''), true); return; }
  if (f.size > genre.maxi) { poserEtatMedia(c, '⚠ ' + (TXT[genre.poids] || ''), true); return; }
  // Marquée occupée avant la lecture, pas dans son rappel : deux dépôts rapprochés
  // passeraient sinon tous les deux la garde et écriraient deux fois.
  c.element.classList.add('occupe');              // levée par la réponse de l'hôte
  poserEtatMedia(c, '…');
  var lecteur = new FileReader();
  lecteur.onerror = function () {
    c.element.classList.remove('occupe');
    poserEtatMedia(c, '⚠ ' + (TXT[genre.format] || ''), true);
  };
  lecteur.onload = function () {
    var t = String(lecteur.result || '');
    var virgule = t.indexOf(',');
    if (virgule === -1) {
      c.element.classList.remove('occupe');
      poserEtatMedia(c, '⚠ ' + (TXT[genre.format] || ''), true);
      return;
    }
    var msg = { type: typeMessage, nomFichier: f.name, donneesBase64: t.slice(virgule + 1) };
    msg[cle] = c.relatif !== undefined ? c.relatif : c.base;
    api.postMessage(msg);
  };
  lecteur.readAsDataURL(f);
}

function zoneDepot(parent, c, typeMessage, cle, genre) {
  var d = texte(parent, 'div', 'depot');
  texte(d, 'span', null, TXT.deposer || '');
  texte(d, 'span', 'ou', TXT.ou || '');
  var choisir = bouton(TXT.choisirFichier || '', function () { fichier.click(); });
  d.appendChild(choisir);
  var fichier = document.createElement('input');
  fichier.type = 'file';
  fichier.accept = genre.extensions.map(function (e) { return '.' + e; }).join(',');
  fichier.hidden = true;
  d.appendChild(fichier);
  fichier.addEventListener('change', function () {
    if (fichier.files && fichier.files[0]) { envoyerFichier(c, fichier.files[0], typeMessage, cle, genre); }
    fichier.value = '';
  });
  d.addEventListener('dragover', function (e) { e.preventDefault(); d.classList.add('survol'); });
  d.addEventListener('dragleave', function () { d.classList.remove('survol'); });
  d.addEventListener('drop', function (e) {
    e.preventDefault();
    d.classList.remove('survol');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { envoyerFichier(c, f, typeMessage, cle, genre); }
  });
  return d;
}

function poserVisuel(zone, nom, description, apercu) {
  zone.textContent = '';
  if (apercu) {
    var img = document.createElement('img');
    img.src = apercu; img.alt = nom || '';
    zone.appendChild(img);
  } else {
    texte(zone, 'p', 'absent', TXT.apercuAbsent || '');
  }
  texte(zone, 'p', 'nom', nom || '');
  texte(zone, 'p', 'desc', description || '');
}

function carteMedia(media, index) {
  var c = { relatif: String(media.relatif || ''), index: index, ctl: {}, occurrences: Number(media.occurrences) || 0 };
  var s = texte(corps, 'section', 'media');
  s.dataset.relatif = c.relatif;
  s.setAttribute('aria-label', c.relatif);        // une carte par image : les distinguer
  c.element = s;
  var haut = texte(s, 'div', 'haut');
  var visuel = texte(haut, 'div', 'visuel');
  c.ctl.visuel = visuel;
  poserVisuel(visuel, c.relatif, media.description, media.apercu);
  c.ctl.qualite = texte(visuel, 'p', 'qualite');
  poserQualite(c.ctl.qualite, media.qualite);

  var fiche = texte(haut, 'div', 'fiche');
  c.ctl.occ = texte(fiche, 'p', 'occ');
  c.ctl.occ.setAttribute('role', 'status');
  // Deux noms pour un seul visuel : l'hôte l'a vu par l'empreinte du contenu.
  var doublons = Array.isArray(media.doublons) ? media.doublons : [];
  if (doublons.length > 0) {
    texte(fiche, 'p', 'occ visible info',
      (TXT.doublonDe || '').split('{0}').join(doublons.join(', ')));
  }
  c.ctl.alerteAlt = texte(fiche, 'p', 'alerte-a11y');
  c.sansAlternative = !!media.sansAlternative;
  champ(fiche, c, 'legende');
  c.ctl.aideLegende = texte(fiche, 'p', 'aide', TXT.legendeAide || '');
  var z = texte(fiche, 'fieldset', 'zone');
  texte(z, 'legend', null, TXT.roleTitre || '');
  c.ctl.roleDecrit = radioRole(z, c, TXT.roleDecrit, TXT.roleDecritSous);
  c.ctl.roleDeco = radioRole(z, c, TXT.roleDeco, TXT.roleDecoSous);
  champ(fiche, c, 'alt');
  c.ctl.aideAlt = texte(fiche, 'p', 'aide', TXT.altAide || '');
  var deux = texte(fiche, 'div', 'deuxcol');
  champ(deux, c, 'copyright');
  champ(deux, c, 'source');
  caseHorsFigure(fiche, c);

  var actions = texte(s, 'div', 'actions');
  zoneDepot(actions, c, 'remplacer', 'relatif', IMAGE);
  actions.appendChild(bouton(TXT.ouvrir || '', function () {
    api.postMessage({ type: 'ouvrirMedia', relatif: c.relatif });
  }, '', TXT.ouvrirTip));
  // Insérer : offert seulement quand rien ne l'insère, seul état où la carte est muette.
  if (c.occurrences === 0) {
    actions.appendChild(bouton(TXT.inserer || '', function () {
      api.postMessage({ type: 'inserer', relatif: c.relatif, medias: medias() });
    }, 'principal', TXT.insererTip));
  }
  actions.appendChild(bouton(TXT.retirer || '', function () {
    api.postMessage({ type: 'retirer', relatif: c.relatif });
  }, '', TXT.retirerTip));
  c.ctl.etatMedia = texte(actions, 'span', 'media-etat');

  poserValeurs(c, media.valeurs);
  poserOcc(c);
  c.enregistrees = valeurs(c);
  return c;
}

function cartePortrait(portrait, index) {
  var c = { base: String(portrait.base || ''), index: index, ctl: {} };
  var s = texte(corps, 'section', 'portrait');
  s.dataset.base = c.base;
  s.setAttribute('aria-label', portrait.auteur || portrait.nom || c.base);
  c.element = s;
  var visuel = texte(s, 'div', 'visuel');
  c.ctl.visuel = visuel;
  c.nom = portrait.nom || c.base;
  poserVisuel(visuel, c.nom, portrait.description, portrait.apercu);
  var droite = texte(s, 'div', 'droite');
  texte(droite, 'p', 'auteur', portrait.auteur || TXT.portraitOrphelin || '');
  c.ctl.version = texte(droite, 'p', 'version', portrait.version || '');
  c.ctl.qualite = texte(droite, 'p', 'qualite');
  poserQualite(c.ctl.qualite, portrait.qualite);
  choixVersion(droite, c, portrait);
  var actions = texte(droite, 'div', 'actions');
  zoneDepot(actions, c, 'portrait-remplacer', 'base', PORTRAIT);
  c.ctl.etatMedia = texte(actions, 'span', 'media-etat');
  return c;
}

// Les trois versions du portrait, comme dans le formulaire des auteur·e·s : le détourage
// n'est pas toujours le bon choix — un fond clair, une écharpe, des cheveux fins, et il vaut
// mieux garder le fond ou la photo d'origine. Une version absente du disque n'est pas
// offerte ; un portrait qu'aucune fiche ne désigne n'a nulle part où écrire le choix.
function choixVersion(parent, c, portrait) {
  var z = texte(parent, 'fieldset', 'zone');
  texte(z, 'legend', null, TXT.versionTitre || '');
  var dispo = portrait.disponibles || {};
  var libelles = { 'sans-fond': TXT.vSansFond, 'avec-fond': TXT.vAvecFond, original: TXT.vOriginal };
  c.ctl.versions = {};
  ['sans-fond', 'avec-fond', 'original'].forEach(function (v) {
    var l = texte(z, 'label', 'opt');
    var i = document.createElement('input');
    i.type = 'radio';
    i.name = 'version-' + c.index;
    i.checked = portrait.versionActuelle === v;
    i.disabled = !dispo[v] || !portrait.rattache;
    i.addEventListener('change', function () {
      if (!i.checked) { return; }
      c.element.classList.add('occupe');
      poserEtatMedia(c, '…');
      api.postMessage({ type: 'portrait-version', base: c.base, version: v });
    });
    l.appendChild(i);
    var t = texte(l, 'span', 'txt');
    texte(t, 'span', null, libelles[v] || v);
    if (!dispo[v]) { texte(t, 'span', 'sous', TXT.versionAbsente || ''); }
    c.ctl.versions[v] = i;
  });
  if (!portrait.rattache) { texte(z, 'p', 'aide', TXT.portraitOrphelin || ''); }
}

function construireBarre() {
  barre.textContent = '';
  barre.appendChild(bouton(TXT.retour, function () {
    api.postMessage({ type: 'retourArticle', modifie: estModifie(), medias: medias() });
  }, '', TXT.retourTip));
  ctl.enregistrer = bouton(TXT.enregistrer, function () { enregistrer(false); }, 'principal', TXT.enregistrerTip);
  barre.appendChild(ctl.enregistrer);
  ctl.etat = texte(barre, 'span', null, '');
  ctl.etat.id = 'etat';
  ctl.etat.setAttribute('role', 'status');
  ctl.indic = texte(barre, 'span', null, '');
  ctl.indic.id = 'indic';
  ctl.indic.setAttribute('aria-live', 'polite');
}

function rendre(msg) {
  corps.textContent = '';
  cartes = [];
  portraits = [];
  var listeMedias = Array.isArray(msg.medias) ? msg.medias : [];
  var listePortraits = Array.isArray(msg.portraits) ? msg.portraits : [];
  var h = texte(corps, 'h2', null, TXT.sectionImages || '');
  texte(h, 'span', 'compte', '(' + listeMedias.length + ')');
  if (listeMedias.length === 0) {
    texte(corps, 'p', 'rien', TXT.aucuneImage || '');
  } else {
    texte(corps, 'p', 'note', TXT.imagesNote || '');
    for (var i = 0; i < listeMedias.length; i++) { cartes.push(carteMedia(listeMedias[i], i)); }
  }
  var h2 = texte(corps, 'h2', null, TXT.sectionPortraits || '');
  texte(h2, 'span', 'compte', '(' + listePortraits.length + ')');
  if (listePortraits.length === 0) {
    texte(corps, 'p', 'rien', TXT.aucunPortrait || '');
  } else {
    texte(corps, 'p', 'note', TXT.portraitsNote || '');
    for (var j = 0; j < listePortraits.length; j++) { portraits.push(cartePortrait(listePortraits[j], j)); }
  }
  avis.textContent = (TXT.resume || '').split('{0}').join(String(listeMedias.length))
    .split('{1}').join(String(listePortraits.length));
  avis.className = 'avis visible info';
  dernierModifie = false;
  etat('');
  majModifie();
  focaliser(msg.focus);
}

// Ouverture depuis Ctrl+Alt+F : la carte de l'image qui vient d'être insérée passe à
// l'écran et prend le curseur, là où il y a quelque chose à écrire.
function focaliser(relatif) {
  var c = trouverCarte(relatif);
  if (!c) { return; }
  try { c.element.scrollIntoView({ block: 'start' }); } catch (e) { c.element.scrollIntoView(); }
  var cible = c.ctl.legende && !c.ctl.legende.disabled ? c.ctl.legende : c.ctl.alt;
  if (cible && !cible.disabled) { try { cible.focus(); } catch (e) { /* pas focalisable */ } }
}

function trouverCarte(relatif) {
  var r = String(relatif === undefined || relatif === null ? '' : relatif);
  for (var i = 0; i < cartes.length; i++) { if (cartes[i].relatif === r) { return cartes[i]; } }
  return null;
}
function trouverPortrait(base) {
  var b = String(base === undefined || base === null ? '' : base);
  for (var i = 0; i < portraits.length; i++) { if (portraits[i].base === b) { return portraits[i]; } }
  return null;
}

function enregistrer(auto) {
  var liste = medias();
  if (liste.length === 0) { if (!auto) { etat(TXT.rienAEcrire || ''); } return; }
  api.postMessage({ type: 'enregistrer', auto: !!auto, medias: liste });
}
// Ni minuteur ni enregistrement au changement de champ : l'écriture passe par un
// WorkspaceEdit et un doc.save() sur le .md, qui recompile l'article. Reste le filet
// principal, l'écriture quand la webview perd le focus.
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
    if (msg.i18n) { TXT = msg.i18n; construireBarre(); }
    rendre(msg);
    return;
  }
  if (msg.type === 'enregistre') {
    autoEnr.confirme();
    for (var i = 0; i < cartes.length; i++) {
      cartes[i].enregistrees = valeurs(cartes[i]);
      // L'écriture reporte les valeurs de la carte sur toutes les insertions : plus de
      // divergence à signaler.
      cartes[i].sansAlternative = false;
      majAlerteAlt(cartes[i]);
    }
    etat(msg.auto ? '' : (TXT.enregistre || ''));
    majModifie();
    return;
  }
  if (msg.type === 'erreur') { autoEnr.confirme(); etat('⚠ ' + msg.message); return; }
  // Ctrl+Alt+F sur un panneau déjà ouvert : l'hôte ne recharge pas la page — il y perdrait
  // les saisies non écrites — il demande seulement d'amener la carte à l'écran.
  if (msg.type === 'focaliser') { focaliser(msg.relatif); return; }
  // Réponses ciblées : la carte est retrouvée par son chemin relatif, jamais par un
  // sélecteur construit sur une valeur libre. Une réponse pour une carte disparue est
  // ignorée.
  if (msg.type === 'media-remplace' || msg.type === 'media-erreur' || msg.type === 'media-annulee') {
    var c = trouverCarte(msg.relatif);
    if (!c) { return; }
    c.element.classList.remove('occupe');
    if (msg.type === 'media-remplace') {
      poserVisuel(c.ctl.visuel, c.relatif, msg.description, msg.apercu);
      c.ctl.qualite = texte(c.ctl.visuel, 'p', 'qualite');
      poserQualite(c.ctl.qualite, msg.qualite);
      poserEtatMedia(c, TXT.remplacee || '', false);
    } else if (msg.type === 'media-erreur') {
      poserEtatMedia(c, '⚠ ' + (msg.message || '?'), true);
    } else {
      poserEtatMedia(c, '');                       // annulé : la zone est réactivée
    }
    return;
  }
  // Média retiré : la carte quitte la page, et son état modifié avec elle.
  if (msg.type === 'media-retire') {
    var r = trouverCarte(msg.relatif);
    if (!r) { return; }
    r.element.classList.add('retiree');
    cartes = cartes.filter(function (x) { return x !== r; });
    majModifie();
    return;
  }
  if (msg.type === 'portrait-remplace' || msg.type === 'portrait-erreur') {
    var p = trouverPortrait(msg.base);
    if (!p) { return; }
    p.element.classList.remove('occupe');
    if (msg.type === 'portrait-erreur') {
      // Un remplacement annulé arrive sans message : la zone est simplement réactivée.
      poserEtatMedia(p, msg.message ? '⚠ ' + msg.message : '', !!msg.message);
      return;
    }
    p.nom = msg.nom || p.nom || p.base;
    poserVisuel(p.ctl.visuel, p.nom, msg.description, msg.apercu);
    if (p.ctl.version) { p.ctl.version.textContent = msg.version || ''; }
    // La version retenue a pu changer : les radios suivent l'état du disque et de la fiche.
    if (p.ctl.versions && msg.versionActuelle) {
      Object.keys(p.ctl.versions).forEach(function (v) {
        p.ctl.versions[v].checked = (v === msg.versionActuelle);
      });
    }
    poserQualite(p.ctl.qualite, msg.qualite);
    poserEtatMedia(p, TXT.remplacee || '', false);
    return;
  }
});
SZH.annoncerPret(api, function () { return recu; });
})();
