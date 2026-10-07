// Feuille de vérification des métadonnées : une page A4 par article, à imprimer et à
// relire à côté de la source (le Word de l'auteur·e, son courriel). Module pur : il reçoit
// ce que lib/metadonnees-hote.js a lu et rend un HTML autonome, que l'hôte écrit et ouvre.
//
// La feuille sert à vérifier l'exactitude (la bonne adresse, la bonne affiliation, le
// titre écrit par l'auteur·e). Les champs vides, marques de traduction et DOI invalides
// sont déjà refusés par la compilation.
//
// Deux régimes typographiques. Titre, sous-titre et résumé sont en police proportionnelle,
// lus comme du texte. Courriel, ORCID, DOI et ROR sont en chasse fixe, découpés en groupes
// espacés, comme un IBAN : la chasse fixe distingue 0 de O, 1 de l et I, rn de m.
//
// Les séparateurs affichés entre les groupes (@ . - /) sont ceux de la valeur. Seul le
// ROR, qui n'en a pas, reçoit un blanc purement visuel.
//
// Chaque champ figure, dans l'ordre du formulaire ; un champ vide porte la marque LEER (un
// mot, car un tiret se lirait comme une valeur).
//
// Les clés en `...Html` sortent d'ici déjà échappées : le gabarit les pose sans |e. Toutes
// les autres valeurs du modèle sont du texte brut, que le gabarit échappe par |e.
'use strict';

const crypto = require('crypto');
const gabarits = require('./gabarits');

const LANGUES_FEUILLE = ['fr', 'de', 'it'];

// Marque d'un champ vide, la même en fr et en de, en capitales pour se repérer d'un coup d'œil.
const MARQUE_VIDE = 'LEER';

function echapper(texte) {
  return String(texte === undefined || texte === null ? '' : texte)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Une valeur de texte, seulement échappée : la feuille montre ce qui est dans le fichier,
// sans la typographie maison.
function baliserTexte(valeur) {
  const texte = String(valeur === undefined || valeur === null ? '' : valeur);
  return { html: echapper(texte), vide: texte === '' };
}

// ---- Découpage des identifiants ----------------------------------------------------
// Rend une liste de pièces : { groupe } pour un morceau à lire, { sep } pour un
// séparateur de la valeur. `visuel: true` : le blanc qui précède la pièce n'est pas dans
// la valeur (ROR seulement).

function piecesCourriel(valeur) {
  const at = valeur.lastIndexOf('@');
  if (at === -1) { return [{ groupe: valeur }]; }
  const pieces = [{ groupe: valeur.slice(0, at) }, { sep: '@' }];
  // Le domaine se découpe à chaque point, là où se glissent les inversions (« .hc »).
  const domaine = valeur.slice(at + 1).split('.');
  for (let i = 0; i < domaine.length; i++) {
    if (i > 0) { pieces.push({ sep: '.' }); }
    pieces.push({ groupe: domaine[i] });
  }
  return pieces;
}

// Retire l'adresse en tête d'un ORCID ou d'un ROR, identique partout : l'identifiant tient
// ainsi sur une ligne. La légende de la page le signale.
function sansPrefixe(valeur, hote) {
  const m = new RegExp('^https?://(?:www\\.)?' + hote + '/(.*)$', 'i').exec(valeur);
  return m ? m[1] : valeur;
}

function piecesOrcid(valeur) {
  const morceaux = sansPrefixe(valeur, 'orcid\\.org').split('-');
  const pieces = [];
  for (let i = 0; i < morceaux.length; i++) {
    if (i > 0) { pieces.push({ sep: '-' }); }
    pieces.push({ groupe: morceaux[i] });
  }
  return pieces;
}

function piecesDoi(valeur) {
  const barre = valeur.indexOf('/');
  if (barre === -1) { return [{ groupe: valeur }]; }
  return [{ groupe: valeur.slice(0, barre) }, { sep: '/' }, { groupe: valeur.slice(barre + 1) }];
}

function piecesRor(valeur) {
  const identifiant = sansPrefixe(valeur, 'ror\\.org');
  const pieces = [];
  // Neuf caractères sans séparateur : groupes de trois, séparés par un blanc visuel.
  for (let i = 0; i < identifiant.length; i += 3) {
    pieces.push({ groupe: identifiant.slice(i, i + 3), visuel: i > 0 });
  }
  return pieces;
}

const DECOUPEURS = { courriel: piecesCourriel, orcid: piecesOrcid, doi: piecesDoi, ror: piecesRor };

// Un identifiant : chasse fixe, groupes espacés, séparateurs réels mis en évidence.
function baliserIdentifiant(valeur, genre) {
  const texte = String(valeur === undefined || valeur === null ? '' : valeur);
  if (texte === '') { return { html: '', vide: true, visuel: false }; }
  const decouper = DECOUPEURS[genre];
  if (!decouper) {
    return { html: '<span class="ident">' + echapper(texte) + '</span>', vide: false, visuel: false };
  }
  let html = '<span class="ident">';
  let visuel = false;
  for (const p of decouper(texte)) {
    if (p.sep !== undefined) { html += '<span class="ident-sep">' + echapper(p.sep) + '</span>'; continue; }
    if (p.visuel) { visuel = true; }
    html += '<span class="ident-groupe">' + echapper(p.groupe) + '</span>';
  }
  return { html: html + '</span>', vide: false, visuel: visuel };
}

// ---- Empreinte ---------------------------------------------------------------------
// Six caractères imprimés sur la feuille, calculés sur la fiche : en les recalculant, on
// voit si une feuille signée correspond encore à la fiche. Un repère, pas une signature.

function serialiserStable(v) {
  if (v === null || v === undefined) { return 'null'; }
  if (Array.isArray(v)) { return '[' + v.map(serialiserStable).join(',') + ']'; }
  if (typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + serialiserStable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

function empreinte(valeurs) {
  return crypto.createHash('sha1').update(serialiserStable(valeurs), 'utf8').digest('hex').slice(0, 6);
}

// ---- Construction du modèle --------------------------------------------------------

function libelleDe(table, valeur) {
  if (!valeur) { return ''; }
  return (table && table[valeur]) || valeur;
}

// Une rangée de champ : libellé et valeur balisée. Avec `genre`, la valeur est un
// identifiant ; sans, du texte.
function rangee(libelle, valeur, genre) {
  const b = genre ? baliserIdentifiant(valeur, genre) : baliserTexte(valeur);
  return { libelle: libelle, valeurHtml: b.html, vide: b.vide, identifiant: !!genre };
}

// Une ligne du tableau : un ou deux champs, une case à cocher. `seule` (un seul champ, sur
// toute la largeur) est calculé ici, car le gabarit ne sait pas compter.
function ligne(champs) {
  return { champs: champs, seule: champs.length === 1 };
}

// Les champs traduisibles s'empilent, une langue par ligne, sur toute la largeur. La
// langue est nommée à chaque ligne, l'intitulé du champ une seule fois ; `debutChamp`
// marque le début d'un champ, où le gabarit pose un filet. Les mots-clés restent en
// colonnes (rangeesMotsCles).
function rangeesMultilingues(libelle, map, langues, libellesLangues, pleineLargeur) {
  return langues.map((l, i) => {
    const b = baliserTexte((map || {})[l]);
    const nomLangue = libellesLangues[l] || l;
    return {
      // En pleine largeur, chaque langue est un bloc dont l'étiquette porte le champ et la
      // langue (« Résumé — français »). Sinon, l'intitulé ne s'écrit qu'à la première langue.
      libelle: pleineLargeur ? libelle : (i === 0 ? libelle : ''),
      debutChamp: i === 0,
      langue: l, langueLibelle: nomLangue,
      pleineLargeur: !!pleineLargeur,
      valeurHtml: b.html, vide: b.vide
    };
  });
}

// Les mots-clés se correspondent par position d'une langue à l'autre (le n° 2 en français
// traduit le n° 2 en allemand) : une rangée par position, une colonne par langue.
function rangeesMotsCles(map, langues) {
  const listes = {};
  let n = 0;
  for (const l of langues) {
    listes[l] = Array.isArray((map || {})[l]) ? (map || {})[l] : [];
    if (listes[l].length > n) { n = listes[l].length; }
  }
  const rangees = [];
  for (let i = 0; i < n; i++) {
    rangees.push({
      numero: i + 1,
      cellules: langues.map((l) => {
        const b = baliserTexte(listes[l][i]);
        return { langue: l, valeurHtml: b.html, vide: b.vide };
      })
    });
  }
  return rangees;
}

// Construit la fiche d'un article. `libelles` et `textes` viennent de l'hôte (types,
// licences, langues, intitulés) : ce module ne connaît aucune langue.
function construireFiche(article, options, index, total) {
  const v = article.valeurs || {};
  const lib = options.libelles || {};
  const txt = options.textes || {};
  // fr et de toujours, l'italien seulement s'il porte quelque chose.
  const langues = LANGUES_FEUILLE.filter((l) => {
    if (l !== 'it') { return true; }
    if ((v.title || {})[l] || (v.subtitle || {})[l] || (v.resume || {})[l]) { return true; }
    return Array.isArray((v.keywords || {})[l]) && (v.keywords || {})[l].length > 0;
  });
  // Le DOI de la fiche, sinon celui que la chaîne a calculé ; la note dit lequel.
  const doi = v.doi || article.doiCalcule || '';
  const rDoi = rangee(txt.doi || 'DOI', doi, 'doi');
  rDoi.note = v.doi ? (txt.doiManuel || '') : (txt.doiCalcule || '');
  // Deux champs et une case par ligne, pour tenir en A4. Le courriel a sa ligne à lui.
  const identification = [
    ligne([rangee(txt.type || 'Type', libelleDe(lib.types, v.type)),
      rangee(txt.langue || 'Langue', libelleDe(lib.langues, v.lang))]),
    ligne([rangee(txt.licence || 'Licence', libelleDe(lib.licences, v.licence)), rDoi])
  ];
  // Pas de titre par auteur·e : un filet sépare les fiches.
  const auteurs = (v.author || []).map((a) => ({
    lignes: [
      ligne([rangee(txt.prenom || 'Prénom', a.prenom), rangee(txt.nom || 'Nom', a.nom)]),
      ligne([rangee(txt.fonction || 'Fonction', a.fonction),
        rangee(txt.affiliation || 'Affiliation', a.affiliation)]),
      ligne([rangee(txt.courriel || 'Courriel', a.email, 'courriel')]),
      ligne([rangee(txt.orcid || 'ORCID', a.orcid, 'orcid'), rangee(txt.ror || 'ROR', a.ror, 'ror')])
    ]
  }));
  const nomsLangues = {};
  for (const l of langues) { nomsLangues[l] = libelleDe(lib.langues, l) || l; }
  const textes = []
    .concat(rangeesMultilingues(txt.titre || 'Titre', v.title, langues, nomsLangues))
    .concat(rangeesMultilingues(txt.sousTitre || 'Sous-titre', v.subtitle, langues, nomsLangues))
    // Le résumé, seul champ long, passe en pleine largeur : étiquette sur sa ligne, texte
    // dessous, sans les 46 mm des colonnes d'intitulé et de langue.
    .concat(rangeesMultilingues(txt.resume || 'Résumé', v.resume, langues, nomsLangues, true));
  return {
    slug: article.slug, index: index, total: total,
    langues: langues.map((l) => ({ code: l, libelle: libelleDe(lib.langues, l) || l })),
    identification: identification, textes: textes,
    motsCles: rangeesMotsCles(v.keywords, langues),
    auteurs: auteurs, sansAuteur: auteurs.length === 0,
    empreinte: empreinte(v)
  };
}

// Le modèle complet passé au gabarit. `horodatage` est fourni par l'appelant, pour qu'un
// test puisse figer la feuille entière.
function construireModele(articles, options) {
  const o = options || {};
  const liste = articles || [];
  return {
    numero: o.numero || '',
    horodatage: o.horodatage || '',
    vide: MARQUE_VIDE,
    textes: o.textes || {},
    total: liste.length,
    fiches: liste.map((a, i) => construireFiche(a, o, i + 1, liste.length))
  };
}

// Rend le HTML autonome. La mise en page, les intitulés et la légende sont dans le gabarit.
// La page entière est le bloc `contenu`, comme pour les exports du secrétariat ; sans ce
// bloc, on lève une erreur plutôt que d'écrire une page vide.
function rendre(source, modele) {
  const blocs = gabarits.compiler(source, 'verification-meta.twig').rendre(modele);
  if (typeof blocs.contenu !== 'string') {
    throw new Error('gabarit « verification-meta.twig » : bloc « contenu » absent');
  }
  return blocs.contenu;
}

module.exports = {
  baliserTexte, baliserIdentifiant, empreinte, serialiserStable,
  construireFiche, construireModele, rendre,
  MARQUE_VIDE, LANGUES_FEUILLE
};
