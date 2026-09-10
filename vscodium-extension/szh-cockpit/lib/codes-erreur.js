// La table des codes d'erreur applicatifs et le schéma v1 des rapports automatiques
// (SPEC-RAPPORTS.md, §3 et §4) : données pures et fonctions pures, sans dépendance — ni
// `vscode`, ni `fs`, aucun accès disque. Chargeable en CommonJS aussi bien par l'extension
// du cockpit que par les tests. Le futur écrivain PowerShell (lanceur) n'exécute pas ce
// fichier — il ne sait pas lire du JS — mais doit reproduire à l'identique les algorithmes
// qu'il décrit (format de l'id, calcul de la signature, ordre du masquage) : ce fichier en
// est la référence exécutable et testée, les commentaires en sont la spécification pour
// l'autre langage.
//
// Règle de stabilité : un CODE publié (clé de CODES) ne se renomme et ne se supprime
// jamais — un outil déployé peut encore l'écrire des mois après qu'une version plus
// récente a changé de vocabulaire. De même pour SCHEMA_VERSION et les valeurs des
// énumérations closes ci-dessous : elles ne changent pas de sens, elles ne changent pas de
// graphie. Un changement de forme du rapport (nouveau champ obligatoire, sens différent
// d'un champ existant) passe par une NOUVELLE valeur de SCHEMA_VERSION
// (« szh-rapport-erreur/2 », etc.), jamais par une modification silencieuse de la version 1.
//
// Ce module ne construit aucun rapport et n'écrit rien : il fournit la table des codes, les
// constantes du schéma, et les fonctions pures (masquage, mise en chemin relatif, signature,
// id, plafonds, validation) que les deux écrivains — Write-SzhRapportErreur côté
// PowerShell, l'équivalent côté cockpit — appliquent chacun de leur côté avant d'écrire un
// fichier. Voir docs/RAPPORTS-ERREUR.md pour la référence lisible du schéma.
'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------------------
// 1. La table des codes (§3)
// ---------------------------------------------------------------------------------------
//
// Un `resume` par langue : une phrase courte, factuelle, jamais alarmiste, lisible par une
// personne qui ouvre le fichier JSON sans être technicienne. Elle ne remplace pas `message`
// (le détail technique) : elle dit juste, en une ligne, ce qui s'est passé.

const CODES = Object.freeze({
  'LANCEUR-TRAP': Object.freeze({
    resume: Object.freeze({
      fr: 'Une erreur inattendue est survenue à l’ouverture du lanceur ; ce rapport en garde la trace pour le diagnostic.',
      de: 'Beim Öffnen des Starters ist ein unerwarteter Fehler aufgetreten; dieser Bericht hält ihn zur Diagnose fest.'
    })
  }),
  'LANCEUR-CODIUM-ABSENT': Object.freeze({
    resume: Object.freeze({
      fr: 'VSCodium est introuvable au démarrage du lanceur ; l’éditeur ne peut pas s’ouvrir tant qu’il n’est pas réinstallé.',
      de: 'VSCodium wurde beim Start des Starters nicht gefunden; der Editor kann erst nach einer Neuinstallation geöffnet werden.'
    })
  }),
  'ANCRAGE-INTROUVABLE': Object.freeze({
    resume: Object.freeze({
      fr: 'Aucun dossier SharePoint n’a pu être identifié, ni automatiquement ni par la personne consultée ; les produits restent introuvables jusqu’à ce qu’il soit indiqué.',
      de: 'Es konnte kein SharePoint-Ordner gefunden werden, weder automatisch noch durch Rückfrage; die Produkte bleiben unauffindbar, bis er angegeben wird.'
    })
  }),
  'MAJ-ETAPE-ECHEC': Object.freeze({
    resume: Object.freeze({
      fr: 'Une étape de la mise à jour a échoué, mais les suivantes ont continué ; ce rapport précise laquelle.',
      de: 'Ein Schritt der Aktualisierung ist fehlgeschlagen, die übrigen wurden trotzdem fortgesetzt; dieser Bericht nennt den betroffenen Schritt.'
    })
  }),
  'MAJ-ECHEC': Object.freeze({
    resume: Object.freeze({
      fr: 'La mise à jour s’est arrêtée avant la fin ; le poste garde la version qu’il avait avant l’essai.',
      de: 'Die Aktualisierung wurde vorzeitig abgebrochen; der Rechner behält die Version, die er vor dem Versuch hatte.'
    })
  }),
  'ARCHIVAGE-ECHEC': Object.freeze({
    resume: Object.freeze({
      fr: 'Le déplacement d’un numéro ou d’un livre vers les archives n’a pas abouti ; rien n’a été perdu, il reste à l’endroit où il était.',
      de: 'Das Verschieben einer Ausgabe oder eines Buches ins Archiv ist nicht gelungen; nichts ist verloren gegangen, es bleibt an seinem bisherigen Ort.'
    })
  }),
  'COMPIL-ECHEC': Object.freeze({
    resume: Object.freeze({
      fr: 'La compilation s’est arrêtée sans produire de résultat exploitable ; le journal de la tâche en donne le détail.',
      de: 'Die Kompilierung wurde beendet, ohne ein brauchbares Ergebnis zu liefern; das Aufgabenprotokoll enthält die Einzelheiten.'
    })
  }),
  'COCKPIT-EXCEPTION': Object.freeze({
    resume: Object.freeze({
      fr: 'Une erreur inattendue est survenue dans l’extension du cockpit ; VSCodium reste ouvert, seule une fonctionnalité peut être affectée.',
      de: 'In der Cockpit-Erweiterung ist ein unerwarteter Fehler aufgetreten; VSCodium bleibt geöffnet, nur eine einzelne Funktion kann betroffen sein.'
    })
  }),
  // Jamais écrit en rapport (voir §3) : cette entrée existe pour que la table reste
  // complète et que le code soit connu de validerRapport() si, un jour, quelqu'un se
  // trompe et l'écrit quand même — l'écrivain, lui, ne doit jamais boucler sur son propre
  // échec d'écriture.
  'RAPPORT-ECHEC-ECRITURE': Object.freeze({
    resume: Object.freeze({
      fr: 'L’écriture d’un rapport d’erreur a elle-même échoué ; par construction, cet échec n’est jamais transformé en nouveau rapport, seul le journal local le garde.',
      de: 'Das Schreiben eines Fehlerberichts ist selbst fehlgeschlagen; dieser Fehler wird bewusst nicht erneut als Bericht erzeugt, nur das lokale Protokoll hält ihn fest.'
    })
  })
});

// ---------------------------------------------------------------------------------------
// 2. Les constantes du schéma (§4)
// ---------------------------------------------------------------------------------------

const SCHEMA_VERSION = 'szh-rapport-erreur/1';

// Énumérations closes. Une valeur hors de ces listes est un rapport mal formé.
const GRAVITES = Object.freeze(['erreur', 'echec-partiel']);
const SOURCES = Object.freeze(['lanceur', 'maj', 'archivage', 'cockpit', 'chaine']);
const RELATIFS = Object.freeze(['ancrage', 'programdata', 'absolu']);
const ORIGINES_ANCRAGE = Object.freeze(['essai', 'config', 'cache', 'auto', 'utilisateur', 'defaut', 'absent']);

// L'ordre exact des clés de premier niveau, tel que gelé au §4. C'est ce que l'écrivain
// doit respecter en construisant l'objet avant sérialisation, et ce que validerRapport()
// contrôle.
const ORDRE_CLES_RAPPORT = Object.freeze([
  'schema', 'id', 'horodatage', 'horodatageLocal', 'gravite', 'source', 'code', 'signature',
  'resume', 'etape', 'message', 'pile', 'poste', 'versions', 'produit', 'ancrage', 'fichiers',
  'journal', 'constats', 'environnement'
]);

// Racine ProgramData de la chaîne SZH (docs/EMPLACEMENTS.md) : invariante sur tous les
// postes, donc un défaut raisonnable pour masquer() quand l'appelant ne la précise pas.
// L'ancrage SharePoint et %USERPROFILE%, eux, dépendent du poste et doivent être fournis
// par l'appelant (ce module ne lit ni le disque ni l'environnement).
const RACINE_PROGRAMDATA = 'C:\\ProgramData\\SZH';

// L'unique adresse qui survit au masquage des courriels (§4.1, règle 6) : celle du
// support, déjà publique dans le dépôt (gabarits de courriel, README). Toute autre adresse
// — et c'est là tout l'enjeu — est masquée, y compris celle de la personne qui utilise
// l'outil : D3 l'exclut explicitement du rapport.
const COURRIEL_SUPPORT = 'robin.morand@szh.ch';

// §4.2 — Plafonds non négociables.
const PLAFONDS = Object.freeze({
  message: 4000,
  pile: 8000,
  journalExtraitLignes: 200,
  journalExtraitCaracteres: 40000,
  fichiers: 50,
  constats: 100,
  fichierOctets: 256 * 1024
});

// §4.3 — Anti-inondation.
const ANTI_INONDATION = Object.freeze({
  signaturePeriodeHeures: 24,
  rapportsParJourMax: 20,
  purgeCompteursJours: 7
});

// §4 — Format et longueur de l'id (voir calculerId ci-dessous pour la construction).
const ID_LONGUEUR_MAX = 120;
const FORMAT_ID = /^\d{8}-\d{6}-[A-Za-z0-9-]+-[0-9a-f]{6}$/;

// ---------------------------------------------------------------------------------------
// 3. Masquage (§4.1)
// ---------------------------------------------------------------------------------------
//
// Sept règles (la 5 s'est scindée en 5a/5b — voir l'AMENDEMENT du 09.09.2026 ci-dessous),
// appliquées dans CET ordre à `message`, `pile`, `journal.extrait` (chaque ligne), et à
// tout chemin destiné à rester en clair dans le rapport. L'ordre n'est pas arbitraire :
//
//   1-2-3 (racines connues avant tout le reste) — chaque règle RACCOURCIT le texte avant
//   que les règles génériques (5a/5b) ne s'appliquent. Traiter 1 avant 2 avant 3 fait aussi
//   gagner la racine la plus spécifique : l'ancrage SharePoint est presque toujours SOUS
//   %USERPROFILE%, donc si la règle 2 passait en premier, le préfixe utilisateur serait
//   retiré avant que la règle 1 n'ait pu reconnaître l'ancrage, et le chemin retomberait
//   sur « ~\… » au lieu du relatif à l'ancrage, qui porte davantage de sens (D3, D4).
//
//   4 avant 5b avant 5a — un couple mot-clé/valeur (« token: XXXX ») est le plus précis :
//   le traiter en premier documente l'intention exacte de ce qui a été trouvé. 5b (le motif
//   d'un JWT complet, segments et points compris) doit passer AVANT 5a : un segment de JWT
//   pris isolément (entre deux points) peut dépasser 32 caractères et mélanger casse et
//   chiffres — 5a le masquerait seul, laissant les autres segments (et leurs points)
//   intacts, exactement le défaut relevé (voir plus bas). 5b consomme le jeton ENTIER en un
//   seul passage ; 5a, ensuite, ne trouve donc plus rien de ce jeton à mordre.
//
//   5a/5b avant 6 — les règles génériques peuvent mordre sur la partie locale d'une adresse
//   courriel si elle est longue ; la traiter avant l'email n'aggrave rien (le résultat
//   reste illisible comme adresse), et la traiter après casserait le motif d'email que la
//   règle 6 cherche à reconnaître dans le texte déjà modifié par 1-3.
//
// AMENDEMENT du 09.09.2026 (auteur de la spec, pas un défaut d'implémentation) — la règle 5
// originale (« toute suite de ≥ 32 caractères de [A-Za-z0-9+/=_-] ») incluait `/` : mesurée
// sur des lignes réelles de la chaîne, elle masquait donc exactement ce que D3 demande de
// garder — un chemin relatif (`2_Produkte/…/03-inclusion.md` → `***.md`), une URL
// (`https://www.szh-csps.ch/… ` → `https://www.szh-csps.***`), une empreinte SHA-256 (le
// sujet même de `err.empreinte`). Remplacée par deux règles plus étroites :
//
//   5a — secret nu, resserré : ≥ 32 caractères de [A-Za-z0-9+=_-] (`/` RETIRÉ — un `/`
//   signe presque toujours un chemin ou une URL, jamais un secret encodé dans ce dépôt),
//   qui porte À LA FOIS une majuscule, une minuscule et un chiffre (la signature d'un jeton
//   à haute entropie — un chemin, un slug ou une empreinte ne présentent pas ce mélange),
//   ET qui n'est pas purement hexadécimale une fois les tirets de séparation ignorés (pour
//   ne jamais toucher une empreinte SHA-1/SHA-256 ou un GUID, tirets compris).
//
//   5b — jeton en segments (JWT) : `eyJ[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_.-]+)+` en entier.
//   La règle 4 seule ne suffit pas : sur « Authorization: Bearer eyJ…xxx.eyJ…yyy.zzz », le
//   mot-clé reconnu est `authorization`, dont la valeur capturée (un seul jeton, jusqu'au
//   prochain espace) est le mot « Bearer » — PAS le jeton qui le suit après son propre
//   espace. Le jeton restait donc entier face à la règle 4, et l'ancienne règle 5 le
//   redécoupait par ses points, ne masquant que les segments individuellement assez longs :
//   la charge utile d'un JWT (souvent < 32 caractères pour un jeton de test) survivait,
//   lisible en base64 — une vraie fuite d'identité, relevée sur le terrain.
//
// Limite assumée, à connaître : un secret nu SANS mot-clé qui l'annonce, et dont TOUTES les
// lettres sont en minuscules (ou dans les deux cas mais sans jamais mélanger les trois
// familles majuscule/minuscule/chiffre) échappe à 5a — une clé DeepL nue en est un exemple
// réel (hexadécimal minuscule et tirets, sans majuscule). Rien dans la ligne ne la
// distingue alors d'un slug ou d'un GUID sans lire sa provenance. Le filet de sécurité
// reste la règle 4 : ces clés-là (DeepL notamment) sont censées apparaître précédées de
// leur mot-clé dans un message construit par l'outil, pas nues dans une pile d'appel tierce.
function motifRacineSource(racine) {
  const segments = String(racine).split(/[\\/]+/).filter(Boolean);
  return segments
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\\\/]+');
}

// Remplace, partout dans `texte`, la racine donnée (insensible à la casse, séparateurs \
// et / interchangeables) et le séparateur qui la suit immédiatement par `remplacement`.
// Sans racine, ne fait rien : c'est ce qui permet à masquer() d'ignorer une racine que
// l'appelant ne connaît pas (ex. pas d'ancrage résolu sur ce poste) sans code particulier.
function remplacerRacine(texte, racine, remplacement) {
  if (!racine) { return texte; }
  const motif = new RegExp(motifRacineSource(racine) + '[\\\\/]?', 'gi');
  return texte.replace(motif, remplacement);
}

// Règle 4 : mots-clés de secret suivis d'une valeur (un seul jeton, jusqu'au prochain
// espace — un mot de passe à espaces échappe à cette règle précise, mais reste exposé à
// la règle 5 dès qu'il contient une suite assez longue sans espace).
const MOTIF_SECRET_NOMME =
  /\b(api[-_ ]?key|token|secret|authorization|bearer|deepl|password|mot de passe|pwd)(\s*[:=]\s*|\s+)(\S+)/gi;

// Règle 5b : un JWT complet (en-tête, charge utile, signature), points compris — voir
// l'amendement ci-dessus. Doit s'appliquer avant 5a (raison donnée plus haut).
const MOTIF_JWT = /eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_.-]+)+/g;

// Règle 5a : candidates — suite de ≥ 32 caractères de [A-Za-z0-9+=_-] (`/` retiré : c'est
// la marque d'un chemin ou d'une URL, jamais d'un secret ici). Chaque candidate est ensuite
// filtrée par estSecretHauteEntropie() : la classe de caractères seule ne suffit pas à
// distinguer un jeton d'un chemin sans séparateur ou d'une longue empreinte.
const MOTIF_SUITE_CANDIDATE = /[A-Za-z0-9+=_-]{32,}/g;

// Vrai si `s` porte les trois familles de caractères d'un secret à haute entropie
// (majuscule ET minuscule ET chiffre) et n'est pas, une fois ses tirets ignorés, une pure
// suite hexadécimale — auquel cas ce serait une empreinte (SHA-1/SHA-256) ou un GUID, que
// le masquage ne doit jamais toucher (§4.1 amendé).
function estSecretHauteEntropie(s) {
  if (!/[A-Z]/.test(s) || !/[a-z]/.test(s) || !/[0-9]/.test(s)) { return false; }
  if (/^[0-9a-fA-F-]+$/.test(s)) { return false; }
  return true;
}

// Règle 6 : une adresse courriel, sauf celle du support.
const MOTIF_COURRIEL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Masque un texte quelconque (message, pile, une ligne de journal, un chemin) selon les
// règles du §4.1 amendé, dans l'ordre justifié ci-dessus (1, 2, 3, 4, 5b, 5a, 6).
//   racines.ancrage      — chemin absolu de l'ancrage résolu sur ce poste, ou null/absent.
//   racines.userProfile  — %USERPROFILE%, ou null/absent (pas d'accès à l'environnement ici).
//   racines.programData  — défaut RACINE_PROGRAMDATA ; à ne fournir que pour un poste où
//                          la chaîne SZH vivrait ailleurs (tests, essentiellement).
function masquer(texte, racines) {
  const opts = racines || {};
  let s = texte === null || texte === undefined ? '' : String(texte);

  s = remplacerRacine(s, opts.ancrage, '');
  s = remplacerRacine(s, opts.userProfile, '~\\');
  s = remplacerRacine(s, opts.programData || RACINE_PROGRAMDATA, '');

  s = s.replace(MOTIF_SECRET_NOMME, (m, cle, sep) => cle + sep + '***');
  s = s.replace(MOTIF_JWT, '***');
  s = s.replace(MOTIF_SUITE_CANDIDATE, (m) => (estSecretHauteEntropie(m) ? '***' : m));
  s = s.replace(MOTIF_COURRIEL, (m) => (m.toLowerCase() === COURRIEL_SUPPORT.toLowerCase() ? m : '***@***'));

  return s;
}

// ---------------------------------------------------------------------------------------
// 4. Mise en chemin relatif à une racine donnée (§4, règle `relatifA`)
// ---------------------------------------------------------------------------------------
//
// Différent de masquer() : ceci construit la PAIRE { chemin, relatifA } d'un champ
// structuré (fichiers[].chemin, journal.chemin, ancrage.chemin), pas un remplacement dans
// du texte libre. Le chemin rendu utilise toujours `\`, pour qu'on puisse coller
// `<racine>\<chemin>` dans l'Explorateur Windows même si l'entrée mêlait les séparateurs.
function versCheminRelatif(chemin, racine, etiquette) {
  const brut = chemin === null || chemin === undefined ? '' : String(chemin);
  const normalise = brut.replace(/\//g, '\\');
  if (!racine) { return { chemin: normalise, relatifA: 'absolu' }; }
  const motif = new RegExp('^' + motifRacineSource(racine) + '[\\\\/]?', 'i');
  if (motif.test(brut)) {
    return { chemin: brut.replace(motif, '').replace(/\//g, '\\'), relatifA: etiquette };
  }
  return { chemin: normalise, relatifA: 'absolu' };
}

// ---------------------------------------------------------------------------------------
// 5. Signature anti-inondation (§4.3)
// ---------------------------------------------------------------------------------------
//
// signature = 12 premiers caractères hexadécimaux de SHA-256(source | code | etape |
// 200 premiers caractères du message MASQUÉ | produit.numero), chaque champ manquant
// (null/absent) valant chaîne vide. Le séparateur ' | ' est fixe : c'est ce texte-là,
// caractère pour caractère, que l'écrivain PowerShell doit reproduire pour qu'un compte
// qui reçoit le même rapport par les deux chemins (lanceur et cockpit) le regroupe de la
// même façon. `messageMasque` doit déjà avoir passé masquer() : cette fonction ne masque
// rien elle-même, pour rester indépendante du contexte (racines du poste) dont elle n'a
// pas besoin.
function versTexteSignature(v) {
  return v === null || v === undefined ? '' : String(v);
}

function calculerSignature(champs) {
  const c = champs || {};
  const morceaux = [
    versTexteSignature(c.source),
    versTexteSignature(c.code),
    versTexteSignature(c.etape),
    versTexteSignature(c.messageMasque).slice(0, 200),
    versTexteSignature(c.produitNumero)
  ];
  const empreinte = crypto.createHash('sha256').update(morceaux.join(' | '), 'utf8').digest('hex');
  return empreinte.slice(0, 12);
}

// ---------------------------------------------------------------------------------------
// 6. L'identifiant du rapport (§4)
// ---------------------------------------------------------------------------------------
//
// `<AAAAMMJJ-HHmmss>-<poste>-<6 hex>`, ASCII, ≤ 120 caractères, et c'est le nom du fichier
// (`<id>.json`) : un tri alphabétique doit donc être un tri chronologique.
//
// Point gelé qu'une implémentation naïve manquerait facilement : l'exemple du §4 porte
// "horodatage": "…08:15:30Z" et "horodatageLocal": "…10:15:30+02:00" (été, UTC+2), et
// l'id, lui, porte "081530" — l'heure UTC, pas l'heure locale. C'est nécessaire pour que
// le tri reste chronologique été comme hiver : l'heure locale recule d'une heure au
// changement d'heure et briserait l'ordre alphabétique une fois par an. calculerId()
// prend donc l'horodatage UTC (le paramètre `horodatage`, interprété comme instant absolu
// — un Date ou une chaîne ISO — jamais l'heure locale déjà décalée).
function formaterHorodatageId(horodatage) {
  const d = horodatage instanceof Date ? horodatage : new Date(horodatage);
  if (Number.isNaN(d.getTime())) {
    throw new Error('formaterHorodatageId : horodatage invalide (' + horodatage + ')');
  }
  const p2 = (n) => String(n).padStart(2, '0');
  return String(d.getUTCFullYear()) + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate())
    + '-' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds());
}

// Rend le nom du poste ASCII et sans risque pour un nom de fichier : diacritiques
// retirés (translittération NFD), tout le reste ramené à des majuscules, chiffres et
// tirets. Un COMPUTERNAME Windows classique (≤ 15 caractères, déjà ASCII) traverse cette
// fonction sans y perdre un caractère ; la borne à 40 n'est là que pour les noms
// exotiques (DNS long, poste de test) et garde l'id entier très en dessous de 120.
function nettoyerPoste(nom) {
  const base = String(nom === null || nom === undefined ? '' : nom)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let nettoye = base.toUpperCase().replace(/[^A-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!nettoye) { nettoye = 'POSTE'; }
  return nettoye.slice(0, 40);
}

// `aleatoireHex` : 6 caractères hexadécimaux, fournis par l'appelant (voir
// genererAleatoireHex ci-dessous) — calculerId() reste ainsi une fonction pure et
// déterministe, testable sans dépendre d'une source d'aléa.
function calculerId(horodatage, poste, aleatoireHex) {
  const hex = String(aleatoireHex === null || aleatoireHex === undefined ? '' : aleatoireHex).toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) {
    throw new Error('calculerId : aleatoireHex doit être 6 caractères hexadécimaux, reçu ' + JSON.stringify(aleatoireHex));
  }
  return formaterHorodatageId(horodatage) + '-' + nettoyerPoste(poste) + '-' + hex;
}

// La seule fonction impure du module : une source d'aléa pour le suffixe de calculerId().
// Isolée ici pour que tout le reste du fichier reste pur et testable sans mock.
function genererAleatoireHex() {
  return crypto.randomBytes(3).toString('hex');
}

// ---------------------------------------------------------------------------------------
// 7. Plafonds appliqués à un rapport déjà construit (§4.2)
// ---------------------------------------------------------------------------------------
//
// Rend un NOUVEAU rapport (ne modifie pas celui qu'on lui passe) où `message`, `pile`,
// `fichiers`, `constats` et `journal.extrait` respectent leurs plafonds respectifs, puis,
// si le fichier entier dépasserait quand même 256 Ko une fois sérialisé (§4, en-tête :
// UTF-8 sans BOM, indenté 2 espaces), vide `journal.extrait` et pose `tronque: true` —
// c'est le seul champ qu'on sacrifie entièrement, parce que c'est le seul de taille non
// bornée par ailleurs (un `fichiers[].chemin` individuel, par exemple, n'a pas de plafond
// de longueur : seul son NOMBRE est plafonné à 50).
function tronquerTexte(valeur, max) {
  if (typeof valeur !== 'string') { return valeur; }
  return valeur.length > max ? valeur.slice(0, max) : valeur;
}

function appliquerPlafonds(rapport) {
  const r = JSON.parse(JSON.stringify(rapport === null || rapport === undefined ? {} : rapport));

  r.message = tronquerTexte(r.message, PLAFONDS.message);
  r.pile = tronquerTexte(r.pile, PLAFONDS.pile);

  // La spec ne dit pas quelle extrémité garder si la liste déborde ; on garde les
  // PREMIÈRES entrées (celles que l'appelant a écrites en premier — typiquement la plus
  // proche de l'action qui a échoué), symétriquement à `journal.extrait` qui garde les
  // DERNIÈRES lignes (celles les plus proches, chronologiquement, du moment de l'erreur).
  if (Array.isArray(r.fichiers) && r.fichiers.length > PLAFONDS.fichiers) {
    r.fichiers = r.fichiers.slice(0, PLAFONDS.fichiers);
  }
  if (Array.isArray(r.constats) && r.constats.length > PLAFONDS.constats) {
    r.constats = r.constats.slice(0, PLAFONDS.constats);
  }

  if (r.journal && Array.isArray(r.journal.extrait)) {
    let lignes = r.journal.extrait;
    let tronque = !!r.journal.tronque;
    if (lignes.length > PLAFONDS.journalExtraitLignes) {
      lignes = lignes.slice(lignes.length - PLAFONDS.journalExtraitLignes);
      tronque = true;
    }
    // Les 200 dernières lignes peuvent encore dépasser 40 000 caractères (des lignes
    // longues) : on continue de retirer depuis le DÉBUT de ce qui reste, pour garder la
    // fin — la plus proche de l'erreur — le plus longtemps possible.
    while (lignes.length > 1 && lignes.join('\n').length > PLAFONDS.journalExtraitCaracteres) {
      lignes = lignes.slice(1);
      tronque = true;
    }
    if (lignes.length === 1 && lignes[0].length > PLAFONDS.journalExtraitCaracteres) {
      lignes = [lignes[0].slice(lignes[0].length - PLAFONDS.journalExtraitCaracteres)];
      tronque = true;
    }
    r.journal.extrait = lignes;
    r.journal.tronque = tronque;
  }

  if (Buffer.byteLength(JSON.stringify(r, null, 2), 'utf8') > PLAFONDS.fichierOctets && r.journal) {
    r.journal.extrait = [];
    r.journal.tronque = true;
  }

  return r;
}

// ---------------------------------------------------------------------------------------
// 8. Validation contre le schéma v1
// ---------------------------------------------------------------------------------------
//
// Rend la liste des écarts (chaînes lisibles), jamais ne lève. Un tableau vide veut dire
// « conforme ». Portée assumée : l'ordre des clés n'est contrôlé qu'au premier niveau —
// c'est le seul que le §4 gèle explicitement (« clés dans l'ordre ci-dessous ») ; les
// objets imbriqués (poste, versions, ancrage…) sont vérifiés sur leur contenu (énumérations,
// types), pas sur l'ordre de leurs propres clés.
function validerRapport(rapport) {
  const ecarts = [];
  if (!rapport || typeof rapport !== 'object' || Array.isArray(rapport)) {
    return ['le rapport doit être un objet'];
  }

  const clesPresentes = Object.keys(rapport);
  if (clesPresentes.join('\u0001') !== ORDRE_CLES_RAPPORT.join('\u0001')) {
    let signale = false;
    for (const cle of ORDRE_CLES_RAPPORT) {
      if (!(cle in rapport)) { ecarts.push('champ absent : ' + cle); signale = true; }
    }
    for (const cle of clesPresentes) {
      if (ORDRE_CLES_RAPPORT.indexOf(cle) === -1) { ecarts.push('champ inconnu du schéma v1 : ' + cle); signale = true; }
    }
    if (!signale) {
      ecarts.push('les clés de premier niveau ne sont pas dans l’ordre du schéma v1 : '
        + JSON.stringify(clesPresentes));
    }
  }

  if (rapport.schema !== SCHEMA_VERSION) {
    ecarts.push('schema doit valoir ' + JSON.stringify(SCHEMA_VERSION) + ', trouvé ' + JSON.stringify(rapport.schema));
  }
  if (typeof rapport.id !== 'string' || !FORMAT_ID.test(rapport.id) || rapport.id.length > ID_LONGUEUR_MAX) {
    ecarts.push('id ne respecte pas le format <AAAAMMJJ-HHmmss>-<poste>-<6 hex> : ' + JSON.stringify(rapport.id));
  }
  if (GRAVITES.indexOf(rapport.gravite) === -1) {
    ecarts.push('gravite hors énumération : ' + JSON.stringify(rapport.gravite));
  }
  if (SOURCES.indexOf(rapport.source) === -1) {
    ecarts.push('source hors énumération : ' + JSON.stringify(rapport.source));
  }
  if (typeof rapport.code !== 'string' || !(rapport.code in CODES)) {
    ecarts.push('code inconnu de la table : ' + JSON.stringify(rapport.code));
  }
  if (!rapport.resume || typeof rapport.resume.fr !== 'string' || typeof rapport.resume.de !== 'string') {
    ecarts.push('resume doit porter les deux clés fr et de');
  }

  if (!Array.isArray(rapport.fichiers)) {
    ecarts.push('fichiers doit être un tableau (vide au besoin), jamais null');
  } else {
    rapport.fichiers.forEach((f, i) => {
      if (!f || RELATIFS.indexOf(f.relatifA) === -1) {
        ecarts.push('fichiers[' + i + '].relatifA hors énumération : ' + JSON.stringify(f && f.relatifA));
      }
    });
  }
  if (!Array.isArray(rapport.constats)) {
    ecarts.push('constats doit être un tableau (vide au besoin), jamais null');
  }

  if (rapport.ancrage && rapport.ancrage.origine !== null && rapport.ancrage.origine !== undefined
    && ORIGINES_ANCRAGE.indexOf(rapport.ancrage.origine) === -1) {
    ecarts.push('ancrage.origine hors énumération : ' + JSON.stringify(rapport.ancrage.origine));
  }
  if (rapport.journal && rapport.journal.relatifA !== null && rapport.journal.relatifA !== undefined
    && RELATIFS.indexOf(rapport.journal.relatifA) === -1) {
    ecarts.push('journal.relatifA hors énumération : ' + JSON.stringify(rapport.journal.relatifA));
  }

  return ecarts;
}

module.exports = {
  // Table et constantes.
  CODES,
  SCHEMA_VERSION,
  GRAVITES,
  SOURCES,
  RELATIFS,
  ORIGINES_ANCRAGE,
  ORDRE_CLES_RAPPORT,
  RACINE_PROGRAMDATA,
  COURRIEL_SUPPORT,
  PLAFONDS,
  ANTI_INONDATION,
  ID_LONGUEUR_MAX,
  FORMAT_ID,
  // Fonctions pures.
  masquer,
  versCheminRelatif,
  calculerSignature,
  calculerId,
  formaterHorodatageId,
  nettoyerPoste,
  genererAleatoireHex,
  appliquerPlafonds,
  validerRapport
};
