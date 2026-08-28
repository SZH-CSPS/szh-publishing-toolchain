// Co-édition : deux postes travaillent le même numéro, et un seul à la fois modifie un
// fichier donné.
//
// ⚠ À NE PAS CONFONDRE avec lib/verrou.js. Là-bas, « verrou » veut dire numéro GELÉ en
// lecture seule à la fin du cycle (files.readonlyInclude, barre d'état « 🔒 Verrouillée »,
// clés i18n verrou.*). Ici, rien n'est gelé : on pose un BAIL de deux minutes sur un
// fichier pendant qu'un formulaire le modifie, et le bail s'éteint tout seul. Deux notions,
// deux vocabulaires — bail, titulaire, co-édition d'un côté ; verrou, numéro gelé de
// l'autre — et les gardes s'enchaînent dans cet ordre : le verrou du numéro refuse d'abord,
// le bail ensuite. Un numéro gelé ne doit jamais parler de co-édition.
//
// ── Le problème ───────────────────────────────────────────────────────────────────
// Le dossier du numéro vit sur OneDrive/SharePoint. Quand deux postes écrivent le même
// fichier dans la même fenêtre de synchronisation, le synchroniseur ne fusionne rien : il
// dépose une « copie en conflit » à côté, et une des deux saisies n'est plus dans le
// numéro. Sans que personne ne le voie — d'où aussi lib/copies-conflit.js, qui va chercher
// celles qui sont déjà là.
//
// ── Le bail expire seul ───────────────────────────────────────────────────────────
// Il dure BAIL_MS (2 min) et se renouvelle à chaque geste de son titulaire. Personne n'a
// donc à le rendre : un poste éteint, un VSCodium tué, un formulaire laissé ouvert au
// départ à midi — deux minutes sans geste et le fichier est libre. C'est la règle qui
// compte. Un bail capable de survivre à son titulaire bloquerait la rédaction entière, et
// la première panne le ferait débrancher pour de bon.
//
// ── Un fichier par titulaire, jamais un fichier partagé ───────────────────────────
// .szh-edition/<fichier-visé>--<qui>.json : deux postes qui posent leur bail au même
// instant écrivent deux fichiers DIFFÉRENTS. Le mécanisme censé éviter les copies en
// conflit n'en fabrique ainsi pas lui-même — ce qu'un fichier de bail unique et partagé
// ferait forcément. Le titulaire se lit en filtrant le dossier sur le préfixe du nom ; en
// cas de pose simultanée, le bail posé le premier gagne et l'autre se retire.
//
// ── Renouvellement étranglé ───────────────────────────────────────────────────────
// L'enregistrement automatique des formulaires tire toutes les trois secondes
// (media/_commun.js). Réécrire le bail à chaque fois ferait répliquer un fichier toutes les
// trois secondes par le synchroniseur : le remède nourrirait la maladie. Un bail plus jeune
// que RENOUVELLEMENT_MS n'est donc pas réécrit — la marge sur les deux minutes est large.
//
// ⚠ Ce que ce bail NE PEUT PAS faire. Il voyage par le synchroniseur, qui met de quelques
// secondes à quelques minutes. Entre l'instant où A le pose et celui où B le voit, deux
// saisies simultanées restent possibles : le bail ramène la fenêtre de plusieurs minutes à
// quelques secondes, il ne la ferme pas. D'où le second garde-fou, posé côté hôte :
// empreinte() du fichier au chargement du formulaire, comparée avant d'écrire dès que le
// bail a expiré. Voir extension.js, section « Co-édition ».
//
// ⚠ Horloges. Les dates sont écrites par le poste titulaire et relues par un autre.
// instantReference() retient la plus tardive de la date écrite et de celle du fichier, et
// écarte la première quand elle est manifestement en avance : un poste réglé une heure trop
// tard ne tient pas ses baux une heure. Le cas inverse — poste en RETARD — n'est pas
// rattrapable ici, le synchroniseur conservant la date de modification d'origine : son bail
// paraît déjà expiré aux autres. Sur un parc à l'heure du domaine l'écart est de quelques
// secondes ; c'est la limite assumée du mécanisme, pas un oubli.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DOSSIER_EDITION = '.szh-edition';

// Le bail que les autres postes respectent.
const BAIL_MS = 2 * 60 * 1000;
// Au-delà, une saisie restée à l'écran sans un geste ne peut plus être écrite de
// confiance : le fichier a pu changer entre-temps, et c'est l'empreinte qui tranche.
const INACTIVITE_MS = 5 * 60 * 1000;
// Un bail plus jeune que ça n'est pas réécrit : voir « Renouvellement étranglé ».
const RENOUVELLEMENT_MS = 30 * 1000;
// Les restes d'une session tuée sont ignorés dès l'expiration du bail ; ils ne sont
// EFFACÉS qu'un jour plus tard, et ceux des autres postes avec. Supprimer tôt un fichier
// qu'un autre poste tient encore, c'est demander au synchroniseur de le ressusciter.
const PEREMPTION_MS = 24 * 60 * 60 * 1000;

function dossierEdition(racine) { return path.join(racine, DOSSIER_EDITION); }

// Chemin du numéro -> clé du bail : séparateurs unifiés, casse ignorée. Windows ne
// distingue pas la casse, et le même fichier atteint par deux chemins doit donner un seul
// bail. null quand le chemin sort du numéro : il n'y a alors rien à protéger.
function clefFichier(racine, chemin) {
  if (!racine || !chemin) { return null; }
  const rel = path.relative(racine, chemin).split(path.sep).join('/');
  if (rel === '' || rel.startsWith('../') || rel === '..') { return null; }
  return rel.toLowerCase();
}

// Un morceau de nom de fichier sûr sur Windows. Les suites de « - » sont réduites, si bien
// qu'un jeton ne peut pas contenir le séparateur « -- » du nom complet.
function jeton(texte) {
  return String(texte === undefined || texte === null ? '' : texte)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
}

// Assez court pour que .szh-edition/… reste loin de la limite des chemins Windows, et
// unique : au-delà de 60 caractères, la fin est remplacée par l'empreinte de la clé.
function prefixe(clef) {
  const j = jeton(clef) || 'fichier';
  if (j.length <= 60) { return j; }
  return j.slice(0, 51) + '-' + crypto.createHash('sha1').update(clef).digest('hex').slice(0, 8);
}

// « qui » désigne une personne SUR UN POSTE. Le même nom sur deux machines pose deux baux,
// et c'est voulu : ce sont deux synchronisations distinctes, donc deux écrivains.
// `nomRegle` est le réglage szh.nomUtilisateur ; sans lui, le nom de session Windows.
function identite(nomRegle) {
  let utilisateur = String(nomRegle === undefined || nomRegle === null ? '' : nomRegle).trim();
  if (utilisateur === '') {
    try { utilisateur = String(os.userInfo().username || '').trim(); }
    catch (e) { /* pas de compte lisible */ }
  }
  if (utilisateur === '') { utilisateur = 'inconnu'; }
  let poste = '';
  try { poste = String(os.hostname() || '').trim(); } catch (e) { /* pas de nom de poste */ }
  return { utilisateur: utilisateur.slice(0, 80), poste: poste.slice(0, 80) };
}

function qui(id) { return id.utilisateur + '@' + (id.poste || 'poste'); }

function nomBail(clef, id) { return prefixe(clef) + '--' + (jeton(qui(id)) || 'qui') + '.json'; }

// Écriture atomique : temporaire « ~$… » — préfixe ignoré par la synchro OneDrive — puis
// rename. Un bail à moitié écrit serait lu comme illisible par le poste voisin.
function ecrireBail(fichier, valeurs) {
  const tmp = path.join(path.dirname(fichier), '~$' + path.basename(fichier));
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  try {
    fs.writeFileSync(tmp, JSON.stringify(valeurs, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, fichier);
  } finally {
    try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
  }
}

// La date dont on compte les deux minutes. Voir l'avis sur les horloges en tête de fichier.
function instantReference(renouvele, mtimeMs, maintenant) {
  const t = Date.parse(renouvele);
  if (!isFinite(t) || t > maintenant + BAIL_MS) { return mtimeMs; }
  return Math.max(t, mtimeMs);
}

// Un bail lu du disque, ou null si le fichier a disparu entre le listage et la lecture.
//
// Un contenu illisible n'est PAS ignoré : un bail à moitié synchronisé reste un bail, et
// son nom de fichier dit encore qui le tient. L'oublier ferait exactement la perte de
// saisie que ce module empêche.
function lireBail(dossier, nom) {
  const fichier = path.join(dossier, nom);
  let mtimeMs;
  try { mtimeMs = fs.statSync(fichier).mtimeMs; } catch (e) { return null; }
  let brut = null;
  try { brut = JSON.parse(String(fs.readFileSync(fichier, 'utf8')).replace(/^﻿/, '')); }
  catch (e) { /* illisible : le nom du fichier reste */ }
  const lisible = !!(brut && typeof brut === 'object' && !Array.isArray(brut));
  const separateur = nom.lastIndexOf('--');
  const depuisNom = separateur === -1 ? '' : nom.slice(separateur + 2).replace(/\.json$/i, '');
  return {
    nom: nom,
    fichier: lisible ? String(brut.fichier || '') : '',
    utilisateur: lisible && brut.utilisateur ? String(brut.utilisateur) : depuisNom,
    poste: lisible && brut.poste ? String(brut.poste) : '',
    qui: lisible && brut.qui ? String(brut.qui) : depuisNom,
    pose: lisible ? String(brut.pose || '') : '',
    renouvele: lisible ? String(brut.renouvele || '') : '',
    mtimeMs: mtimeMs,
    lisible: lisible
  };
}

// Les temporaires d'écriture atomique n'en sont pas : les lire, c'est courir après un
// fichier en train d'être renommé.
function nomsDuDossier(racine) {
  try {
    return fs.readdirSync(dossierEdition(racine))
      .filter((nom) => !nom.startsWith('~$') && /\.json$/i.test(nom));
  } catch (e) { return []; }                       // pas de dossier : aucun bail
}

// Tous les baux ENCORE VALIDES posés sur ce fichier, le plus ancien d'abord. Le filtre se
// fait d'abord sur le préfixe du nom — pas de lecture inutile — puis sur la clé écrite dans
// le fichier, deux chemins différents pouvant donner le même préfixe.
function baux(racine, clef, maintenant) {
  const dossier = dossierEdition(racine);
  const attendu = prefixe(clef) + '--';
  const trouves = [];
  for (const nom of nomsDuDossier(racine)) {
    if (!nom.startsWith(attendu)) { continue; }
    const b = lireBail(dossier, nom);
    if (!b) { continue; }
    if (b.lisible && b.fichier !== '' && b.fichier.toLowerCase() !== clef) { continue; }
    const reference = instantReference(b.renouvele, b.mtimeMs, maintenant);
    if (maintenant - reference >= BAIL_MS) { continue; }      // expiré : le fichier est libre
    b.reference = reference;
    trouves.push(b);
  }
  // Le plus ancien d'abord : c'est lui qui gagne une pose simultanée.
  trouves.sort((a, b) => {
    const ta = Date.parse(a.pose);
    const tb = Date.parse(b.pose);
    const va = isFinite(ta) ? ta : a.mtimeMs;
    const vb = isFinite(tb) ? tb : b.mtimeMs;
    if (va !== vb) { return va - vb; }
    return a.nom < b.nom ? -1 : (a.nom > b.nom ? 1 : 0);      // départage stable
  });
  return trouves;
}

// Le bail d'un AUTRE poste sur ce fichier, ou null. C'est la seule question que se posent
// les gestes qui écrivent sans tenir de session — déplacer un article, cocher « pas de
// DOI », geler le numéro : ils regardent, ils ne posent rien.
function titulaireAutre(racine, chemin, id, maintenant) {
  const clef = clefFichier(racine, chemin);
  if (!clef) { return null; }
  const t = maintenant === undefined ? Date.now() : maintenant;
  const moi = qui(id);
  const autres = baux(racine, clef, t).filter((b) => b.qui !== moi);
  return autres.length > 0 ? autres[0] : null;
}

// Tous les baux valides du numéro, hors les nôtres, le plus ancien d'abord. La question de
// l'archivage : quelqu'un travaille-t-il encore quelque part dans ce numéro ? Ici on lit le
// dossier entier, sans filtre de préfixe — il ne contient qu'un fichier par (fichier,
// personne), et l'archivage n'est pas un geste qu'on répète toutes les trois secondes.
function titulairesDuNumero(racine, id, maintenant) {
  const t = maintenant === undefined ? Date.now() : maintenant;
  const dossier = dossierEdition(racine);
  const moi = qui(id);
  const trouves = [];
  for (const nom of nomsDuDossier(racine)) {
    const b = lireBail(dossier, nom);
    if (!b || b.qui === moi) { continue; }
    if (t - instantReference(b.renouvele, b.mtimeMs, t) >= BAIL_MS) { continue; }
    trouves.push(b);
  }
  return trouves;
}

// Pose ou renouvelle le bail. -> { ok: true } quand le fichier est à nous, sinon
// { ok: false, titulaire } avec le bail qui barre la route.
//
// La pose se vérifie APRÈS écriture : deux postes peuvent avoir trouvé le fichier libre au
// même instant, et le second ne l'apprend qu'en relisant le dossier. Le plus ancien garde
// le fichier, le perdant retire son propre bail — sans quoi les deux se croiraient
// titulaires et écriraient ensemble.
function poser(racine, chemin, id, maintenant) {
  const clef = clefFichier(racine, chemin);
  if (!clef) { return { ok: true, hors: true }; }   // hors numéro : rien à protéger
  const t = maintenant === undefined ? Date.now() : maintenant;
  const moi = qui(id);
  const avant = baux(racine, clef, t);
  const barre = avant.find((b) => b.qui !== moi);
  if (barre) { return { ok: false, titulaire: barre }; }
  const mien = avant.find((b) => b.qui === moi);
  // Déjà à nous et tout frais : ne pas réécrire. Voir « Renouvellement étranglé ».
  if (mien && t - mien.reference < RENOUVELLEMENT_MS) { return { ok: true, inchange: true }; }
  const fichierBail = path.join(dossierEdition(racine), nomBail(clef, id));
  try {
    ecrireBail(fichierBail, {
      fichier: clef,
      utilisateur: id.utilisateur,
      poste: id.poste,
      qui: moi,
      // La date de pose ne bouge pas au renouvellement : c'est elle qui départage une pose
      // simultanée, et elle qui dit depuis quand la personne travaille le fichier.
      pose: mien && mien.pose !== '' ? mien.pose : new Date(t).toISOString(),
      renouvele: new Date(t).toISOString(),
      bail: BAIL_MS
    });
  } catch (e) {
    // Dossier en lecture seule, disque plein : la saisie n'est pas bloquée pour autant. Le
    // bail est un filet, jamais une condition d'écriture — et `echec` dit à l'appelant
    // qu'il écrit sans protection, pour qu'il ne prétende pas le contraire.
    return { ok: true, echec: String((e && e.message) || e) };
  }
  const apres = baux(racine, clef, t);
  const gagnant = apres.length > 0 ? apres[0] : null;
  if (gagnant && gagnant.qui !== moi) {
    try { fs.unlinkSync(fichierBail); } catch (e) { /* déjà retiré */ }
    return { ok: false, titulaire: gagnant };
  }
  return { ok: true };
}

// Rend le fichier tout de suite : formulaire fermé, panneau détruit. Sans cet appel le bail
// s'éteindrait seul en deux minutes — c'est le filet, pas le geste normal.
function rendre(racine, chemin, id) {
  const clef = clefFichier(racine, chemin);
  if (!clef) { return; }
  try { fs.unlinkSync(path.join(dossierEdition(racine), nomBail(clef, id))); }
  catch (e) { /* pas posé, ou déjà retiré */ }
}

// Le ménage. Les noms étant déterministes par (fichier, personne), le dossier ne grossit
// pas : ce ménage n'est là que pour qu'un numéro tranquille ne garde pas de dossier
// technique, et il attend un jour entier avant de toucher au bail d'un autre poste.
function purger(racine, maintenant) {
  const t = maintenant === undefined ? Date.now() : maintenant;
  const dossier = dossierEdition(racine);
  let restants = 0;
  for (const nom of nomsDuDossier(racine)) {
    const b = lireBail(dossier, nom);
    if (!b) { continue; }
    if (t - instantReference(b.renouvele, b.mtimeMs, t) < PEREMPTION_MS) { restants++; continue; }
    try { fs.unlinkSync(path.join(dossier, nom)); } catch (e) { restants++; }
  }
  if (restants === 0) { try { fs.rmdirSync(dossier); } catch (e) { /* pas vide : très bien */ } }
}

// L'empreinte du fichier visé, ou '' s'il n'existe pas. Second garde-fou : elle dit si le
// fichier a changé pendant qu'un formulaire le tenait à l'écran.
function empreinte(chemin) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(chemin)).digest('hex'); }
  catch (e) { return ''; }                         // absent ou illisible : pas d'empreinte
}

module.exports = {
  DOSSIER_EDITION, BAIL_MS, INACTIVITE_MS, RENOUVELLEMENT_MS, PEREMPTION_MS,
  dossierEdition, clefFichier, prefixe, jeton, identite, qui, nomBail,
  baux, titulaireAutre, titulairesDuNumero, poser, rendre, purger, empreinte, instantReference
};
