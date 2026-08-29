(function () {
'use strict';
// Gestionnaire des médias d'un article : une carte par FIGURE — une image seule, ou toutes
// les images d'une même grille — repliée sur ses seuls aperçus. En pied, les portraits des
// auteur·e·s, qui ne sont pas des figures : on n'y juge que la qualité, on y choisit la
// version retenue, et on les remplace.
//
// Ce que la disposition dit. Une figure ouverte est longue à parcourir, et la plupart du
// temps on ne regarde qu'une image parmi d'autres : la carte reste donc courte par défaut,
// réduite à la rangée d'aperçus et à l'ajout d'une image à côté. Cliquer sur un aperçu
// déplie SON formulaire sous la rangée — jamais un formulaire par image empilé, jamais deux
// ouverts à la fois dans la même figure — et le marque des deux côtés : un filet d'accent
// sur l'aperçu, et un autre sur le bord gauche du formulaire qu'il commande. Une figure de
// plusieurs images porte en plus un accordéon, replié lui aussi : les réglages qui valent
// pour le groupe entier — disposition, légende de la figure — n'ont pas leur place dans le
// formulaire d'une image parmi d'autres. Ce qui ne change pas avec le pli : l'état d'une
// image — jamais insérée, basse résolution, muette, doublon — se lit sur son aperçu sans
// rien déplier, parce qu'un défaut caché derrière un pli est un défaut qu'on ne corrige
// jamais.
//
// Mêmes règles que les autres webviews : aucune donnée dans le HTML, tout arrive par
// postMessage, page construite en DOM sans innerHTML. Les aperçus sont des data: URI
// fournies par l'hôte, d'où le img-src data: de la CSP.
//
// Les auteur·e·s sont affichés et édités par SZH.auteurs (media/_auteurs.js), le même
// composant que le formulaire des métadonnées : la fiche, la modale, le dépôt de photo et
// le choix de version n'existent qu'une fois. Cette vue n'apporte que l'écriture, immédiate
// ici puisqu'il n'y a pas de carte d'article à enregistrer.
//
// Une grille est une figure faite de plusieurs images : un numéro, une légende, un bloc. Sa
// légende n'appartient qu'à l'ancre — la première image — et vit dans l'accordéon du
// groupe ; les autres membres n'ont pas de champ légende du tout, et rendent au moment
// d'enregistrer la valeur reçue de l'hôte, telle quelle.
//
// Protocole. Vers l'hôte :
//   pret ; modifie { modifie } ; enregistrer { auto, medias } ;
//   retourArticle { modifie, medias } ; retirer { relatif, medias } ;
//   remplacer { relatif, nomFichier, donneesBase64 } ; inserer { relatif, medias } ;
//   grille-ajouter { relatif, ajout, medias } ; grille-retirer { relatif, medias } ;
//   grille-disposition { relatif, disposition, medias } ;
//   auteur-enregistrer { slug, index, auteur, photoAttendue }
//   plus les messages photo-* de _auteurs.js
// Depuis l'hôte :
//   charger { slug, medias, grilles, grilleMax, grilleAuto, dispositions, portraits,
//             focus, accent, i18n } ; enregistre { auto } ;
//   erreur { message } ; focaliser { relatif } ;
//   media-remplace { relatif, description, apercu, qualite } ;
//   media-erreur { relatif, message } ; media-annulee { relatif } ;
//   media-retire { relatif } ;
//   auteur-enregistre { slug, index, auteur, portrait } ;
//   auteur-erreur { slug, index, message }
// où un média vaut { relatif, description, apercu, occurrences, qualite, doublons,
// sansAlternative, largeur, hauteur, grille, rangGrille, valeurs } et valeurs =
// { legende, alt, altDefini, copyright, source, horsFigure } ; une grille
// { disposition, auto, membres } ; et un portrait { base, index, nom, auteur, auteurFiche,
// version, description, apercu, qualite, rattache }.
var api = acquireVsCodeApi();
// Mêmes plafonds et mêmes formats que l'hôte, qui recontrôle tout : ici, c'est pour
// répondre tout de suite plutôt que d'envoyer 50 Mo pour rien.
var IMAGE = {
  maxi: 50 * 1024 * 1024, extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'],
  format: 'errFormat', poids: 'errTropVolumineuse'
};
var TXT = {}, ctl = {}, cartes = [], figures = [], portraits = [], dernierModifie = false;
// Les grilles de l'article, telles que l'hôte les a lues dans le .md, et ce qu'il permet
// d'en faire. Rien n'est recalculé ici : les cartes portent l'indice de leur grille, la
// disposition automatique est celle que le rendu choisira, et le formulaire ne fait que
// les montrer.
var grilles = [], DISPOSITIONS = {}, GRILLE_MAX = 6, AUTO = 'auto';
var barre = document.getElementById('barre');
var corps = document.getElementById('corps');
var modale = null;

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
function etat(msg) { if (ctl.etat) { ctl.etat.textContent = msg || ''; } }
// Écriture immédiate : cette vue n'a pas de carte d'article à enregistrer, et la fiche
// d'auteur·e n'a donc nulle part où attendre. L'hôte confirme, ou dit pourquoi il refuse.
var attenteAuteur = null;
var ctlAuteurs = null;
function creerCtlAuteurs() {
  return SZH.auteurs({
    api: api, txt: TXT,
    // Ce panneau sait agrandir une image : c'est son métier de la juger, et une pastille
    // de trois rem ne suffit pas à décider si un portrait tient la page.
    surApercu: function (uri, nom) { ouvrirModale(uri, nom); },
    persister: function (fiche, auteur, fini) {
      attenteAuteur = { index: fiche.index, fini: fini };
      api.postMessage({
        type: 'auteur-enregistrer', slug: fiche.slug, index: fiche.index, auteur: auteur,
        // Témoin d'identité : l'hôte refuse d'écrire si ce rang ne porte plus cette photo.
        photoAttendue: (fiche.auteur || {}).photo || ''
      });
    }
  });
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
// Un membre de grille sans champ légende (tous, sauf l'ancre) n'a rien à relire : on rend
// la valeur reçue de l'hôte, mémorisée à la construction. Sans cela une légende parasite
// resterait sur une image suivante et serait effacée au premier enregistrement, en silence.
function legendeDe(c) {
  return c.ctl.legende ? (horsFigure(c) ? '' : ligne(c.ctl.legende.value)) : c.legendeFigee;
}
function valeurs(c) {
  var alt = decorative(c) ? '' : ligne(c.ctl.alt.value);
  return {
    legende: legendeDe(c),
    alt: alt, altDefini: decorative(c) || alt !== '',
    copyright: ligne(c.ctl.copyright.value),
    source: ligne(c.ctl.source.value),
    horsFigure: horsFigure(c)
  };
}
function poserValeurs(c, v) {
  v = v || {};
  if (c.ctl.legende) { c.ctl.legende.value = String(v.legende || ''); }
  var deco = !!v.altDefini && String(v.alt || '') === '';
  c.ctl.roleDeco.checked = deco;
  c.ctl.roleDecrit.checked = !deco;
  c.ctl.alt.value = deco ? '' : String(v.alt || '');
  c.ctl.copyright.value = String(v.copyright || '');
  c.ctl.source.value = String(v.source || '');
  // « Sans légende ni numéro » n'a pas de sens dans une grille : c'est la figure entière
  // qui porte le numéro, et l'image n'a pas de légende propre à supprimer. La case est
  // décochée d'office, et le prochain enregistrement ôtera la classe du .md.
  c.ctl.horsFigure.checked = !!v.horsFigure && c.grille === null;
}
function majRole(c) {
  if (!c.ctl.alt) { return; }
  var verrou = c.occurrences === 0;
  c.ctl.alt.disabled = verrou || decorative(c);
  // Un membre de grille n'a pas de champ légende : rien à verrouiller.
  if (c.ctl.legende) { c.ctl.legende.disabled = verrou || horsFigure(c); }
  majAlerteAlt(c);
  majPastilles(c);
}

// Ni texte alternatif, ni légende sur laquelle retomber, et pas déclarée décorative : le
// rendu la traitera en image décorative, ce que personne n'a forcément décidé. Même règle
// que imagesSansAlternative() de lib/references.js, que l'export OJS applique au moment de
// publier ; ici elle se voit pendant la saisie.
// Fonction pure : le formulaire (texte complet) et la pastille (juste sa présence) lisent
// tous deux ce message, pour ne jamais diverger.
function messageAlerteAlt(c) {
  // Carte verrouillée (aucune insertion) : les trois remèdes que le message propose sont
  // hors d'atteinte, et le rendu n'affiche pas l'image. Rien à dire ici.
  if (c.occurrences === 0) { return ''; }
  var manque = !decorative(c) && ligne(c.ctl.alt.value) === ''
    && (horsFigure(c) || legendeDe(c) === '');
  if (manque) { return TXT.altManquant || ''; }
  // c.sansAlternative vient de l'hôte, qui a lu TOUTES les insertions : il tombe à
  // l'enregistrement, qui les aligne sur les valeurs de la carte.
  if (c.sansAlternative) { return TXT.altDivergent || ''; }
  return '';
}
function majAlerteAlt(c) {
  if (!c.ctl.alerteAlt) { return; }
  var message = messageAlerteAlt(c);
  c.ctl.alerteAlt.textContent = '';
  c.ctl.alerteAlt.hidden = message === '';
  if (message !== '') {
    c.ctl.alerteAlt.appendChild(SZH.icone('danger'));
    texte(c.ctl.alerteAlt, 'span', null, message);
  }
}

// Verdict de qualité, sous l'image qu'il juge : il vient de l'hôte (lib/qualite-image.js),
// la webview n'en refait pas le calcul.
function messageQualite(q) {
  q = q || {};
  if (q.niveau !== 'insuffisant' && q.niveau !== 'juste') { return ''; }
  var prefixe = q.famille === 'portrait' ? 'qualitePortrait' : 'qualite';
  var forme = TXT[prefixe + (q.niveau === 'insuffisant' ? 'Insuffisant' : 'Juste')] || '';
  return forme
    .split('{0}').join(String(q.mesure === null || q.mesure === undefined ? '?' : q.mesure))
    .split('{1}').join(String(q.min)).split('{2}').join(String(q.conseille));
}
function poserQualite(boite, qualite) {
  boite.textContent = '';
  var q = qualite || {};
  // Le ton est reposé à chaque verdict : après un remplacement réussi, la classe
  // « attention » du fichier précédent ne doit pas rester accrochée à la boîte.
  if (q.niveau !== 'insuffisant' && q.niveau !== 'juste') {
    boite.className = 'szh-notif';
    boite.hidden = true;
    return;
  }
  boite.hidden = false;
  boite.className = 'szh-notif szh-notif--attention';
  boite.appendChild(SZH.icone('attention'));
  texte(boite, 'span', null, messageQualite(q));
}

// Pastilles d'état : deux conteneurs identiques, la vignette repliée et l'en-tête du
// formulaire déplié, pour que ce qui cloche se voie même sans rien ouvrir.
function remplirPastilles(zone, c) {
  zone.textContent = '';
  if (c.occurrences === 0) {
    texte(zone, 'span', 'szh-pastille szh-pastille--attention', TXT.etatJamais || '');
  } else if (c.occurrences > 1) {
    texte(zone, 'span', 'szh-pastille szh-pastille--accent', remplir('etatInsertions', [c.occurrences]));
  }
  if (horsFigure(c)) { texte(zone, 'span', 'szh-pastille', TXT.etatHorsFigure || ''); }
  if (c.qualite && (c.qualite.niveau === 'insuffisant' || c.qualite.niveau === 'juste')) {
    var p = texte(zone, 'span', 'szh-pastille szh-pastille--attention', TXT.etatBasse || '');
    p.title = messageQualite(c.qualite);
  }
  if (messageAlerteAlt(c) !== '') {
    texte(zone, 'span', 'szh-pastille szh-pastille--danger', TXT.etatMuette || '');
  }
  if (c.doublons.length > 0) {
    texte(zone, 'span', 'szh-pastille szh-pastille--attention', TXT.etatDoublon || '');
  }
}
function majPastilles(c) {
  if (c.ctl.pastilles) { remplirPastilles(c.ctl.pastilles, c); }
  if (c.ctl.pastillesVignette) { remplirPastilles(c.ctl.pastillesVignette, c); }
  majDoublon(c);
}

// Deux noms pour un seul visuel : l'hôte l'a vu par l'empreinte du contenu. Le nom du
// jumeau est écrit dans la carte, et non porté par l'infobulle d'une pastille : au clavier
// comme au lecteur d'écran, un title sur un span n'est jamais lu, et sans le nom on ne
// peut pas agir.
function majDoublon(c) {
  var b = c.ctl.doublon;
  if (!b) { return; }
  b.textContent = '';
  b.hidden = c.doublons.length === 0;
  if (b.hidden) { return; }
  b.className = 'szh-notif szh-notif--attention';
  b.appendChild(SZH.icone('attention'));
  texte(b, 'span', null, remplir('doublonDe', [c.doublons.join(', ')]));
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
    ctl.indic.textContent = m ? '●' : '';
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

// ---- Briques d'un formulaire ----
// `libelle` remplace l'intitulé par défaut : la légende d'une grille est celle de la
// figure entière, et l'intitulé doit le dire là où le champ ne le dirait pas.
function champ(parent, c, cle, libelle) {
  var d = texte(parent, 'div', 'szh-champ');
  var id = 'ch-' + cle + '-' + c.index;
  var l = texte(d, 'label', null, libelle || TXT[cle] || '');
  l.setAttribute('for', id);
  var i = document.createElement('input');
  i.type = 'text'; i.id = id; i.maxLength = 500;
  i.placeholder = TXT[cle + 'Indice'] || '';
  i.addEventListener('input', function () { etat(''); majAlerteAlt(c); majPastilles(c); majModifie(); });
  d.appendChild(i);
  c.ctl[cle] = i;
  return d;
}
function radioRole(parent, c, libelle) {
  var l = texte(parent, 'label', 'szh-opt');
  var i = document.createElement('input');
  i.type = 'radio'; i.name = 'role-alt-' + c.index;
  i.addEventListener('change', function () {
    if (i.checked) { etat(''); majRole(c); majModifie(); }
  });
  l.appendChild(i);
  texte(l, 'span', 'txt', libelle);
  return i;
}
function caseHorsFigure(parent, c) {
  var z = texte(parent, 'fieldset', 'szh-groupe');
  texte(z, 'legend', null, TXT.horsFigureTitre || '');
  var l = texte(z, 'label', 'szh-opt');
  var i = document.createElement('input');
  i.type = 'checkbox';
  i.addEventListener('change', function () { etat(''); majRole(c); majModifie(); });
  l.appendChild(i);
  texte(l, 'span', 'txt', TXT.horsFigure || '');
  c.ctl.horsFigure = i;
}

// La carte porte deux zones de dépôt — remplacer, et ajouter à côté — et la réponse doit
// s'afficher dans celle d'où le fichier est parti : un « format non pris en charge » sous
// l'autre zone se lirait comme un reproche adressé au mauvais geste.
function poserEtatMedia(c, message, erreur) {
  var cible = c.ctl.zoneActive || c.ctl.etatMedia;
  if (!cible) { return; }
  for (var i = 0; i < (c.ctl.etatsMedia || []).length; i++) {
    c.ctl.etatsMedia[i].textContent = '';
    c.ctl.etatsMedia[i].className = 'media-etat';
  }
  cible.textContent = message || '';
  cible.className = 'media-etat' + (erreur ? ' erreur' : '');
}

// Lit le fichier déposé ou choisi et l'envoie à l'hôte, qui demande confirmation, garde
// le nom du fichier cible et répond media-remplace / media-erreur / media-annulee.
// Un seul geste de fichier à la fois PAR FIGURE : la classe .occupe va sur la carte de
// figure entière, qui porte les deux zones de dépôt de tous ses membres.
function envoyerFichier(c, f, typeMessage, cle, genre, extra, zone) {
  if (c.figure.element.classList.contains('occupe')) { return; }
  c.ctl.zoneActive = zone || null;                 // là où la réponse s'affichera
  var ext = (String(f.name || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  if (genre.extensions.indexOf(ext) === -1) { poserEtatMedia(c, '⚠ ' + (TXT[genre.format] || ''), true); return; }
  if (f.size > genre.maxi) { poserEtatMedia(c, '⚠ ' + (TXT[genre.poids] || ''), true); return; }
  // Marquée occupée avant la lecture, pas dans son rappel : deux dépôts rapprochés
  // passeraient sinon tous les deux la garde et écriraient deux fois.
  c.figure.element.classList.add('occupe');        // levée par la réponse de l'hôte
  poserEtatMedia(c, '…');
  var lecteur = new FileReader();
  lecteur.onerror = function () {
    c.figure.element.classList.remove('occupe');
    poserEtatMedia(c, '⚠ ' + (TXT[genre.format] || ''), true);
  };
  lecteur.onload = function () {
    var t = String(lecteur.result || '');
    var virgule = t.indexOf(',');
    if (virgule === -1) {
      c.figure.element.classList.remove('occupe');
      poserEtatMedia(c, '⚠ ' + (TXT[genre.format] || ''), true);
      return;
    }
    var msg = { type: typeMessage, nomFichier: f.name, donneesBase64: t.slice(virgule + 1) };
    msg[cle] = c.relatif !== undefined ? c.relatif : c.base;
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) { msg[k] = extra[k]; } } }
    api.postMessage(msg);
  };
  lecteur.readAsDataURL(f);
}

// Le dépôt vient juste sous l'image, après le verdict de qualité : on regarde le fichier,
// on lit ce qui lui manque, on le remplace. Un intitulé court suffit à cette place.
// `o` = { type, cle, genre, libelle, icone, tip, extra } ; `extra` (une fonction) ajoute
// des champs au message au moment du dépôt — c'est par là qu'un « ajouter à côté » emporte
// les saisies en cours, qu'une réécriture du .md écraserait sinon.
function zoneDepot(parent, c, o) {
  var d = texte(parent, 'div', 'depot');
  if (o.tip) { d.title = o.tip; }
  var titre = texte(d, 'span', 'depot-titre');
  titre.appendChild(SZH.icone(o.icone || 'camera'));
  texte(titre, 'span', null, o.libelle || '');
  var envoyer = function (f) {
    // Un dépôt sur une zone que son état refuse doit dire pourquoi, à cet endroit-là :
    // l'infobulle du cadre ne se lit pas quand on vient de lâcher un fichier dessus.
    var refus = o.refus ? o.refus() : '';
    if (refus) {
      c.ctl.zoneActive = etat;
      poserEtatMedia(c, '⚠ ' + refus, true);
      return;
    }
    envoyerFichier(c, f, o.type, o.cle, o.genre, o.extra ? o.extra() : null, etat);
  };
  var choisir = bouton(TXT.choisirFichier || '', function () { fichier.click(); });
  d.appendChild(choisir);
  var fichier = document.createElement('input');
  fichier.type = 'file';
  fichier.accept = o.genre.extensions.map(function (e) { return '.' + e; }).join(',');
  fichier.hidden = true;
  d.appendChild(fichier);
  fichier.addEventListener('change', function () {
    if (fichier.files && fichier.files[0]) { envoyer(fichier.files[0]); }
    fichier.value = '';
  });
  d.addEventListener('dragover', function (e) { e.preventDefault(); d.classList.add('survol'); });
  d.addEventListener('dragleave', function () { d.classList.remove('survol'); });
  d.addEventListener('drop', function (e) {
    e.preventDefault();
    d.classList.remove('survol');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { envoyer(f); }
  });
  var etat = texte(d, 'span', 'media-etat');
  if (!c.ctl.etatsMedia) { c.ctl.etatsMedia = []; }
  c.ctl.etatsMedia.push(etat);
  if (!c.ctl.etatMedia) { c.ctl.etatMedia = etat; }   // repli : la première zone posée
  d.etat = etat;
  d.boutonChoisir = choisir;
  return d;
}

// L'aperçu d'une vignette : image, ou constat qu'il n'y en a pas. Contrairement à l'ancien
// aperçu de carte, un clic ne l'agrandit plus — le clic de la vignette sert au pli — d'où un
// simple span, jamais un bouton imbriqué dans le bouton .vignette.
function poserVignetteImage(zone, apercu) {
  zone.textContent = '';
  if (!apercu) {
    texte(zone, 'span', 'absent', TXT.apercuAbsent || '');
    return;
  }
  var img = document.createElement('img');
  img.src = apercu;
  img.alt = '';                                    // le nom est redit juste à côté, en texte
  zone.appendChild(img);
}

// L'aperçu des portraits, lui, reste un bouton agrandissant : ce n'est pas une figure, et
// il n'y a pas de pli à gérer autour de lui.
function poserVisuel(zone, nom, apercu) {
  zone.textContent = '';
  if (!apercu) {
    texte(zone, 'p', 'absent', TXT.apercuAbsent || '');
    return;
  }
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'apercu';
  b.title = TXT.agrandir || '';
  b.setAttribute('aria-label', TXT.agrandir || '');
  var img = document.createElement('img');
  img.src = apercu;
  img.alt = nom || '';
  b.appendChild(img);
  b.addEventListener('click', function () { ouvrirModale(apercu, nom); });
  zone.appendChild(b);
}

// ---- Modale d'aperçu ----
// L'aperçu du formulaire est petit par nécessité : c'est là qu'on juge une image, et il faut
// pouvoir la voir en grand sans quitter le formulaire.
function ouvrirModale(apercu, nom) {
  if (!modale) { return; }
  // D'où l'on vient : le bouton d'aperçu disparaît du flux quand la modale se ferme, et
  // sans cela le clavier repartirait du haut du formulaire.
  modale.retour = document.activeElement || null;
  modale.img.src = apercu;
  modale.img.alt = nom || '';
  modale.nom.textContent = nom || '';
  modale.element.classList.add('visible');
  try { modale.fermer.focus(); } catch (e) { /* pas focalisable */ }
}
function fermerModale() {
  if (!modale) { return; }
  modale.element.classList.remove('visible');
  modale.img.removeAttribute('src');
  if (modale.retour) {
    try { modale.retour.focus(); } catch (e) { /* élément disparu entre-temps */ }
    modale.retour = null;
  }
}
function construireModale() {
  var d = texte(document.body, 'div', 'szh-modale');
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-modal', 'true');
  var boite = texte(d, 'div', 'szh-modale-boite');
  var img = document.createElement('img');
  boite.appendChild(img);
  var pied = texte(boite, 'div', 'szh-modale-pied');
  var nom = texte(pied, 'span', 'modale-nom');
  texte(pied, 'span', 'szh-pousse');
  var fermer = bouton(TXT.fermer || '', fermerModale, 'szh-bouton--principal');
  pied.appendChild(fermer);
  // Cliquer à côté de l'image referme, comme dans toute visionneuse.
  d.addEventListener('click', function (ev) { if (ev.target === d) { fermerModale(); } });
  modale = { element: d, img: img, nom: nom, fermer: fermer, retour: null };
}

// ---- Grilles ----
// Une disposition est une suite de rangées : « 2-2 » = deux rangées de deux. Le libellé se
// déduit de la forme plutôt que d'une clé par cas — seize dispositions feraient seize
// libellés à traduire, et le jour où la table en gagne une, sa ligne manquerait.
function libelleDisposition(code) {
  var r = String(code).split('-').map(Number);
  if (r.length === 1) { return remplir('dispositionLigne', [r[0]]); }
  var premier = r[0];
  var tousUn = true, tousEgaux = true;
  for (var i = 0; i < r.length; i++) {
    if (r[i] !== 1) { tousUn = false; }
    if (r[i] !== premier) { tousEgaux = false; }
  }
  if (tousUn) { return remplir('dispositionPile', [r.length]); }
  if (tousEgaux) { return remplir('dispositionTableau', [r.length, premier]); }
  return remplir('dispositionRangees', [r.join(' + ')]);
}
function option(sel, valeur, libelle) {
  var o = document.createElement('option');
  o.value = valeur;
  o.textContent = libelle;
  sel.appendChild(o);
  return o;
}
function grilleDe(c) {
  return (c.grille === null || c.grille === undefined) ? null : (grilles[c.grille] || null);
}

// Les images qu'on peut mettre à côté de celle-ci : celles qui ne sont pas déjà dans une
// grille et qui ne sont pas insérées plusieurs fois. Une image insérée deux fois n'est pas
// candidate parce que rien ne dirait laquelle de ses insertions doit être déplacée.
function candidates(c) {
  var res = [];
  for (var i = 0; i < cartes.length; i++) {
    var a = cartes[i];
    if (a === c || grilleDe(a) || a.occurrences > 1) { continue; }
    res.push(a);
  }
  return res;
}

// La seconde zone de dépôt, sous celle qui remplace, et volontairement de la même forme :
// deux gestes voisins, deux cadres voisins, et c'est le titre qui les distingue. Elle
// accepte un fichier venu du disque — ce que le choix parmi les images de l'article ne
// permettait pas — et garde ce choix-là en second bouton, parce qu'après un import Word
// les images à ranger côte à côte sont déjà toutes dans l'article.
//
// Une seule par figure, posée sous .figure-vignettes, ancrée sur l'ANCRE de la figure —
// c'est correct : poserDansGrille() ajoute en queue de la grille quelle que soit l'ancre.
//
// Ce que le dépôt NE fait pas : écraser. Le fichier entre sous un nom neuf, et l'hôte
// demande confirmation avant d'écrire quoi que ce soit.
function zoneACote(parent, c) {
  var d = zoneDepot(parent, c, {
    type: 'ajouter-a-cote', cle: 'relatif', genre: IMAGE, icone: 'plus',
    libelle: TXT.grilleDeposer || '', tip: TXT.grilleDeposerTip || '',
    // Les saisies en cours voyagent avec le fichier : la pose réécrit le .md et recharge
    // le formulaire, qui les perdrait.
    extra: function () { return { medias: medias() }; },
    refus: function () { return empechementGrille(c); }
  });
  d.classList.add('depot-acote');
  var article = bouton(TXT.grilleDeposerArticle || '', function () { ouvrirChoixGrille(c); });
  d.insertBefore(article, d.etat);

  // Le choix parmi les images de l'article, déplié sous la zone : une modale de plus,
  // pour une liste de cinq noms, coûterait plus qu'elle ne rapporte.
  var choix = texte(d, 'div', 'grille-choix');
  choix.hidden = true;
  var id = 'grille-ajout-' + c.index;
  var l = texte(choix, 'label', null, TXT.grilleChoisir || '');
  l.setAttribute('for', id);
  var sel = document.createElement('select');
  sel.id = id;
  choix.appendChild(sel);
  var actions = texte(choix, 'div', 'grille-choix-actions');
  actions.appendChild(bouton(TXT.grilleValider || '', function () {
    if (sel.value === '') { return; }
    api.postMessage({ type: 'grille-ajouter', relatif: c.relatif, ajout: sel.value,
                      medias: medias() });
  }, 'szh-bouton--principal'));
  actions.appendChild(bouton(TXT.grilleAnnuler || '', function () {
    choix.hidden = true;
    try { article.focus(); } catch (e) { /* pas focalisable */ }
  }));
  c.ctl.grilleZone = d;
  c.ctl.grilleArticle = article;
  c.ctl.grilleChoix = choix;
  c.ctl.grilleSelect = sel;
  return d;
}
function ouvrirChoixGrille(c) {
  var sel = c.ctl.grilleSelect;
  sel.textContent = '';
  var liste = candidates(c);
  for (var i = 0; i < liste.length; i++) {
    option(sel, liste[i].relatif, remplir(
      liste[i].occurrences === 0 ? 'grilleCandidateJamais' : 'grilleCandidateDeplacee',
      [liste[i].relatif]));
  }
  c.ctl.grilleChoix.hidden = false;
  try { sel.focus(); } catch (e) { /* pas focalisable */ }
}

// Ce qui empêche d'ajouter une voisine se dit sur la zone elle-même : sans cela le dépôt
// se ferait, l'hôte refuserait, et rien n'aurait prévenu. Deux empêchements seulement
// portent sur le fichier déposé — image jamais insérée, grille pleine ; le troisième
// (aucune autre image de l'article) ne concerne que le second bouton.
function empechementGrille(c) {
  var g = grilleDe(c);
  // Jamais insérée : il n'y a pas de figure autour de laquelle bâtir la grille.
  if (c.occurrences === 0) { return TXT.grilleHorsTexte || ''; }
  if (g && g.membres.length >= GRILLE_MAX) { return TXT.grillePleine || ''; }
  return '';
}
function majAjoutGrille(c) {
  var d = c.ctl.grilleZone;
  if (!d) { return; }
  var empeche = empechementGrille(c);
  d.classList.toggle('depot--refuse', empeche !== '');
  d.title = empeche || (TXT.grilleDeposerTip || '');
  if (d.boutonChoisir) { d.boutonChoisir.disabled = empeche !== ''; }
  if (c.ctl.grilleArticle) {
    var sansCandidate = candidates(c).length === 0;
    c.ctl.grilleArticle.disabled = empeche !== '' || sansCandidate;
    c.ctl.grilleArticle.title = empeche || (sansCandidate ? (TXT.grilleAucune || '') : '');
  }
  if (empeche !== '') { c.ctl.grilleChoix.hidden = true; }
}

// ---- Figures ----
// Regroupement, dans l'ordre de msg.medias — l'hôte trie déjà. Les membres d'une grille ne
// sont pas forcément contigus dans la liste : on les ramasse par indice de grille, pas par
// position, et on les trie par rangGrille pour que l'ancre (rangGrille 0) soit toujours en
// tête.
function regrouperFigures(listeMedias) {
  var figs = [], vues = {};
  for (var i = 0; i < listeMedias.length; i++) {
    var m = listeMedias[i];
    var g = (m.grille === null || m.grille === undefined) ? null : Number(m.grille);
    if (g === null) { figs.push({ grille: null, membresIdx: [i] }); continue; }
    if (vues[g]) { continue; }
    vues[g] = true;
    var membresIdx = [];
    for (var j = 0; j < listeMedias.length; j++) {
      var gj = (listeMedias[j].grille === null || listeMedias[j].grille === undefined)
        ? null : Number(listeMedias[j].grille);
      if (gj === g) { membresIdx.push(j); }
    }
    membresIdx.sort(function (a, b) {
      return (Number(listeMedias[a].rangGrille) || 0) - (Number(listeMedias[b].rangGrille) || 0);
    });
    figs.push({ grille: g, membresIdx: membresIdx });
  }
  return figs;
}

// L'état d'une image, sans DOM : le squelette que la vignette et le formulaire remplissent
// chacun de leur côté.
function nouvelleCarte(media, index, figure) {
  return {
    relatif: String(media.relatif || ''), index: index, ctl: {}, figure: figure,
    occurrences: Number(media.occurrences) || 0,
    doublons: Array.isArray(media.doublons) ? media.doublons : [],
    sansAlternative: !!media.sansAlternative,
    grille: (media.grille === null || media.grille === undefined) ? null : Number(media.grille),
    rangGrille: Number(media.rangGrille) >= 0 ? Number(media.rangGrille) : -1,
    description: media.description || '', apercu: media.apercu || null,
    // Verdict retenu pour que la pastille et le formulaire disent la même chose ; rafraîchi
    // par media-remplace.
    qualite: media.qualite || {},
    legendeFigee: String((media.valeurs || {}).legende || ''),
    valeursInitiales: media.valeurs || {}
  };
}

// L'aperçu cliquable : un seul geste, plier/déplier son formulaire. L'agrandissement est
// déplacé dans l'en-tête du formulaire (icône oeil), sans quoi un clic ferait deux choses à
// la fois.
function construireVignette(parent, c) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'vignette';
  b.dataset.relatif = c.relatif;
  b.setAttribute('aria-expanded', 'false');
  b.setAttribute('aria-controls', 'mf-' + c.index);
  b.title = remplir('formOuvrir', [c.relatif]);
  c.ctl.vignetteImage = texte(b, 'span', 'vignette-image');
  poserVignetteImage(c.ctl.vignetteImage, c.apercu);
  var nomLigne = texte(b, 'div', 'vignette-nom-ligne');
  c.ctl.vignetteNom = texte(nomLigne, 'span', 'vignette-nom', c.relatif);
  nomLigne.appendChild(SZH.icone('chevron'));
  c.ctl.pastillesVignette = texte(b, 'span', 'vignette-etat');
  b.addEventListener('click', function () { basculerForm(c.figure, c); });
  c.ctl.vignette = b;
  parent.appendChild(b);
}

// Un clic ouvre le formulaire de CETTE image et ferme celui de toutes les autres images de
// la MÊME figure ; un clic sur la vignette déjà ouverte referme (bascule). Les autres
// cartes de figure ne sont pas touchées.
function basculerForm(figure, c) {
  var ferme = figure.ouvert === c;
  for (var i = 0; i < figure.membres.length; i++) {
    var m = figure.membres[i], actif = !ferme && m === c;
    m.ctl.form.hidden = !actif;
    m.ctl.vignette.setAttribute('aria-expanded', actif ? 'true' : 'false');
    m.ctl.vignette.classList.toggle('vignette--ouverte', actif);
    m.ctl.vignette.title = remplir(actif ? 'formFermer' : 'formOuvrir', [m.relatif]);
  }
  figure.ouvert = ferme ? null : c;
}

// L'accordéon du groupe : les réglages qui valent pour la figure entière — disposition,
// légende — et rien d'autre. Un seul par figure de plusieurs images, jamais un par image.
function construireGroupeAccordeon(parent, figure) {
  var g = grilleDe(figure.ancre);
  if (!g) { return; }
  var z = texte(parent, 'div', 'figure-groupe');
  var idCorps = 'gc-' + figure.ancre.index;

  var tete = document.createElement('button');
  tete.type = 'button';
  tete.className = 'groupe-tete';
  tete.setAttribute('aria-expanded', 'false');
  tete.setAttribute('aria-controls', idCorps);
  tete.appendChild(SZH.icone('chevron'));
  texte(tete, 'span', null, TXT.grilleSection || '');
  var legendeTete = texte(tete, 'span', 'grille-legende-tete');
  var legendeValeur = figure.ancre.valeursInitiales.legende || '';
  legendeTete.textContent = ligne(legendeValeur) || (TXT.grilleLegendeAbsente || '');
  z.appendChild(tete);

  var corpsAcc = texte(z, 'div', 'groupe-corps');
  corpsAcc.id = idCorps;
  corpsAcc.hidden = true;

  texte(corpsAcc, 'p', 'grille-membres',
    remplir('grilleMembres', [g.membres.length, g.membres.join(' · ')]));

  var dispo = texte(corpsAcc, 'div', 'szh-champ');
  var idDisp = 'grille-disp-' + figure.ancre.index;
  var lDisp = texte(dispo, 'label', null, TXT.grilleDisposition || '');
  lDisp.setAttribute('for', idDisp);
  var sel = document.createElement('select');
  sel.id = idDisp;
  sel.title = TXT.grilleDispositionTip || '';
  // « Automatique » nomme ce qu'il choisirait : un mode dont on ne voit pas le résultat
  // ne se choisit pas de confiance. La valeur vient de l'hôte, qui a mesuré les fichiers.
  option(sel, AUTO, g.auto ? remplir('dispositionAuto', [libelleDisposition(g.auto)])
                           : (TXT.dispositionAutoSimple || ''));
  var codes = DISPOSITIONS[g.membres.length] || [];
  for (var i = 0; i < codes.length; i++) { option(sel, codes[i], libelleDisposition(codes[i])); }
  sel.value = String(g.disposition);
  if (sel.value !== String(g.disposition)) { sel.value = AUTO; }   // valeur inconnue
  sel.addEventListener('change', function () {
    api.postMessage({ type: 'grille-disposition', relatif: figure.ancre.relatif,
                      disposition: sel.value, medias: medias() });
  });
  dispo.appendChild(sel);

  // La légende de la figure : portée par l'ancre, ici et nulle part ailleurs.
  champ(corpsAcc, figure.ancre, 'legende', TXT.grilleLegende);
  var champLegende = figure.ancre.ctl.legende;
  champLegende.addEventListener('input', function () {
    legendeTete.textContent = ligne(champLegende.value) || (TXT.grilleLegendeAbsente || '');
  });

  tete.addEventListener('click', function () {
    var ouvert = tete.getAttribute('aria-expanded') === 'true';
    corpsAcc.hidden = ouvert;
    tete.setAttribute('aria-expanded', ouvert ? 'false' : 'true');
  });
}

// Les deux sorties d'une grille agissent sur UNE image : elles vivent donc dans son
// formulaire, pas dans l'accordéon commun. Un booléen inversé, et « sortir de la grille »
// effacerait l'insertion au lieu de la déplacer — sans que rien à l'écran ne change.
function construireSortiesGrille(parent, c) {
  var sorties = texte(parent, 'div', 'grille-sorties');
  sorties.appendChild(bouton(TXT.grilleRetirer || '', function () {
    api.postMessage({ type: 'grille-retirer', relatif: c.relatif, garder: true,
                      medias: medias() });
  }, '', TXT.grilleRetirerTip));
  sorties.appendChild(bouton(TXT.grilleOter || '', function () {
    api.postMessage({ type: 'grille-retirer', relatif: c.relatif, garder: false,
                      medias: medias() });
  }, '', TXT.grilleOterTip));
}

// Le formulaire d'une image, replié par défaut. Sa légende n'existe que si sa figure n'a
// qu'un seul membre — sinon elle vit dans l'accordéon du groupe, portée par l'ancre.
function construireFormulaireImage(parent, figure, c) {
  var d = texte(parent, 'div', 'media-form');
  d.id = 'mf-' + c.index;
  d.dataset.relatif = c.relatif;
  d.hidden = true;
  c.ctl.form = d;

  var tete = texte(d, 'header', 'form-tete');
  texte(tete, 'span', 'szh-tete-nom', c.relatif);
  c.ctl.meta = texte(tete, 'span', 'szh-tete-meta', c.description || '');
  c.ctl.pastilles = texte(tete, 'span', 'pastilles');
  texte(tete, 'span', 'szh-pousse');
  c.ctl.oeil = boutonIcone('loupe', TXT.agrandir || '', function () {
    if (c.apercu) { ouvrirModale(c.apercu, c.relatif); }
  });
  c.ctl.oeil.disabled = !c.apercu;                 // rien à agrandir sans aperçu
  tete.appendChild(c.ctl.oeil);
  tete.appendChild(boutonIcone('poubelle', TXT.retirerTip || '', function () {
    // Les saisies en cours voyagent avec : une suppression dans une grille fait recharger
    // le formulaire côté hôte, qui les écraserait sans cela.
    api.postMessage({ type: 'retirer', relatif: c.relatif, medias: medias() });
  }, 'szh-ico--danger'));

  c.ctl.occ = texte(d, 'p', 'szh-notif');
  c.ctl.occ.setAttribute('role', 'status');
  c.ctl.qualite = texte(d, 'p', 'szh-notif');
  c.ctl.doublon = texte(d, 'p', 'szh-notif');
  c.ctl.doublon.hidden = true;
  c.ctl.alerteAlt = texte(d, 'p', 'szh-notif szh-notif--danger');
  c.ctl.alerteAlt.hidden = true;

  zoneDepot(d, c, {
    type: 'remplacer', cle: 'relatif', genre: IMAGE, icone: 'camera',
    libelle: TXT.remplacer || ''
  });

  if (figure.membres.length === 1) { champ(d, c, 'legende'); }

  var credits = texte(d, 'div', 'szh-grille-2');
  champ(credits, c, 'copyright');
  champ(credits, c, 'source');
  // La case « sans légende ni numéro » suit les crédits : c'est le second réglage qui
  // change ce que la mise en page fabrique. L'accessibilité vient après, comme un chapitre
  // à part.
  caseHorsFigure(d, c);

  texte(d, 'p', 'szh-section', TXT.sectionAccessibilite || '');
  var z = texte(d, 'fieldset', 'szh-groupe');
  texte(z, 'legend', null, TXT.roleTitre || '');
  c.ctl.roleDecrit = radioRole(z, c, TXT.roleDecrit);
  c.ctl.roleDeco = radioRole(z, c, TXT.roleDeco);
  champ(d, c, 'alt');

  if (figure.membres.length >= 2) { construireSortiesGrille(d, c); }

  poserQualite(c.ctl.qualite, c.qualite);
  poserValeurs(c, c.valeursInitiales);
  poserOcc(c);
  c.enregistrees = valeurs(c);
}

// Une figure : sa rangée d'aperçus, sa zone d'ajout ancrée sur l'ancre, son accordéon de
// groupe si elle a plusieurs membres, puis un formulaire replié par image.
function construireFigure(fig, listeMedias) {
  var s = texte(corps, 'section', 'szh-carte carte-figure');
  fig.element = s;
  fig.ouvert = null;
  fig.membres = [];

  var vignettes = texte(s, 'div', 'figure-vignettes');
  for (var i = 0; i < fig.membresIdx.length; i++) {
    var idx = fig.membresIdx[i];
    var c = nouvelleCarte(listeMedias[idx], idx, fig);
    fig.membres.push(c);
    cartes.push(c);
    construireVignette(vignettes, c);
  }
  fig.ancre = fig.membres[0];
  s.dataset.figure = fig.ancre.relatif;
  s.setAttribute('aria-label', fig.ancre.relatif);

  zoneACote(s, fig.ancre);

  if (fig.membres.length >= 2) { construireGroupeAccordeon(s, fig); }

  for (var k = 0; k < fig.membres.length; k++) { construireFormulaireImage(s, fig, fig.membres[k]); }

  return fig;
}

// Avis d'insertion. Sans insertion, le formulaire se verrouille : il n'y a nulle part où
// écrire légende et crédits, et le seul geste utile est d'insérer l'image dans le texte.
function poserOcc(c) {
  var b = c.ctl.occ;
  b.textContent = '';
  b.hidden = true;
  if (c.occurrences === 0) {
    b.hidden = false;
    b.className = 'szh-notif szh-notif--info';
    b.appendChild(SZH.icone('info'));
    var dedans = texte(b, 'span');
    texte(dedans, 'span', null, (TXT.occZero || '') + ' ');
    dedans.appendChild(bouton(TXT.inserer || '', function () {
      api.postMessage({ type: 'inserer', relatif: c.relatif, medias: medias() });
    }, 'szh-bouton--principal', TXT.insererTip));
  }
  var verrou = c.occurrences === 0;
  ['legende', 'alt', 'copyright', 'source'].forEach(function (k) { if (c.ctl[k]) { c.ctl[k].disabled = verrou; } });
  [c.ctl.roleDecrit, c.ctl.roleDeco].forEach(function (e) { if (e) { e.disabled = verrou; } });
  if (c.ctl.horsFigure) { c.ctl.horsFigure.disabled = verrou || c.grille !== null; }
  if (verrou) { majAlerteAlt(c); majPastilles(c); } else { majRole(c); }
}

// Carte d'un portrait : ce que la vue des médias a de plus à dire sur le fichier — son
// poids, sa version retenue, son verdict de qualité — autour de la fiche d'auteur·e, qui
// est celle du formulaire des métadonnées et sert aussi à éditer la personne.
function cartePortrait(portrait, index) {
  var c = { base: String(portrait.base || ''), index: index, ctl: {}, portrait: portrait };
  var s = texte(corps, 'section', 'szh-carte carte-portrait');
  s.dataset.base = c.base;
  c.element = s;
  rendrePortrait(c);
  return c;
}

function rendrePortrait(c) {
  var portrait = c.portrait || {};
  c.element.textContent = '';
  c.element.setAttribute('aria-label', portrait.auteur || portrait.nom || c.base);

  var tete = texte(c.element, 'header', 'szh-tete');
  texte(tete, 'p', 'szh-tete-nom', portrait.nom || c.base);
  c.ctl.meta = texte(tete, 'span', 'szh-tete-meta', portrait.description || '');
  if (!portrait.rattache) {
    var orph = texte(tete, 'span', 'szh-pastille szh-pastille--attention', TXT.etatOrphelin || '');
    orph.title = TXT.portraitOrphelin || '';
  }
  texte(tete, 'span', 'szh-pousse');

  var corpsCarte = texte(c.element, 'div', 'szh-corps');
  // Un portrait qu'aucune fiche ne désigne n'a pas d'auteur·e à éditer : il ne reste que
  // le fichier, son verdict, et le constat qu'il ne sert à rien.
  if (portrait.rattache) {
    c.fiche = {
      slug: portrait.slug, index: portrait.index,
      auteur: portrait.auteurFiche || {}, apercu: portrait.apercu || null, carte: c
    };
    ctlAuteurs.apercu(corpsCarte, c.fiche);
  } else {
    c.ctl.visuel = texte(corpsCarte, 'div', 'visuel visuel--portrait');
    poserVisuel(c.ctl.visuel, portrait.nom || c.base, portrait.apercu);
  }
  c.ctl.qualite = texte(corpsCarte, 'p', 'szh-notif');
  poserQualite(c.ctl.qualite, portrait.qualite);
}

// ---- Barre d'en-tête ----
// Les commandes du formulaire, toujours à la même place et toujours visibles : dans une
// liste de médias qui défile, un « Enregistrer » en bas de page ne se retrouve pas.
function construireBarre() {
  barre.textContent = '';
  barre.className = 'szh-barre';
  ctl.enregistrer = bouton(TXT.enregistrer, function () { enregistrer(false); },
    'szh-bouton--principal', TXT.enregistrerTip);
  barre.appendChild(ctl.enregistrer);
  barre.appendChild(bouton(TXT.retour, function () {
    api.postMessage({ type: 'retourArticle', modifie: estModifie(), medias: medias() });
  }, '', TXT.retourTip));
  ctl.indic = texte(barre, 'span', 'szh-barre-indic');
  ctl.indic.setAttribute('aria-live', 'polite');
  ctl.etat = texte(barre, 'span', 'szh-barre-etat');
  ctl.etat.setAttribute('role', 'status');
  texte(barre, 'span', 'szh-pousse');
  ctl.compte = texte(barre, 'span', 'szh-barre-etat');
}

function rendre(msg) {
  corps.textContent = '';
  cartes = [];
  figures = [];
  portraits = [];
  fermerModale();                                  // un rechargement reconstruit la liste
  var listeMedias = Array.isArray(msg.medias) ? msg.medias : [];
  var listePortraits = Array.isArray(msg.portraits) ? msg.portraits : [];
  grilles = Array.isArray(msg.grilles) ? msg.grilles : [];
  DISPOSITIONS = msg.dispositions || {};
  if (Number(msg.grilleMax) > 0) { GRILLE_MAX = Number(msg.grilleMax); }
  if (msg.grilleAuto) { AUTO = String(msg.grilleAuto); }

  texte(corps, 'h2', 'titre-section', TXT.sectionImages || '');
  // Toujours construit, montré quand la liste est vide : une image retirée est la seule
  // chose qui vide la liste sans repasser par ici.
  ctl.aucuneImage = SZH.notif('info', TXT.aucuneImage || '');
  corps.appendChild(ctl.aucuneImage);
  var groupes = regrouperFigures(listeMedias);
  for (var i = 0; i < groupes.length; i++) { figures.push(construireFigure(groupes[i], listeMedias)); }

  texte(corps, 'h2', 'titre-section', TXT.sectionPortraits || '');
  if (listePortraits.length === 0) {
    corps.appendChild(SZH.notif('info', TXT.aucunPortrait || ''));
  } else {
    for (var j = 0; j < listePortraits.length; j++) {
      listePortraits[j].slug = msg.slug;            // la fiche d'auteur·e en a besoin
      portraits.push(cartePortrait(listePortraits[j], j));
    }
  }
  // Après coup seulement : ce qu'un bouton « à côté » peut offrir se lit dans les AUTRES
  // cartes, qui n'existaient pas encore quand la sienne s'est construite.
  for (var k = 0; k < cartes.length; k++) { majAjoutGrille(cartes[k]); }
  dernierModifie = false;
  etat('');
  majResume();
  majModifie();
  focaliser(msg.focus);
}

// Le compte de la barre et l'avis « aucune image » se déduisent de la liste courante :
// retirer une image les change sans que la page soit rechargée.
function majResume() {
  if (ctl.compte) { ctl.compte.textContent = remplir('resume', [cartes.length, portraits.length]); }
  if (ctl.aucuneImage) { ctl.aucuneImage.hidden = cartes.length > 0; }
}

// Ouverture depuis Ctrl+Alt+F : la figure de l'image qui vient d'être insérée passe à
// l'écran, son formulaire se déplie, et le curseur va là où il y a quelque chose à écrire.
function focaliser(relatif) {
  var c = trouverCarte(relatif);
  if (!c) { return; }
  if (c.figure.ouvert !== c) { basculerForm(c.figure, c); }
  try { c.figure.element.scrollIntoView({ block: 'start' }); } catch (e) { c.figure.element.scrollIntoView(); }
  var cible = c.ctl.legende && !c.ctl.legende.disabled ? c.ctl.legende : c.ctl.alt;
  if (cible && !cible.disabled) { try { cible.focus(); } catch (e) { /* pas focalisable */ } }
}

function trouverCarte(relatif) {
  var r = String(relatif === undefined || relatif === null ? '' : relatif);
  for (var i = 0; i < cartes.length; i++) { if (cartes[i].relatif === r) { return cartes[i]; } }
  return null;
}
// Retrouvé par le rang de l'auteur·e dans la fiche, seul lien entre une photo et la
// personne qu'elle montre.
function trouverPortraitParIndex(index) {
  for (var i = 0; i < portraits.length; i++) {
    if ((portraits[i].portrait || {}).index === index) { return portraits[i]; }
  }
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
  if ((ev.key || '') === 'Escape') { fermerModale(); return; }
  if (!(ev.ctrlKey || ev.metaKey)) { return; }
  if ((ev.key || '').toLowerCase() === 's') { ev.preventDefault(); enregistrer(false); }
});

var recu = false;
window.addEventListener('message', function (ev) {
  var msg = ev.data || {};
  recu = true;
  if (msg.type === 'charger') {
    SZH.poserAccent(msg.accent);
    if (msg.i18n) {
      TXT = msg.i18n;
      construireBarre();
      if (!modale) { construireModale(); }
      if (!ctlAuteurs) { ctlAuteurs = creerCtlAuteurs(); }
    }
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
      majPastilles(cartes[i]);
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
    c.figure.element.classList.remove('occupe');
    if (msg.type === 'media-remplace') {
      c.apercu = msg.apercu || null;
      poserVignetteImage(c.ctl.vignetteImage, c.apercu);
      if (c.ctl.oeil) { c.ctl.oeil.disabled = !c.apercu; }
      if (c.ctl.meta) { c.ctl.meta.textContent = msg.description || ''; }
      c.qualite = msg.qualite || {};
      poserQualite(c.ctl.qualite, c.qualite);
      majPastilles(c);
      poserEtatMedia(c, TXT.remplacee || '', false);
    } else if (msg.type === 'media-erreur') {
      poserEtatMedia(c, '⚠ ' + (msg.message || '?'), true);
    } else {
      poserEtatMedia(c, '');                       // annulé : la zone est réactivée
    }
    return;
  }
  // Média retiré : son aperçu et son formulaire quittent la page, avec son état modifié ;
  // si la figure n'a plus de membre, elle quitte la page à son tour. Le cas d'un membre de
  // grille est traité par l'hôte, qui recharge tout le formulaire (une suppression y change
  // le compte et la disposition) : ce chemin ne reste utile qu'à l'image seule.
  if (msg.type === 'media-retire') {
    var r = trouverCarte(msg.relatif);
    if (!r) { return; }
    var fig = r.figure;
    if (r.ctl.form) { r.ctl.form.remove(); }
    if (r.ctl.vignette) { r.ctl.vignette.remove(); }
    cartes = cartes.filter(function (x) { return x !== r; });
    fig.membres = fig.membres.filter(function (x) { return x !== r; });
    if (fig.ouvert === r) { fig.ouvert = null; }
    if (fig.membres.length === 0) {
      fig.element.remove();
      figures = figures.filter(function (x) { return x !== fig; });
    }
    // Le jumeau survivant n'est plus un doublon de rien : sans cela il garderait sa
    // pastille et nommerait le fichier qu'on vient de supprimer.
    for (var k = 0; k < cartes.length; k++) {
      var reste = cartes[k].doublons.filter(function (n) { return n !== r.relatif; });
      if (reste.length !== cartes[k].doublons.length) {
        cartes[k].doublons = reste;
        majPastilles(cartes[k]);
      }
    }
    // Une carte de moins, c'est une voisine possible de moins : les boutons « à côté » des
    // autres cartes ne proposent plus la même chose.
    for (var m = 0; m < cartes.length; m++) { majAjoutGrille(cartes[m]); }
    majResume();
    majModifie();
    return;
  }
  // La fiche d'auteur·e a été écrite : la modale se referme, et la carte du portrait suit
  // ce que l'hôte vient de relire sur le disque — la photo a pu changer de version.
  if (msg.type === 'auteur-enregistre' || msg.type === 'auteur-erreur') {
    var suite = attenteAuteur;
    attenteAuteur = null;
    if (msg.type === 'auteur-erreur') {
      if (suite) { suite.fini(msg.message || '?'); }
      return;
    }
    if (suite) { suite.fini(null); }
    etat(TXT.auteurEnregistre || '');
    var p = trouverPortraitParIndex(msg.index);
    if (p) {
      if (msg.portrait) { p.portrait = msg.portrait; p.portrait.slug = msg.slug; }
      else { p.portrait.auteurFiche = msg.auteur || {}; }
      rendrePortrait(p);
      // Le bouton d'où l'on venait vient d'être détaché : le focus revient sur celui de la
      // fiche refaite, sans quoi le clavier repartirait du haut du panneau.
      if (p.fiche && p.fiche.boutonEditer) {
        try { p.fiche.boutonEditer.focus(); } catch (e) { /* pas focalisable */ }
      }
    }
    return;
  }
  // Le composant partagé consomme les réponses photo-*.
  if (ctlAuteurs && ctlAuteurs.message(msg)) { return; }
});
SZH.annoncerPret(api, function () { return recu; });
})();
