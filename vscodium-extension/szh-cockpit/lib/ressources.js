// Fiches de « ressources » d'un article — les blocs qu'on insère dans la Documentation
// (« Actualité et ressources » / « News & Ressourcen ») : un livre, un film, une intervention
// parlementaire, une recherche en cours. Un moteur générique, décliné par une table de champs
// par type — pas un module par type. Deux de ces quatre types (intervention, recherche) ne
// portent pas d'image : voir SANS_IMAGE plus bas, seul endroit où cette différence s'exprime.
//
// Le bloc, tel que le formulaire l'écrit et tel que pipeline/filters/szh-ressource.lua le
// relit :
//
//   ::: {#r1a2b3c4 .szh-ressource type="livre" titre="Le silence des bêtes"
//        auteurs="Jean Dupont, Marie Martin" annee="2019" editeur="Éditions XYZ"
//        lien="https://exemple.org/livre"}
//   Descriptif en prose libre, sur une ou plusieurs lignes.
//
//   ![](media/couverture-x.jpg){alt=""}
//   :::
//
// Parti pris : tout ce qui est strictement STRUCTURÉ (titre, bibliographie, lien) vit dans
// les attributs de l'ouverture, en clé=valeur — jamais en prose. Le contenu du bloc ne porte
// que ce qui ne l'est pas : le descriptif (un paragraphe, éventuellement plusieurs) et
// l'image. C'est ce qui rend le bloc relisible par une machine : une bibliothèque de livres
// et de films se reconstruit en relisant les attributs de tous les blocs .szh-ressource d'un
// numéro, sans jamais avoir à analyser de la prose. Ce lot n'implémente pas cette
// récupération rétroactive (hors périmètre), mais c'est elle qui gouverne le choix du bloc.
//
// Le texte du lien — « En savoir plus sur le livre {titre} » / « Mehr zum Buch {titre} » —
// n'est JAMAIS écrit dans le .md : il se déduit du titre, du type et de la langue de
// l'ARTICLE au moment du rendu, dans szh-ressource.lua. Deux raisons : (1) un intitulé de
// lien explicite et non modifiable par mégarde est ce qui le rend utilisable hors contexte
// par un lecteur d'écran ; (2) le titre peut changer après coup sans qu'on doive retaper le
// lien.
//
// L'image d'une fiche est TOUJOURS décorative (voir le cahier des charges) : elle s'écrit
// avec un alt="" explicite, et jamais de légende. C'est szh-ressource.lua qui la marque
// comme telle dans l'arbre de structure (role="presentation"), en s'appuyant sur le même
// mécanisme que le reste du pipeline (pipeline/filters/szh-numerotation.lua, qui traite déjà
// toute image sans description ni alt comme décorative) : voir le commentaire de tête de
// szh-ressource.lua.
//
// Identité d'une fiche : un identifiant pandoc (#r…) posé par le formulaire à la création,
// jamais recalculé côté pur. Une fiche qui en est dépourvue — bloc écrit à la main — reçoit
// ici un identifiant de repli dérivé de sa position, valable pour la durée d'une seule
// lecture : de quoi fonctionner dans un aller-retour charger/enregistrer, pas au-delà. Le
// panneau (extension.js) ne connaît lui aussi que des identifiants : jamais un index de
// tableau, qui se décale au moindre ajout ou retrait ailleurs dans le document.
//
// ⚠ Table TYPES recopiée dans pipeline/filters/szh-ressource.lua (table TYPES) et son
// pendant LIBELLE_LIEN. Les deux doivent rester identiques : test/js/ressources.test.js
// refuse qu'elles divergent, comme test/js/contrats.test.js le fait pour les grilles
// (lib/references.js / szh-grille.lua).
'use strict';

const { RE_DIV_OUVERTURE, fermetureDeDiv, scannerAttributs, normaliserValeurFigure,
  cibleNormalisee } = require('./references');

const CLASSE = 'szh-ressource';

// Les champs bibliographiques propres à chaque type, dans l'ordre où ils s'écrivent. Communs
// à tous les types et donc absents d'ici : `titre`, `lien` (facultatif), le descriptif et
// l'image, qui ne sont pas des attributs (voir l'en-tête du fichier).
// ⚠ Recopiée dans pipeline/filters/szh-ressource.lua (table TYPES).
// Le champ propre à `intervention` qu'on serait tenté d'appeler « type » (Motion, Postulat,
// Interpellation…) est nommé `categorie` : `type` est déjà l'attribut qui porte le type DE
// LA FICHE elle-même (type="intervention") sur le même bloc ; deux attributs `type=` sur un
// même bloc se recouvriraient silencieusement (le second écrase le premier), et l'un des
// deux sens serait perdu. Un vrai piège de la table plutôt qu'un choix de confort.
const TYPES = {
  livre: ['auteurs', 'annee', 'editeur'],
  film: ['realisateur', 'annee', 'genre', 'pays'],
  intervention: ['canton', 'categorie', 'numero', 'date'],
  recherche: ['institutions', 'debut', 'fin']
};

// Types qui ne portent jamais d'image : le corpus ne leur en connaît pas (intervention
// parlementaire, recherche en cours — voir l'en-tête du fichier), à la différence de livre
// et film. Conséquence, et rien de plus : REQUIS n'exige alors pas d'image pour qu'une fiche
// s'écrive, et le formulaire (media/ressources-article.js) n'affiche pas la zone de dépôt.
// Le bloc écrit n'a alors jamais de ligne ![…] — blocRessource() ne l'écrit déjà que si elle
// est non vide, aucun changement à y faire — et pipeline/filters/szh-ressource.lua s'en
// accommode nativement lui aussi, puisqu'il ne fait que chercher une image dans le contenu
// du bloc plutôt que de la présumer selon le type.
const SANS_IMAGE = new Set(['intervention', 'recherche']);
function typeAvecImage(type) { return typeValide(type) && !SANS_IMAGE.has(type); }

// Champs communs à toute fiche, requis pour qu'elle s'écrive : le cahier des charges veut
// toujours un titre et un descriptif, et une image pour les types qui en portent une
// (typeAvecImage) ; le lien et la bibliographie restent facultatifs à l'écriture, même
// quand ils sont l'usage normal.
const REQUIS = ['titre', 'descriptif', 'image'];

function typeValide(type) {
  return Object.prototype.hasOwnProperty.call(TYPES, String(type === undefined || type === null ? '' : type));
}
function typesConnus() { return Object.keys(TYPES); }
function champsBiblio(type) { return (TYPES[type] || []).slice(); }
function tousLesChamps(type) { return ['titre'].concat(champsBiblio(type), ['lien', 'descriptif', 'image']); }

// Les champs manquants d'une fiche, pour ce que REQUIS exige. Un type inconnu manque de
// tout : mieux vaut le dire que faire semblant qu'il est complet. Un type sans image
// (typeAvecImage) n'a, lui, jamais besoin de la sienne pour être complet.
function champsManquants(type, valeurs) {
  if (!typeValide(type)) { return REQUIS.slice(); }
  const requis = typeAvecImage(type) ? REQUIS : REQUIS.filter((c) => c !== 'image');
  const v = valeurs || {};
  return requis.filter((c) => String(v[c] === undefined || v[c] === null ? '' : v[c]).trim() === '');
}
function ressourceComplete(type, valeurs) { return champsManquants(type, valeurs).length === 0; }

// Valeur -> attribut cité, comme lib/references.js (non exportée là-bas : une simple
// citation, dupliquée plutôt qu'empruntée à un module qui ne l'expose pas).
function citerValeur(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Une ligne qui ne porte qu'une seule image, comme lireGrilles() dans lib/references.js
// (fonction interne là-bas, non exportée) : sa cible normalisée, ou null.
const RE_IMAGE_SEULE = /^!\[[^\]]*\]\(\s*(<[^>]*>|[^()\s]+)(?:\s+"[^"]*")?\s*\)(?:\{[^}]*\})?\s*$/;
function cibleImageDeLigne(ligne) {
  const t = String(ligne === undefined || ligne === null ? '' : ligne).trim();
  const m = RE_IMAGE_SEULE.exec(t);
  if (!m) { return null; }
  return cibleNormalisee(m[1]);
}

// lireRessources(texte) -> [ { id, ouverture, fermeture, type, valeurs } ]
// `id` vient de l'identifiant pandoc du bloc (#…) ; à défaut, un repli dérivé de la position
// — voir l'en-tête du fichier. `valeurs` = { titre, lien, descriptif, image, …champs du
// type }, toujours des chaînes (jamais undefined), pour que le formulaire n'ait rien à
// deviner.
function lireRessources(texte) {
  const lignes = String(texte === undefined || texte === null ? '' : texte).split('\n');
  const res = [];
  for (let i = 0; i < lignes.length; i++) {
    const ouverture = RE_DIV_OUVERTURE.exec(lignes[i]);
    if (!ouverture) { continue; }
    const jetons = scannerAttributs(ouverture[1]);
    const estRessource = jetons.some((j) => !j.paire && j.brut === '.' + CLASSE);
    if (!estRessource) { continue; }
    const fin = fermetureDeDiv(lignes, i);
    if (fin === -1) { continue; }                   // bloc laissé ouvert : on n'y touche pas

    let id = null;
    const attrs = {};
    for (const j of jetons) {
      if (j.paire) { attrs[j.cle.toLowerCase()] = j.valeur; continue; }
      if (id === null && /^#./.test(j.brut)) { id = j.brut.slice(1); }
    }
    const type = String(attrs.type || '');

    // Le contenu du bloc : une image au plus (la première rencontrée), le reste est le
    // descriptif, blancs de tête et de queue ôtés.
    let image = null;
    const descLignes = [];
    for (let l = i + 1; l < fin; l++) {
      if (image === null) {
        const cible = cibleImageDeLigne(lignes[l]);
        if (cible !== null && cible.indexOf('media/') === 0) { image = cible.slice('media/'.length); continue; }
      }
      descLignes.push(lignes[l]);
    }
    while (descLignes.length > 0 && descLignes[0].trim() === '') { descLignes.shift(); }
    while (descLignes.length > 0 && descLignes[descLignes.length - 1].trim() === '') { descLignes.pop(); }

    const valeurs = {
      titre: attrs.titre || '', lien: attrs.lien || '',
      descriptif: descLignes.join('\n'), image: image || ''
    };
    for (const c of champsBiblio(type)) { valeurs[c] = attrs[c] || ''; }

    res.push({ id: id || ('pos' + i), ouverture: i, fermeture: fin, type: type, valeurs: valeurs });
    i = fin;
  }
  return res;
}

// La ligne d'ouverture d'un bloc. Seuls les attributs non vides s'écrivent, hormis `titre`
// et `type` : une fiche est toujours de son type, et le titre — même vide — reste le premier
// repère de la fiche pour qui relit le .md à la main.
function ligneOuverture(id, type, valeurs) {
  const v = valeurs || {};
  const jetons = [];
  if (id) { jetons.push('#' + String(id)); }
  jetons.push('.' + CLASSE);
  jetons.push('type=' + citerValeur(type));
  jetons.push('titre=' + citerValeur(normaliserValeurFigure(v.titre)));
  for (const c of champsBiblio(type)) {
    const val = normaliserValeurFigure(v[c]);
    if (val !== '') { jetons.push(c + '=' + citerValeur(val)); }
  }
  const lien = normaliserValeurFigure(v.lien);
  if (lien !== '') { jetons.push('lien=' + citerValeur(lien)); }
  return '::: {' + jetons.join(' ') + '}';
}

// Le bloc entier, prêt à être inséré tel quel dans le texte (sans les lignes vides qui
// l'isolent : c'est à l'appelant de les poser, comme insererIsole() de lib/references.js).
function blocRessource(id, type, valeurs) {
  const v = valeurs || {};
  const lignes = [ligneOuverture(id, type, v)];
  const descriptif = String(v.descriptif === undefined || v.descriptif === null ? '' : v.descriptif)
    .replace(/\r\n/g, '\n').replace(/[\t]+/g, ' ');
  const descLignes = descriptif.split('\n');
  while (descLignes.length > 0 && descLignes[0].trim() === '') { descLignes.shift(); }
  while (descLignes.length > 0 && descLignes[descLignes.length - 1].trim() === '') { descLignes.pop(); }
  if (descLignes.length > 0) { lignes.push(''); lignes.push(...descLignes); }
  const image = String(v.image === undefined || v.image === null ? '' : v.image).replace(/\\/g, '/').trim();
  if (image !== '') {
    lignes.push('');
    // Toujours décorative : alt="" explicite, jamais de légende (voir l'en-tête du fichier).
    lignes.push('![](media/' + image + '){alt=""}');
  }
  lignes.push(':::');
  return lignes.join('\n');
}

// Isole un bloc de lignes par un blanc de chaque côté, sans en ajouter un qui existerait
// déjà — même règle qu'insererIsole() de lib/references.js (non exportée là-bas).
function inserer(lignes, ou, bloc) {
  const avant = (ou > 0 && (lignes[ou - 1] || '').trim() !== '') ? [''] : [];
  const apres = (ou < lignes.length && (lignes[ou] || '').trim() !== '') ? [''] : [];
  lignes.splice(ou, 0, ...avant, ...bloc, ...apres);
}

// ajouterRessource(texte, id, type, valeurs) -> texte
// Ajoute une fiche neuve, juste après la dernière fiche déjà présente (toute type
// confondu), ou en fin de document s'il n'y en a aucune : les fiches d'un article restent
// ainsi groupées, dans l'ordre où elles ont été saisies.
// `langue` est facultative : fournie, les fiches sont rangées après l'ajout (voir
// reordonnerRessources). Absente, le texte garde l'ordre de saisie — l'ancien comportement,
// pour un appelant qui ne sait pas dans quelle langue est l'article.
function ajouterRessource(texte, id, type, valeurs, langue) {
  const src = String(texte === undefined || texte === null ? '' : texte);
  const lignes = src.split('\n');
  const existantes = lireRessources(src);
  const ou = existantes.length > 0
    ? existantes[existantes.length - 1].fermeture + 1
    : lignes.length;
  inserer(lignes, ou, blocRessource(id, type, valeurs).split('\n'));
  const sortie = lignes.join('\n');
  return langue ? reordonnerRessources(sortie, langue) : sortie;
}

// ecrireRessource(texte, id, type, valeurs) -> { texte, ok }
// Remplace en place la fiche `id`. `ok` est faux si elle a disparu du .md depuis le
// chargement (bloc supprimé à la main entre-temps) : l'appelant décide alors quoi en dire.
function ecrireRessource(texte, id, type, valeurs, langue) {
  const src = String(texte === undefined || texte === null ? '' : texte);
  const trouvee = lireRessources(src).find((r) => r.id === String(id));
  if (!trouvee) { return { texte: src, ok: false }; }
  const lignes = src.split('\n');
  lignes.splice(trouvee.ouverture, trouvee.fermeture - trouvee.ouverture + 1,
    ...blocRessource(id, type, valeurs).split('\n'));
  const sortie = lignes.join('\n');
  // Un titre corrigé change la place de la fiche : c'est le sens du tri, et la position
  // affichée par le formulaire suit.
  return { texte: langue ? reordonnerRessources(sortie, langue) : sortie, ok: true };
}

// ---- Tri des fiches -------------------------------------------------------------------
//
// Demande de Robin (01.09.2026) : les fiches se rangent d'elles-mêmes — livres, films et
// recherches par titre, interventions parlementaires par canton. Le formulaire affiche la
// POSITION de chaque fiche dans l'en-tête de son accordéon, et c'est ce qui oblige à trier
// le .md lui-même et non l'affichage seul : une position montrée que le document ne
// respecterait pas mentirait sur l'ordre du PDF.
//
// Le champ qui range, par type. Un type inconnu se range par titre, faute de mieux.
const CLE_TRI = { intervention: 'canton' };

// Comparaison de deux fiches, dans la langue de l'article : « École » se range avec les E
// et « Ökonomie » avec les O, ce qu'un tri par octets ne ferait pas. Deux fiches du même
// canton sont départagées par le titre — sans quoi leur ordre dépendrait de la saisie et
// changerait à chaque enregistrement.
function comparerRessources(a, b, langue) {
  const loc = String(langue || 'fr');
  const cle = CLE_TRI[a.type] || 'titre';
  const va = String((a.valeurs || {})[cle] || '');
  const vb = String((b.valeurs || {})[cle] || '');
  const d = va.localeCompare(vb, loc, { sensitivity: 'base', numeric: true });
  if (d !== 0) { return d; }
  if (cle === 'titre') { return 0; }
  return String((a.valeurs || {}).titre || '')
    .localeCompare(String((b.valeurs || {}).titre || ''), loc, { sensitivity: 'base', numeric: true });
}

// Les fiches qui peuvent permuter entre elles : celles qui se suivent, portent le MÊME type,
// et qu'aucun titre markdown ne sépare. Ces deux gardes comptent — les fiches d'un article
// vivent sous des intertitres (« Livres », « Films »), et un tri qui les ignorerait ferait
// passer un film dans la section des livres, ou une fiche sous le mauvais intertitre.
function groupesTriables(lignes, fiches) {
  const groupes = [];
  let courant = [];
  for (let i = 0; i < fiches.length; i++) {
    if (courant.length > 0) {
      const prec = fiches[i - 1];
      const memeType = fiches[i].type === prec.type;
      let titreEntre = false;
      for (let l = prec.fermeture + 1; l < fiches[i].ouverture; l++) {
        if (/^\s{0,3}#{1,6}\s/.test(lignes[l] || '')) { titreEntre = true; break; }
      }
      if (!memeType || titreEntre) { groupes.push(courant); courant = []; }
    }
    courant.push(fiches[i]);
  }
  if (courant.length > 0) { groupes.push(courant); }
  return groupes;
}

// ordreRessources(lignes, fiches, langue) -> [fiches, dans l'ordre où elles doivent être]
// Pure : ne touche à rien, dit seulement l'ordre voulu. Le tri est STABLE (Array.sort l'est
// depuis ES2019), donc deux fiches que rien ne départage gardent leur ordre de saisie.
function ordreRessources(lignes, fiches, langue) {
  const voulu = [];
  for (const groupe of groupesTriables(lignes, fiches)) {
    voulu.push(...groupe.slice().sort((a, b) => comparerRessources(a, b, langue)));
  }
  return voulu;
}

// reordonnerRessources(texte, langue) -> texte
// Permute les blocs de fiches dans le .md pour suivre ordreRessources(). Les EMPLACEMENTS ne
// bougent pas : seuls les contenus permutent, si bien que tout ce qui vit entre deux fiches
// — intertitres, paragraphes, blancs — reste exactement où il était. Réécrit de la fin vers
// le début pour que les index relevés restent valides pendant l'opération.
function reordonnerRessources(texte, langue) {
  const src = String(texte === undefined || texte === null ? '' : texte);
  const lignes = src.split('\n');
  const fiches = lireRessources(src);
  if (fiches.length < 2) { return src; }

  const voulu = ordreRessources(lignes, fiches, langue);
  const inchange = voulu.every((f, i) => f.id === fiches[i].id);
  if (inchange) { return src; }

  const corps = fiches.map((f) => lignes.slice(f.ouverture, f.fermeture + 1));
  const parId = {};
  fiches.forEach((f, i) => { parId[f.id] = corps[i]; });

  for (let i = fiches.length - 1; i >= 0; i--) {
    const place = fiches[i];
    lignes.splice(place.ouverture, place.fermeture - place.ouverture + 1, ...parId[voulu[i].id]);
  }
  return lignes.join('\n');
}

// retirerRessource(texte, id) -> { texte, ok }
// Ôte la fiche entière. Le fichier de couverture, lui, n'est PAS supprimé de media/ : une
// image peut avoir été déposée avant que la fiche ne soit complète, et rien ne dit qu'elle
// ne sera pas réutilisée. Même parti que « Retirer de la figure » dans le gestionnaire des
// médias (lib/references.js, retirerDeGrille) : le texte se nettoie, le disque non.
function retirerRessource(texte, id) {
  const src = String(texte === undefined || texte === null ? '' : texte);
  const trouvee = lireRessources(src).find((r) => r.id === String(id));
  if (!trouvee) { return { texte: src, ok: false }; }
  const lignes = src.split('\n');
  lignes.splice(trouvee.ouverture, trouvee.fermeture - trouvee.ouverture + 1);
  // Un blanc de chaque côté de la coupe : n'en garder qu'un, comme un paragraphe retiré.
  if (trouvee.ouverture > 0 && trouvee.ouverture < lignes.length
      && lignes[trouvee.ouverture - 1].trim() === '' && lignes[trouvee.ouverture].trim() === '') {
    lignes.splice(trouvee.ouverture, 1);
  }
  return { texte: lignes.join('\n'), ok: true };
}

module.exports = {
  CLASSE, TYPES, REQUIS,
  typeValide, typesConnus, champsBiblio, tousLesChamps, typeAvecImage,
  champsManquants, ressourceComplete,
  lireRessources, ajouterRessource, ecrireRessource, retirerRessource,
  blocRessource, ligneOuverture,
  ordreRessources, reordonnerRessources, comparerRessources
};
