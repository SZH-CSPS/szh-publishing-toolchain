// Les adresses d'ojs.szh.ch : la base des deux revues, et les chemins (url_path) que Pronto
// fixe à l'export OJS, pour que la newsletter puisse lier un numéro ou un article avant sa
// publication. Utilisé par l'export OJS (lib/export-ojs.js), la newsletter et l'OAI-PMH
// (lib/secretariat.js, lib/auteurs-ojs.js).
//
// Règle des chemins (OJS les veut uniques dans la revue, en [a-z0-9-], pas seulement
// numériques) :
//   numéro                -> « 2026-03 »
//   article sans DOI      -> « 2026-03-documentation » (clé du numéro + slug sans son
//                            préfixe d'ordre « 10- »)
//   article avec DOI      -> pas de chemin : OJS garde son adresse par défaut
'use strict';

const BASE_OJS = 'https://ojs.szh.ch/index.php';
// Locale de la revue -> chemin de la revue sur le serveur.
const JOURNAUX = { fr: 'revue', de: 'zeitschrift' };

function urlJournal(locale) {
  const j = JOURNAUX[String(locale || '').toLowerCase()];
  return j ? BASE_OJS + '/' + j : '';
}

// Sans accent, en minuscules, [a-z0-9-] seulement, tirets simples, aucun tiret en bord.
function aplatir(texte) {
  return String(texte === undefined || texte === null ? '' : texte)
    .replace(/ß/g, 'ss').replace(/[æÆ]/g, 'ae').replace(/[œŒ]/g, 'oe')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Un texte devenu chemin. Vide quand il ne reste rien ou que des chiffres : OJS prendrait
// un chemin numérique pour un identifiant interne.
function normaliserCheminOjs(texte) {
  const s = aplatir(texte);
  return /^\d*$/.test(s) ? '' : s;
}

// « 2026-03 », ou '' quand l'année ou le numéro manque : un chemin à trous désignerait un
// autre numéro.
function cleNumero(annee, numero) {
  const an = (String(annee === undefined || annee === null ? '' : annee).match(/\d{4}/) || [''])[0];
  const chiffres = String(numero === undefined || numero === null ? '' : numero).replace(/\D+/g, '');
  if (an === '' || chiffres === '') { return ''; }
  const n = String(parseInt(chiffres, 10));
  return an + '-' + (n.length < 2 ? '0' + n : n);
}

function cheminNumero(annee, numero) { return normaliserCheminOjs(cleNumero(annee, numero)); }

// slug -> chemin, pour les articles sans DOI d'un numéro (`slugs`, dans l'ordre du numéro).
// Le slug perd son préfixe d'ordre, qui change quand on réordonne. Si deux slugs se
// confondent sans préfixe, tous deux le gardent, et un doublon restant reçoit un compteur.
// La clé du numéro, qui contient un tiret, empêche un chemin purement numérique.
function cheminsArticlesSansDoi(cle, slugs) {
  const base = normaliserCheminOjs(cle);
  const res = {};
  if (base === '') { return res; }
  const courts = slugs.map((s) => aplatir(String(s).replace(/^\d+-/, '')));
  const pleins = slugs.map((s) => aplatir(s));
  const vus = {};
  slugs.forEach((s, i) => {
    const doublon = courts[i] === '' || courts.some((c, j) => j !== i && c === courts[i]);
    const reste = doublon ? pleins[i] : courts[i];
    if (reste === '') { return; }
    let chemin = base + '-' + reste;
    if (vus[chemin]) { let k = 2; while (vus[chemin + '-' + k]) { k++; } chemin = chemin + '-' + k; }
    vus[chemin] = true;
    res[s] = chemin;
  });
  return res;
}

function urlNumero(locale, chemin) {
  const j = urlJournal(locale);
  return j && chemin ? j + '/' + String(locale).toLowerCase() + '/issue/view/' + chemin : '';
}
function urlArticle(locale, chemin) {
  const j = urlJournal(locale);
  return j && chemin ? j + '/' + String(locale).toLowerCase() + '/article/view/' + chemin : '';
}

module.exports = {
  BASE_OJS, JOURNAUX, urlJournal, normaliserCheminOjs, cleNumero, cheminNumero,
  cheminsArticlesSansDoi, urlNumero, urlArticle
};
