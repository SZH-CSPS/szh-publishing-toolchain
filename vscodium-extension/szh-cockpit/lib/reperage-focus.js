// Retrouver dans un .md le passage que désigne le `focus` d'un constat (lib/constats.js).
// Fonction pure : ni `vscode`, ni `fs` — lue par l'extension (surlignage du bouton « Vers
// l'article ») et par les tests, comme lib/formatting-pur.js et lib/codes-erreur.js.
//
// Le piège : `focus` vient d'un constat de citations, et pipeline/filters/szh-citations.lua
// l'a fait passer par sa fonction normaliser() avant de l'écrire — espaces insécables et
// fines ramenées à l'espace simple, tirets demi-cadratin/cadratin/insécable ramenés au trait
// d'union, suites d'espaces écrasées. Le .md sur le disque, lui, porte les caractères
// d'origine. Une recherche littérale de `focus` dans le texte réel échoue donc souvent.
//
// La parade : normaliser aussi le texte du document, de la même façon, mais en gardant pour
// chaque caractère normalisé la plage de caractères RÉELS qui l'a produit — une suite
// d'espaces écrasée pointe sur toute la suite, pas seulement sur le survivant. La recherche
// se fait alors sur les deux formes normalisées, et le résultat se retraduit en offsets
// réels pour poser un Range dans le document tel qu'il est sur le disque.
//
// ⚠ Recopié à la main depuis assainir()/normaliser() du filtre Lua (mêmes six caractères,
// même ordre) : pas d'import croisé JS/Lua possible. Si le filtre change ses substitutions,
// celles d'ici doivent suivre.
'use strict';

// Les six substitutions d'assainir() (szh-citations.lua) : un caractère pour un caractère,
// jamais une longueur qui change — la correspondance réel/normalisé reste 1 pour 1 ici.
const SUBSTITUTIONS = Object.freeze({
  ' ': ' ',   // espace insécable
  ' ': ' ',   // espace fine insécable
  ' ': ' ',   // espace fine
  '–': '-',   // tiret demi-cadratin (en dash)
  '—': '-',   // tiret cadratin (em dash)
  '‑': '-'    // trait d'union insécable
});

// %s du filtre Lua : espace, tabulation, saut de ligne, retour chariot, sauts de page.
function estBlanc(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v'; }

function substitue(c) { return Object.prototype.hasOwnProperty.call(SUBSTITUTIONS, c) ? SUBSTITUTIONS[c] : c; }

// Le balisage Markdown que pandoc retire avant de rendre un texte au filtre : l'emphase
// (* et _), l'échappement (\) et le code (`). Le constat porte le texte tel que
// utils.stringify() l'a aplati — « Soi-même comme un autre » —, le .md l'écrit
// « *Soi-même comme un autre* » : sans cette seconde passe, toute référence qui porte un
// titre en italique restait introuvable, et la flèche ouvrait l'article sans rien montrer.
const BALISAGE = new Set(['*', '_', '\\', '`']);

// Ce que le filtre ajoute ou abîme au bout d'un extrait : l'ellipse d'une troncature, et
// le caractère de remplacement qu'un sub(1, 70) en octets laisse quand il coupe une lettre
// accentuée en deux (Lua compte des octets, pas des caractères).
const QUEUE_PARASITE = /[…�\s]+$/;

// La longueur d'un préfixe qui suffit à désigner un passage : trente caractères d'une
// référence (« Ricœur, P. (1990). Soi-même co ») ne se répètent pas dans un article.
const PREFIXE_MIN = 30;

// -> { normalise, correspondance } où correspondance[i] = { debut, fin } sont les offsets,
// dans `texte`, du ou des caractères réels qui ont produit le caractère normalisé n°i.
// Pas de trim ici : une recherche de sous-chaîne n'en a pas besoin, seuls les bords du
// texte entier seraient concernés, jamais ceux d'un passage au milieu.
// `sansBalisage` saute en plus les caractères de BALISAGE : ils ne produisent aucun
// caractère normalisé, et la correspondance des suivants reste exacte.
function normaliserAvecCorrespondance(texte, sansBalisage) {
  const t = String(texte === undefined || texte === null ? '' : texte);
  let normalise = '';
  const correspondance = [];
  let i = 0;
  while (i < t.length) {
    if (sansBalisage && BALISAGE.has(t[i])) { i++; continue; }
    const c = substitue(t[i]);
    if (estBlanc(c)) {
      const debut = i;
      i++;
      while (i < t.length && estBlanc(substitue(t[i]))) { i++; }
      normalise += ' ';
      correspondance.push({ debut: debut, fin: i });
    } else {
      normalise += c;
      correspondance.push({ debut: i, fin: i + 1 });
      i++;
    }
  }
  return { normalise: normalise, correspondance: correspondance };
}

// Une recherche, sur une forme normalisée du document et de l'aiguille.
function chercher(texteDocument, brut, sansBalisage, prefixe) {
  let aiguille = normaliserAvecCorrespondance(brut, sansBalisage).normalise.trim();
  if (prefixe) {
    if (aiguille.length <= PREFIXE_MIN) { return null; }   // déjà cherché en entier
    aiguille = aiguille.slice(0, PREFIXE_MIN).trim();
  }
  if (aiguille === '') { return null; }
  const { normalise, correspondance } = normaliserAvecCorrespondance(texteDocument, sansBalisage);
  const idx = normalise.indexOf(aiguille);
  if (idx === -1) { return null; }
  return { debut: correspondance[idx].debut, fin: correspondance[idx + aiguille.length - 1].fin };
}

// Le passage que désigne `focus` dans `texteDocument`, ou null s'il est absent.
// -> { debut, fin } offsets réels (comme String.slice) dans `texteDocument`, ou null.
// Deux occurrences : la première gagne — indexOf() le fait déjà.
//
// Trois essais, du plus exact au plus lâche, et jamais plus lâche que nécessaire :
//   1. le texte entier, espaces et tirets normalisés (le cas des appels de citation) ;
//   2. le même, balisage Markdown ignoré des deux côtés (un titre en italique) ;
//   3. son début seulement (PREFIXE_MIN caractères), balisage ignoré : ce que le filtre
//      aplatit sans retour — un lien [texte](url) dont il ne garde que le texte, une
//      référence tronquée au milieu d'un DOI.
function trouverPlageFocus(texteDocument, focus) {
  const brut = String(focus === undefined || focus === null ? '' : focus)
    .replace(QUEUE_PARASITE, '').trim();
  if (brut === '') { return null; }
  return chercher(texteDocument, brut, false, false)
    || chercher(texteDocument, brut, true, false)
    || chercher(texteDocument, brut, true, true);
}

// ---- Les constats qui ne portent aucun texte ---------------------------------------
//
// Certains codes désignent un endroit du texte sans en citer un mot : « titres trop
// profonds », « bibliographie laissée dans le texte », « tableau des autrices et auteurs
// non lu ». Leur flèche ouvrait l'article en haut, et le rédacteur cherchait seul. Le
// passage se retrouve pourtant dans le .md, par sa forme : c'est ce que calcule
// focusDeRepli(), un extrait que trouverPlageFocus() saura ensuite sélectionner.

// La première ligne de titre à `niveau` dièses exactement (« ###### Annexe »), ou ''.
function premierTitreDeNiveau(texte, niveau) {
  const n = parseInt(niveau, 10);
  if (!(n > 0)) { return ''; }
  const re = new RegExp('^#{' + n + '}(?!#)[ \\t]+\\S.*$', 'm');
  const m = String(texte || '').match(re);
  return m ? m[0].trim() : '';
}

// Les intitulés que la chaîne reconnaît comme titre de bibliographie (le lexique de
// szh-citations.lua, est_titre_bib, en ses formes courantes) : comparés au titre entier,
// jamais par préfixe — « Literaturhinweise für die Praxis » n'en est pas un.
const TITRES_BIBLIO = /^#{1,6}[ \t]+(Bibliographie|Bibliografia|Références(?: bibliographiques)?|Literatur|Literaturverzeichnis|Literaturangaben|Quellen|Quellenverzeichnis|References|Bibliography)[ \t\r]*$/im;

function titreBibliographie(texte) {
  const m = String(texte || '').match(TITRES_BIBLIO);
  return m ? m[0].trim() : '';
}

// Le marqueur que l'import laisse à la place de la liste détachée : ce qui la suit dans le
// texte est justement ce que « biblio-incomplete » signale.
const MARQUE_BIBLIO = '{.szh-biblio';

// -> l'extrait du .md qui désigne l'endroit du défaut, ou '' quand rien ne le localise.
// `cle` « source/code » ; `args` ceux du constat ; `tables` [{ nom, html }] les tableaux
// de l'article (tables/*.html), lus par l'appelant.
function focusDeRepli(cle, args, texteMd, tables) {
  const texte = String(texteMd || '');
  switch (cle) {
    case 'rendu/niveaux-ecrases':
      // args[0] : « 6, 7 » — les niveaux écrasés, dans l'ordre ; le premier suffit.
      return premierTitreDeNiveau(texte, String((args || [])[0] || '').split(/[,\s]+/)[0]);
    case 'import/biblio-incomplete':
    case 'import/biblio-references-restees':
      return texte.indexOf(MARQUE_BIBLIO) !== -1 ? MARQUE_BIBLIO : '';
    case 'import/biblio-non-detachee':
    case 'import/biblio-bornes-perdues':
      return titreBibliographie(texte);
    case 'import/tableau-auteurs-non-lu': {
      // Le tableau qui porte des adresses e-mail : c'est lui que docx-meta.py n'a pas lu.
      const t = (tables || []).find((x) => /@[\w-]+\.[\w.-]+/.test(String(x.html || '')));
      const ref = t ? 'tables/' + t.nom : '';
      return ref !== '' && texte.indexOf(ref) !== -1 ? ref : '';
    }
    default:
      return '';
  }
}

module.exports = { trouverPlageFocus, normaliserAvecCorrespondance, focusDeRepli,
  premierTitreDeNiveau, titreBibliographie };
