// La table des codes d'erreur et le schéma v1 des rapports automatiques
// (docs/RAPPORTS-ERREUR.md). Données et fonctions pures, sans `vscode` ni accès disque.
//
// Le module ne construit ni n'écrit aucun rapport. Il fournit la table des codes, les
// constantes du schéma et les fonctions (masquage, chemin relatif, signature, id, plafonds,
// validation) que les deux écrivains appliquent avant d'écrire un fichier : le cockpit, et
// Write-SzhRapport (windows/szh-rapport.ps1). Ce dernier ne lit pas ce fichier ; il
// reproduit à l'identique le format de l'id, le calcul de la signature et l'ordre du
// masquage, que ce fichier et ses commentaires définissent.
//
// Stabilité : un code publié (clé de CODES) ne se renomme ni ne se supprime, car un outil
// déployé peut l'écrire longtemps après. SCHEMA_VERSION et les valeurs des énumérations
// closes ne changent ni de sens ni de graphie. Un changement de forme du rapport (champ
// obligatoire ajouté, sens d'un champ modifié) passe par une nouvelle SCHEMA_VERSION
// (« szh-rapport-erreur/2 »).
'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------------------
// 1. La table des codes
// ---------------------------------------------------------------------------------------
//
// Un `resume` par langue : une phrase courte et factuelle, lisible par une personne qui
// ouvre le fichier JSON sans être technicienne. Le détail technique est dans `message`.

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
  'ACCUEIL-COCKPIT-ABSENT': Object.freeze({
    resume: Object.freeze({
      fr: 'L’extension du cockpit manque sur ce poste, ou elle est trop ancienne pour ouvrir l’Accueil ; « Pronto (Updater) » la remet à jour.',
      de: 'Die Cockpit-Erweiterung fehlt auf diesem Computer oder ist zu alt, um die Startseite zu öffnen; «Pronto (Updater)» bringt sie auf den neuesten Stand.'
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
  // Le seul code déclenché par une personne et non par une panne : le bouton « Signaler une
  // erreur… » de l'onglet « Journal ». Sa gravité est « erreur », l'énumération étant close.
  'LANCEUR-SIGNALEMENT': Object.freeze({
    resume: Object.freeze({
      fr: 'Une personne a signalé elle-même un problème depuis l’onglet « Journal » du lanceur ; le message est celui qu’elle a écrit, et le journal joint celui qu’elle a choisi.',
      de: 'Eine Person hat ein Problem selbst über die Registerkarte «Protokoll» des Starters gemeldet; die Meldung ist ihr eigener Text, das beigefügte Protokoll das von ihr gewählte.'
    })
  }),
  // Signalement depuis une carte de contrôle du cockpit : le rapport porte le code du
  // constat (pas son texte), l'article et la fin du journal.
  'COCKPIT-SIGNALEMENT': Object.freeze({
    resume: Object.freeze({
      fr: 'Une personne a signalé elle-même un défaut depuis une carte de contrôle du cockpit ; le rapport nomme le contrôle et l’article, et joint la fin du journal de compilation.',
      de: 'Eine Person hat einen Fehler selbst über eine Prüfkarte des Cockpits gemeldet; der Bericht nennt die Prüfung und den Artikel und fügt das Ende des Kompilierprotokolls bei.'
    })
  }),
  // Le nettoyeur de manuscrit s'est arrêté sur un défaut du logiciel (plantage, lecture ou
  // perte de contenu que le manuscrit n'explique pas, rendu du rapport, environnement
  // inutilisable). Le rapport ne porte aucun texte du manuscrit : type, lieu dans le dépôt,
  // étape.
  'NETTOYEUR-ECHEC': Object.freeze({
    resume: Object.freeze({
      fr: 'Le nettoyeur de manuscrit s’est arrêté sur un défaut du logiciel, sans rapport avec le contenu du manuscrit ; ce rapport n’en garde que la nature et l’endroit, jamais le texte.',
      de: 'Der Manuskript-Bereiniger wurde durch einen Softwarefehler angehalten, der nichts mit dem Inhalt des Manuskripts zu tun hat; dieser Bericht hält nur Art und Ort fest, nie den Text.'
    })
  }),

  // Jamais écrit en rapport : l'écrivain ne doit pas boucler sur son propre échec. Le code
  // figure dans la table pour que validerRapport() le reconnaisse s'il était écrit par erreur.
  'RAPPORT-ECHEC-ECRITURE': Object.freeze({
    resume: Object.freeze({
      fr: 'L’écriture d’un rapport d’erreur a elle-même échoué ; par construction, cet échec n’est jamais transformé en nouveau rapport, seul le journal local le garde.',
      de: 'Das Schreiben eines Fehlerberichts ist selbst fehlgeschlagen; dieser Fehler wird bewusst nicht erneut als Bericht erzeugt, nur das lokale Protokoll hält ihn fest.'
    })
  })
});

// ---------------------------------------------------------------------------------------
// 2. Les constantes du schéma
// ---------------------------------------------------------------------------------------

const SCHEMA_VERSION = 'szh-rapport-erreur/1';

// Énumérations closes. Une valeur hors de ces listes est un rapport mal formé.
const GRAVITES = Object.freeze(['erreur', 'echec-partiel']);
const SOURCES = Object.freeze(['lanceur', 'maj', 'archivage', 'cockpit', 'chaine']);
const RELATIFS = Object.freeze(['ancrage', 'programdata', 'absolu']);
const ORIGINES_ANCRAGE = Object.freeze(['essai', 'config', 'cache', 'auto', 'utilisateur', 'defaut', 'absent']);

// L'ordre exact des clés de premier niveau, que l'écrivain respecte en construisant l'objet
// et que validerRapport() contrôle.
const ORDRE_CLES_RAPPORT = Object.freeze([
  'schema', 'id', 'horodatage', 'horodatageLocal', 'gravite', 'source', 'code', 'signature',
  'resume', 'etape', 'message', 'pile', 'poste', 'versions', 'produit', 'ancrage', 'fichiers',
  'journal', 'constats', 'environnement'
]);

// Racine ProgramData de la chaîne (docs/EMPLACEMENTS.md), la même sur tous les postes :
// défaut de masquer(). L'ancrage SharePoint et %USERPROFILE% dépendent du poste et sont
// fournis par l'appelant.
const RACINE_PROGRAMDATA = 'C:\\ProgramData\\SZH';

// La seule adresse que le masquage laisse en clair : celle du support, déjà publique dans
// le dépôt. Toutes les autres sont masquées, y compris celle de la personne qui utilise
// l'outil.
const COURRIEL_SUPPORT = 'robin.morand@szh.ch';

// Plafonds de taille.
const PLAFONDS = Object.freeze({
  message: 4000,
  pile: 8000,
  journalExtraitLignes: 200,
  journalExtraitCaracteres: 40000,
  fichiers: 50,
  constats: 100,
  fichierOctets: 256 * 1024
});

// Anti-inondation.
const ANTI_INONDATION = Object.freeze({
  signaturePeriodeHeures: 24,
  rapportsParJourMax: 20,
  purgeCompteursJours: 7
});

// Format et longueur de l'id (voir calculerId).
const ID_LONGUEUR_MAX = 120;
const FORMAT_ID = /^\d{8}-\d{6}-[A-Za-z0-9-]+-[0-9a-f]{6}$/;

// ---------------------------------------------------------------------------------------
// 3. Masquage
// ---------------------------------------------------------------------------------------
//
// Règles appliquées dans cet ordre à `message`, `pile`, chaque ligne de `journal.extrait`,
// et à tout chemin qui reste en clair dans le rapport :
//   1. l'ancrage SharePoint retiré ;
//   2. %USERPROFILE% remplacé par « ~\ » ;
//   3. la racine ProgramData retirée ;
//   4. un mot-clé de secret suivi d'une valeur (« token: XXXX ») : la valeur masquée ;
//   5b. un JWT complet, points compris ;
//   5a. un secret nu : ≥ 32 caractères de [A-Za-z0-9+=_-] mêlant majuscule, minuscule et
//       chiffre, qui n'est pas une suite hexadécimale (tirets ignorés) ;
//   6. toute adresse courriel sauf COURRIEL_SUPPORT.
//
// Pourquoi cet ordre :
// - 1 avant 2 : l'ancrage est presque toujours sous %USERPROFILE% ; le chemin doit rester
//   relatif à l'ancrage, plus parlant que « ~\… ».
// - 5b avant 5a : un segment de JWT pris seul peut ressembler à un secret nu ; 5a ne
//   masquerait que ce segment et laisserait lisible la charge utile.
// - 5a et 5b avant 6 : 6 cherche les adresses dans un texte déjà débarrassé des racines.
//
// 5a exclut `/`, qui signale un chemin ou une URL, et les suites hexadécimales, pour garder
// lisibles chemins relatifs, URL, empreintes et GUID. La règle 4 ne suffit pas pour un JWT :
// dans « Authorization: Bearer eyJ… », la valeur capturée est « Bearer », pas le jeton.
//
// Limite : un secret nu sans mot-clé, tout en minuscules (une clé DeepL : hexadécimal et
// tirets) échappe à 5a, car rien ne le distingue d'un slug ou d'un GUID. Ces clés doivent
// apparaître précédées de leur mot-clé, que la règle 4 reconnaît.
function motifRacineSource(racine) {
  const segments = String(racine).split(/[\\/]+/).filter(Boolean);
  return segments
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\\\/]+');
}

// Remplace partout dans `texte` la racine donnée (casse ignorée, \ et / équivalents) et le
// séparateur qui la suit par `remplacement`. Sans racine, ne fait rien.
function remplacerRacine(texte, racine, remplacement) {
  if (!racine) { return texte; }
  const motif = new RegExp(motifRacineSource(racine) + '[\\\\/]?', 'gi');
  return texte.replace(motif, remplacement);
}

// Règle 4 : mots-clés de secret suivis d'une valeur (un seul jeton, jusqu'à l'espace
// suivant).
const MOTIF_SECRET_NOMME =
  /\b(api[-_ ]?key|token|secret|authorization|bearer|deepl|password|mot de passe|pwd)(\s*[:=]\s*|\s+)(\S+)/gi;

// Règle 5b : un JWT complet (en-tête, charge utile, signature), points compris.
const MOTIF_JWT = /eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_.-]+)+/g;

// Règle 5a : candidates, ≥ 32 caractères de [A-Za-z0-9+=_-], filtrées ensuite par
// estSecretHauteEntropie().
const MOTIF_SUITE_CANDIDATE = /[A-Za-z0-9+=_-]{32,}/g;

// Vrai si `s` porte majuscule, minuscule et chiffre, et n'est pas une suite hexadécimale
// (tirets ignorés), ce qui serait une empreinte SHA-1/SHA-256 ou un GUID.
function estSecretHauteEntropie(s) {
  if (!/[A-Z]/.test(s) || !/[a-z]/.test(s) || !/[0-9]/.test(s)) { return false; }
  if (/^[0-9a-fA-F-]+$/.test(s)) { return false; }
  return true;
}

// Règle 6 : une adresse courriel, sauf celle du support.
const MOTIF_COURRIEL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Masque un texte (message, pile, ligne de journal, chemin) selon les règles ci-dessus, dans
// l'ordre 1, 2, 3, 4, 5b, 5a, 6.
//   racines.ancrage      — chemin absolu de l'ancrage du poste, ou absent.
//   racines.userProfile  — %USERPROFILE%, ou absent.
//   racines.programData  — RACINE_PROGRAMDATA par défaut ; à fournir seulement si la chaîne
//                          vit ailleurs (tests).
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
// 4. Chemin relatif à une racine
// ---------------------------------------------------------------------------------------
//
// Construit la paire { chemin, relatifA } d'un champ structuré (fichiers[].chemin,
// journal.chemin, ancrage.chemin) ; masquer(), lui, remplace dans du texte libre. Le chemin
// rendu utilise `\`, pour qu'on puisse coller `<racine>\<chemin>` dans l'Explorateur.
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
// 5. Signature anti-inondation
// ---------------------------------------------------------------------------------------
//
// signature = 12 premiers caractères hexadécimaux de SHA-256(source | code | etape |
// 200 premiers caractères du message masqué | produit.numero), un champ absent valant ''.
// Le séparateur ' | ' est fixe : l'écrivain PowerShell reproduit ce texte au caractère près,
// pour que le même incident ait la même signature des deux côtés. `messageMasque` doit déjà
// être passé par masquer().
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
// 6. L'identifiant du rapport
// ---------------------------------------------------------------------------------------
//
// `<AAAAMMJJ-HHmmss>-<poste>-<6 hex>`, ASCII, 120 caractères au plus. C'est aussi le nom du
// fichier (`<id>.json`) : le tri alphabétique doit être chronologique. L'heure est donc
// l'heure UTC, pas l'heure locale, qui recule d'une heure au changement d'heure.
// `horodatage` est un instant absolu : un Date ou une chaîne ISO.
function formaterHorodatageId(horodatage) {
  const d = horodatage instanceof Date ? horodatage : new Date(horodatage);
  if (Number.isNaN(d.getTime())) {
    throw new Error('formaterHorodatageId : horodatage invalide (' + horodatage + ')');
  }
  const p2 = (n) => String(n).padStart(2, '0');
  return String(d.getUTCFullYear()) + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate())
    + '-' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds());
}

// Le nom du poste en ASCII sûr pour un nom de fichier : diacritiques retirés (NFD), le reste
// ramené à des majuscules, chiffres et tirets, 40 caractères au plus. Un COMPUTERNAME
// Windows ordinaire (15 caractères ASCII au plus) passe sans perte.
function nettoyerPoste(nom) {
  const base = String(nom === null || nom === undefined ? '' : nom)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let nettoye = base.toUpperCase().replace(/[^A-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!nettoye) { nettoye = 'POSTE'; }
  return nettoye.slice(0, 40);
}

// `aleatoireHex` : 6 caractères hexadécimaux fournis par l'appelant (genererAleatoireHex),
// pour que calculerId() reste pure et déterministe.
function calculerId(horodatage, poste, aleatoireHex) {
  const hex = String(aleatoireHex === null || aleatoireHex === undefined ? '' : aleatoireHex).toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) {
    throw new Error('calculerId : aleatoireHex doit être 6 caractères hexadécimaux, reçu ' + JSON.stringify(aleatoireHex));
  }
  return formaterHorodatageId(horodatage) + '-' + nettoyerPoste(poste) + '-' + hex;
}

// Seule fonction impure du module : l'aléa du suffixe de calculerId().
function genererAleatoireHex() {
  return crypto.randomBytes(3).toString('hex');
}

// ---------------------------------------------------------------------------------------
// 7. Plafonds appliqués à un rapport déjà construit
// ---------------------------------------------------------------------------------------
//
// Rend un nouveau rapport (celui reçu n'est pas modifié) où `message`, `pile`, `fichiers`,
// `constats` et `journal.extrait` respectent leurs plafonds. Si le fichier sérialisé (UTF-8
// sans BOM, indenté de 2 espaces) dépasse encore 256 Ko, `journal.extrait` est vidé et
// `tronque` passe à true : c'est le seul champ de taille non bornée par ailleurs.
function tronquerTexte(valeur, max) {
  if (typeof valeur !== 'string') { return valeur; }
  return valeur.length > max ? valeur.slice(0, max) : valeur;
}

function appliquerPlafonds(rapport) {
  const r = JSON.parse(JSON.stringify(rapport === null || rapport === undefined ? {} : rapport));

  r.message = tronquerTexte(r.message, PLAFONDS.message);
  r.pile = tronquerTexte(r.pile, PLAFONDS.pile);

  // Une liste trop longue garde ses premières entrées, écrites en premier par l'appelant ;
  // `journal.extrait`, lui, garde ses dernières lignes, les plus proches de l'erreur.
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
    // Les 200 dernières lignes peuvent encore dépasser le plafond de caractères : on retire
    // depuis le début, pour garder la fin, la plus proche de l'erreur.
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
// Rend la liste des écarts (phrases lisibles) ; un tableau vide veut dire « conforme ». Ne
// lève pas. L'ordre des clés n'est contrôlé qu'au premier niveau, le seul que le schéma
// fixe ; les objets imbriqués sont vérifiés sur leur contenu (énumérations, types).
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
