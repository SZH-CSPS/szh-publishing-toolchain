// Feuille de vérification des métadonnées : une page A4 par article, à imprimer et à
// relire à côté de sa source (le Word de l'auteur·e, son courriel). Module pur — ni
// vscode, ni écriture de fichier : il reçoit ce que lib/metadonnees-hote.js a lu du
// disque, et rend le HTML autonome. L'hôte l'écrit et l'ouvre (extension.js).
//
// ---- Ce que cette feuille vise, et ce qu'elle ne vise pas -------------------------
// La chaîne refuse DÉJÀ de compiler un champ vide dans la langue de l'article, une
// marque de traduction restée en place, un DOI mal formé ou en double. Rappeler ces
// contrôles ici gaspillerait l'attention du relecteur sur ce que la machine tient seule.
// La feuille sert à ce que la machine ne peut pas voir : l'EXACTITUDE. Est-ce bien
// l'adresse de cette personne, son affiliation, le titre qu'elle a écrit.
//
// ---- Deux régimes typographiques ---------------------------------------------------
// Augmenter l'interlettrage aide la lecture caractère par caractère et NUIT à la lecture
// par mots : c'est le même mécanisme vu des deux côtés. La feuille sépare donc les deux
// familles de champs. Titre, sous-titre, résumé : proportionnel, lus comme du texte.
// Courriel, ORCID, DOI, ROR : chasse fixe, espacés, découpés en groupes — la pratique de
// l'IBAN et des posologies. La chasse fixe fait le travail que l'espacement ne fait pas :
// elle sépare 0 de O, 1 de l et I, rn de m.
//
// ---- Le découpage n'invente rien ---------------------------------------------------
// Les séparateurs affichés entre les groupes (@ . - /) sont les caractères RÉELS de la
// valeur, jamais des ajouts : le relecteur peut lire la feuille comme la chaîne. Seul
// l'identifiant ROR, qui n'a aucun séparateur, reçoit un blanc purement visuel — la
// légende de la page le dit.
//
// ---- Un champ vide s'imprime -------------------------------------------------------
// L'erreur classique d'une fiche de contrôle est qu'un champ absent ressemble à un champ
// inexistant : personne ne relève ce qu'il ne voit pas. Chaque champ figure donc
// toujours, dans l'ordre du formulaire, et le vide porte la marque LEER — un mot, pas un
// tiret, parce qu'un tiret se lit comme une valeur.
//
// ---- Ce qui est pré-rendu ici, et ce que le gabarit échappe -----------------------
// ⚠ Les clés en `...Html` sortent d'ici DÉJÀ échappées : le gabarit les pose telles
// quelles, SANS le filtre |e, qui les afficherait en clair. Toutes les autres valeurs du
// modèle sont du texte brut, et le gabarit DOIT leur poser |e. La règle se lit au nom de
// la clé, et c'est pour ça que les noms sont ainsi.
'use strict';

const crypto = require('crypto');
const gabarits = require('./gabarits');

const LANGUES_FEUILLE = ['fr', 'de', 'it'];

// La marque du vide. Un seul mot, le même dans les deux langues de la maison, en
// capitales : il doit se repérer en survolant la page, pas se lire.
const MARQUE_VIDE = 'LEER';

function echapper(texte) {
  return String(texte === undefined || texte === null ? '' : texte)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Une valeur de texte : échappée, et rien de plus. Ce qui s'imprime est ce qui est dans
// le fichier — pas la version passée à la typographie maison, sans quoi le relecteur
// validerait une chaîne qui n'existe nulle part.
function baliserTexte(valeur) {
  const texte = String(valeur === undefined || valeur === null ? '' : valeur);
  return { html: echapper(texte), vide: texte === '' };
}

// ---- Découpage des identifiants ----------------------------------------------------
// Rend une liste de pièces : { groupe } pour un morceau à lire, { sep } pour un
// séparateur réel de la valeur. `visuel: true` sur une pièce dit que le blanc qui la
// précède n'existe pas dans la valeur — seul le ROR est dans ce cas.

function piecesCourriel(valeur) {
  const at = valeur.lastIndexOf('@');
  if (at === -1) { return [{ groupe: valeur }]; }
  const pieces = [{ groupe: valeur.slice(0, at) }, { sep: '@' }];
  // Le domaine se relit étiquette par étiquette : c'est là que « .ch » devient « .hc ».
  const domaine = valeur.slice(at + 1).split('.');
  for (let i = 0; i < domaine.length; i++) {
    if (i > 0) { pieces.push({ sep: '.' }); }
    pieces.push({ groupe: domaine[i] });
  }
  return pieces;
}

// L'adresse en tête d'un ORCID ou d'un ROR n'est pas relue : elle est identique sur
// toutes les fiches, et elle mangeait assez de largeur pour casser l'identifiant sur deux
// lignes — exactement ce qu'un identifiant ne doit pas faire. Elle est donc retirée de
// l'affichage, et la légende de la page le dit. C'est le seul endroit où la feuille
// montre autre chose que la valeur stockée.
function sansPrefixe(valeur, hote) {
  const m = new RegExp('^https?://(?:www\\.)?' + hote + '/(.*)$', 'i').exec(valeur);
  return m ? m[1] : valeur;
}

function piecesOrcid(valeur) {
  // Un ORCID porte déjà son découpage par quatre : on ne fait que l'espacer.
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
  // Neuf caractères sans le moindre séparateur : le seul cas où l'on pose un blanc qui
  // n'existe pas dans la valeur. Par trois, comme un numéro de téléphone.
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
// Une feuille relue et signée ne vaut que pour l'état dont elle sort. Sans repère, une
// modification postérieure la périme en silence. Six caractères suffisent à vérifier
// qu'une feuille signée correspond encore à la fiche : on les recalcule et on compare.
// Ce n'est pas une signature — juste un repère, et il ne prétend pas à plus.

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

// Une rangée de champ : le libellé, la valeur balisée. `genre` bascule le régime
// typographique ; absent, c'est du texte.
function rangee(libelle, valeur, genre) {
  const b = genre ? baliserIdentifiant(valeur, genre) : baliserTexte(valeur);
  return { libelle: libelle, valeurHtml: b.html, vide: b.vide, identifiant: !!genre };
}

// Une ligne du tableau : un ou deux champs, et une seule case à cocher. `seule` dit au
// gabarit qu'il n'y a qu'un champ, donc que la valeur prend toute la largeur — le moteur
// de gabarits ne sait pas compter, c'est donc ici que ça se décide.
function ligne(champs) {
  return { champs: champs, seule: champs.length === 1 };
}

// Les champs traduisibles se lisent COTE A COTE : une traduction manquante saute aux
// yeux, et un texte français collé dans la case allemande aussi. La troisième langue
// n'apparaît que si elle porte quelque chose — elle n'est activée que par exception.
function rangeeMultilingue(libelle, map, langues) {
  const cellules = langues.map((l) => {
    const b = baliserTexte((map || {})[l]);
    return { langue: l, valeurHtml: b.html, vide: b.vide };
  });
  return { libelle: libelle, cellules: cellules };
}

// Les mots-clés sont des RANGÉES appariées d'une langue à l'autre : le mot-clé n° 2 en
// français est la traduction du n° 2 en allemand. Les présenter en deux listes
// indépendantes casserait l'appariement, qui est précisément ce qui se vérifie.
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

// Construit la fiche d'UN article. `libelles` porte les tables de l'hôte (types, licences,
// langues) et les intitulés de l'interface : ce module ne connaît aucune langue.
function construireFiche(article, options, index, total) {
  const v = article.valeurs || {};
  const lib = options.libelles || {};
  const txt = options.textes || {};
  // Les langues montrées : les deux de la maison, plus l'italien seulement s'il porte
  // quelque chose. Une colonne vide sur douze pages coûte de la place pour rien.
  const langues = LANGUES_FEUILLE.filter((l) => {
    if (l !== 'it') { return true; }
    if ((v.title || {})[l] || (v.subtitle || {})[l] || (v.resume || {})[l]) { return true; }
    return Array.isArray((v.keywords || {})[l]) && (v.keywords || {})[l].length > 0;
  });
  // Le DOI affiché est celui de la fiche ; à défaut, celui que la chaîne a calculé. La
  // note dit lequel des deux, parce qu'un DOI saisi à la main n'engage pas la chaîne.
  const doi = v.doi || article.doiCalcule || '';
  const rDoi = rangee(txt.doi || 'DOI', doi, 'doi');
  rDoi.note = v.doi ? (txt.doiManuel || '') : (txt.doiCalcule || '');
  // Deux champs par ligne, et une case par LIGNE : la page doit tenir en A4, et le
  // relecteur coche une fois qu'il a vu les deux. Les identifiants gardent leur ligne
  // — ce sont eux qui se lisent lentement.
  const identification = [
    ligne([rangee(txt.type || 'Type', libelleDe(lib.types, v.type)),
      rangee(txt.langue || 'Langue', libelleDe(lib.langues, v.lang))]),
    ligne([rangee(txt.licence || 'Licence', libelleDe(lib.licences, v.licence)), rDoi])
  ];
  const auteurs = (v.author || []).map((a, i) => ({
    numero: i + 1,
    nom: [a.prenom, a.nom].filter((x) => x).join(' '),
    lignes: [
      ligne([rangee(txt.prenom || 'Prénom', a.prenom), rangee(txt.nom || 'Nom', a.nom)]),
      ligne([rangee(txt.fonction || 'Fonction', a.fonction),
        rangee(txt.affiliation || 'Affiliation', a.affiliation)]),
      ligne([rangee(txt.courriel || 'Courriel', a.email, 'courriel')]),
      ligne([rangee(txt.orcid || 'ORCID', a.orcid, 'orcid'), rangee(txt.ror || 'ROR', a.ror, 'ror')])
    ]
  }));
  const textes = [
    rangeeMultilingue(txt.titre || 'Titre', v.title, langues),
    rangeeMultilingue(txt.sousTitre || 'Sous-titre', v.subtitle, langues),
    rangeeMultilingue(txt.resume || 'Résumé', v.resume, langues)
  ];
  return {
    slug: article.slug, index: index, total: total,
    langues: langues.map((l) => ({ code: l, libelle: libelleDe(lib.langues, l) || l })),
    identification: identification, textes: textes,
    motsCles: rangeesMotsCles(v.keywords, langues),
    auteurs: auteurs, sansAuteur: auteurs.length === 0,
    empreinte: empreinte(v)
  };
}

// Le modèle complet passé au gabarit. `horodatage` est injecté plutôt que lu ici : un
// module pur ne lit pas l'heure, et un test doit pouvoir figer la feuille entière.
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

// Rend le HTML autonome. Le gabarit porte la mise en page, les intitulés et la légende —
// il se retouche sans toucher à ce fichier. Ce module ne lui fournit que des valeurs.
// Le moteur rend une table de blocs : la page entière tient dans `contenu`, comme les
// exports du secrétariat. Un gabarit qui perdrait son bloc rendrait une page vide, et
// c'est ce que dit l'erreur plutôt que d'écrire un fichier muet.
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
