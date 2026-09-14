// Suggestions de traduction : le dossier traduction/ d'un numéro, et le réglage qui pose
// les pastilles.
//
//   node --test "test/js/*.test.js"
//
// Ce que ce fichier garde :
//   * l'ALLER-RETOUR. On écrit un format que RIEN n'appelle encore en production : sans une
//     lecture éprouvée, une faute de structure — une clé renommée, un champ oublié —
//     passerait des mois sans se voir, et le jour où quelqu'un voudra relire ces fichiers,
//     ils seront tous faux. listerSuggestions est écrite pour cela, et éprouvée ici.
//   * les DEUX SUGGESTIONS DE LA MÊME SECONDE. Le nom porte la date à la seconde près :
//     cliquer la pastille, corriger, recliquer, et la deuxième suggestion écraserait la
//     première sans un mot. C'est exactement le geste qu'on attend de quelqu'un qui relit.
//   * le DOSSIER FRÈRE DE articles/. Les deux recensements d'articles du dépôt listent les
//     sous-dossiers de <racine>/articles : un dossier de suggestions placé là serait examiné
//     comme un article.
//   * le LISEZ-MOI POSÉ UNE FOIS. Quelqu'un a pu l'annoter ; une réécriture à chaque
//     suggestion effacerait cela en silence.
//   * la LECTURE QUI NE LÈVE PAS. Ces dossiers vivent sur OneDrive : un fichier tronqué en
//     cours de synchronisation ne doit pas emporter la lecture de tous les autres.
//   * le RÉGLAGE ÉTEINT PAR DÉFAUT, et tolérant à un config.json écrit à la main — la même
//     tolérance que l'emplacement des revues, sans quoi « "verifTraduction": "true" » se
//     lirait faux en silence.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const sugg = require(path.join(COCKPIT, 'lib', 'suggestion-traduction.js'));

// Un numéro jetable, avec son articles/ : le dossier de suggestions doit se ranger à côté.
function numeroEssai() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-sugg-'));
  fs.mkdirSync(path.join(racine, 'articles', 'mon-article'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'articles', 'mon-article', 'mon-article.md'), '# x\n');
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), 'revue: revue\n');
  return racine;
}

function proposition(extra) {
  return Object.assign({
    auteur: 'Robin', produit: 'revue', numero: '2026-03', article: 'mon-article',
    champ: 'title', langue: 'de',
    actuel: 'Alter Titel', propose: 'Neuer Titel', commentaire: 'Contresens sur « alt ».'
  }, extra || {});
}

test('une suggestion écrite se relit à l’identique', () => {
  const racine = numeroEssai();
  const res = sugg.ecrireSuggestion(racine, proposition());
  assert.ok(res.ok, 'écriture refusée : ' + JSON.stringify(res));

  const relues = sugg.listerSuggestions(racine);
  assert.strictEqual(relues.length, 1, 'une seule suggestion attendue');
  const s = relues[0];
  assert.strictEqual(s.schema, 'szh-suggestion-traduction/1');
  assert.strictEqual(s.auteur, 'Robin');
  assert.strictEqual(s.produit, 'revue');
  assert.strictEqual(s.numero, '2026-03');
  assert.strictEqual(s.article, 'mon-article');
  assert.strictEqual(s.champ, 'title');
  assert.strictEqual(s.langue, 'de');
  assert.strictEqual(s.actuel, 'Alter Titel');
  assert.strictEqual(s.propose, 'Neuer Titel');
  assert.strictEqual(s.commentaire, 'Contresens sur « alt ».');
  // L'horodatage porte son fuseau : sans lui, l'heure se relit à une heure près.
  assert.match(s.horodatage, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  // Le nom dit l'article, le champ et la langue : un dossier se lit sans rien ouvrir.
  assert.match(s.fichier, /^\d{8}-\d{6}-mon-article-title-de\.json$/);
});

test('deux suggestions de la même seconde sur le même champ ne s’écrasent pas', () => {
  const racine = numeroEssai();
  const meme = new Date(2026, 8, 14, 10, 30, 12);          // la même seconde, imposée
  const a = sugg.ecrireSuggestion(racine, proposition({ propose: 'Erster Versuch' }), meme);
  const b = sugg.ecrireSuggestion(racine, proposition({ propose: 'Zweiter Versuch' }), meme);
  assert.ok(a.ok && b.ok, 'une des deux écritures a été refusée');
  assert.notStrictEqual(a.nom, b.nom, 'les deux suggestions portent le même nom de fichier');
  assert.strictEqual(b.nom, '20260914-103012-mon-article-title-de-2.json');

  const relues = sugg.listerSuggestions(racine);
  assert.strictEqual(relues.length, 2, 'une des deux suggestions a été écrasée');
  // La plus récente d'abord : à horodatage égal, c'est le suffixe qui départage.
  assert.deepStrictEqual(relues.map((s) => s.propose), ['Zweiter Versuch', 'Erster Versuch']);
});

test('le tri rend la plus récente en premier', () => {
  const racine = numeroEssai();
  sugg.ecrireSuggestion(racine, proposition({ propose: 'Vieux' }), new Date(2026, 0, 2, 8, 0, 0));
  sugg.ecrireSuggestion(racine, proposition({ propose: 'Récent' }), new Date(2026, 5, 9, 17, 4, 30));
  assert.deepStrictEqual(sugg.listerSuggestions(racine).map((s) => s.propose), ['Récent', 'Vieux']);
});

test('le dossier est frère de articles/, jamais dedans', () => {
  const racine = numeroEssai();
  sugg.ecrireSuggestion(racine, proposition());
  assert.ok(fs.existsSync(path.join(racine, 'traduction')), 'dossier absent à la racine');
  assert.ok(!fs.existsSync(path.join(racine, 'articles', 'traduction')),
    'le dossier s’est rangé DANS articles/ : il y serait recensé comme un article');
  // La règle des deux recensements du dépôt, rejouée telle quelle : les sous-dossiers de
  // <racine>/articles qui portent <nom>/<nom>.md. C'est mot pour mot celle de
  // FournisseurRevue._sousDossiersAvecMd (extension.js) et de listerSlugs
  // (lib/export-ojs.js) — ni l'une ni l'autre n'est exportée, et ce contrôle vaut d'être
  // tenu à l'endroit où la règle est écrite, pas seulement là où elle est appliquée.
  const recenses = fs.readdirSync(path.join(racine, 'articles'), { withFileTypes: true })
    .filter((e) => e.isDirectory() &&
      fs.existsSync(path.join(racine, 'articles', e.name, e.name + '.md')))
    .map((e) => e.name);
  assert.deepStrictEqual(recenses, ['mon-article'],
    'le dossier de suggestions est entré dans le recensement des articles');
  // Et la source elle-même : les deux recensements partent bien de articles/, si bien que
  // rien à la racine du numéro ne peut y entrer.
  const extension = fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8');
  assert.match(extension, /_sousDossiersAvecMd\(path\.join\(this\.racine, dossierUnites\(\)\)\)/,
    'le recensement de l’arbre ne part plus du dossier des unités : la garde ne vaut plus');
  const ojs = fs.readFileSync(path.join(COCKPIT, 'lib', 'export-ojs.js'), 'utf8');
  assert.match(ojs, /const dossier = path\.join\(racine, 'articles'\)/,
    'le recensement de l’export OJS ne part plus de articles/ : la garde ne vaut plus');
});

test('le LISEZ-MOI est posé une fois, bilingue, et n’est plus réécrit', () => {
  const racine = numeroEssai();
  sugg.ecrireSuggestion(racine, proposition());
  const lisez = path.join(racine, 'traduction', 'LISEZ-MOI.txt');
  const texte = fs.readFileSync(lisez, 'utf8');
  assert.match(texte, /SUGGESTIONS/, 'le mode d’emploi ne dit pas ce que contient le dossier');
  assert.match(texte, /\[de\] /, 'le LISEZ-MOI n’existe qu’en français');
  assert.ok(!/\u00df/.test(texte), 'orthographe suisse : « ss », jamais « ß »');

  // Quelqu'un l'annote : la suggestion suivante ne doit pas effacer cette annotation.
  fs.writeFileSync(lisez, texte + '\r\nNote de la rédaction : lu le 14.09.\r\n');
  sugg.ecrireSuggestion(racine, proposition({ propose: 'Dritter Versuch' }));
  assert.match(fs.readFileSync(lisez, 'utf8'), /Note de la rédaction/,
    'le LISEZ-MOI a été réécrit, et l’annotation est perdue');
});

test('une suggestion sans changement et sans commentaire est refusée', () => {
  const racine = numeroEssai();
  const res = sugg.ecrireSuggestion(racine,
    proposition({ propose: 'Alter Titel', commentaire: '   ' }));
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.raison, 'vide');
  assert.strictEqual(sugg.listerSuggestions(racine).length, 0, 'un fichier vide de sens a été écrit');
  // Le même texte AVEC un commentaire a quelque chose à dire : c'est une remarque.
  assert.ok(sugg.ecrireSuggestion(racine,
    proposition({ propose: 'Alter Titel', commentaire: 'Vérifier la source.' })).ok);
});

test('un fichier illisible dans le dossier ne fait pas lever la lecture', () => {
  const racine = numeroEssai();
  sugg.ecrireSuggestion(racine, proposition());
  const dossier = path.join(racine, 'traduction');
  // Tronqué par une synchronisation OneDrive en cours, et un JSON qui n'est pas un objet.
  fs.writeFileSync(path.join(dossier, '20260914-090000-x-title-fr.json'), '{"schema": "szh-sug');
  fs.writeFileSync(path.join(dossier, '20260914-090001-x-title-fr.json'), '[1, 2, 3]');
  let relues;
  assert.doesNotThrow(() => { relues = sugg.listerSuggestions(racine); });
  assert.strictEqual(relues.length, 1, 'les fichiers illisibles auraient dû être sautés');
  assert.strictEqual(relues[0].propose, 'Neuer Titel');
});

test('un numéro sans dossier de suggestions se lit vide, sans lever', () => {
  const racine = numeroEssai();
  assert.deepStrictEqual(sugg.listerSuggestions(racine), []);
});

// ---- Le réglage du poste ------------------------------------------------------------
//
// Éteint par défaut : la pastille est un outil de relecture, pas l'état normal d'un
// formulaire de saisie. SZH_CONFIG_OJS détourne la lecture, comme dans config-poste.test.js :
// aucun test ne touche C:\ProgramData\SZH\config.json.

function archivageSur(config) {
  const chemin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'szh-verif-')), 'config.json');
  if (config !== null) { fs.writeFileSync(chemin, JSON.stringify(config, null, 2)); }
  process.env.SZH_CONFIG_OJS = chemin;
  delete require.cache[require.resolve(path.join(COCKPIT, 'lib', 'archivage.js'))];
  return { archivage: require(path.join(COCKPIT, 'lib', 'archivage.js')), chemin: chemin };
}

test('lireVerifTraduction rend faux par défaut, et lit un JSON écrit à la main', () => {
  const cas = [
    [null, false, 'aucune configuration'],
    [{}, false, 'clé absente'],
    [{ verifTraduction: true }, true, 'booléen vrai'],
    [{ verifTraduction: false }, false, 'booléen faux'],
    [{ verifTraduction: 'true' }, true, 'chaîne « true »'],
    [{ verifTraduction: 'false' }, false, 'chaîne « false »'],
    [{ verifTraduction: 1 }, true, 'nombre 1'],
    [{ verifTraduction: 0 }, false, 'nombre 0'],
    [{ verifTraduction: 'peut-être' }, false, 'valeur incompréhensible : éteint']
  ];
  try {
    for (const [config, attendu, quoi] of cas) {
      const { archivage } = archivageSur(config);
      assert.strictEqual(archivage.lireVerifTraduction(), attendu, quoi);
    }
  } finally {
    delete process.env.SZH_CONFIG_OJS;
  }
});

test('ecrireVerifTraduction pose un booléen propre sans toucher au reste de config.json', () => {
  try {
    const { archivage, chemin } = archivageSur({ emplacementRevues: 'production', verifTraduction: 'true' });
    assert.strictEqual(archivage.ecrireVerifTraduction(false), null, 'écriture en échec');
    const relu = JSON.parse(fs.readFileSync(chemin, 'utf8'));
    assert.strictEqual(relu.verifTraduction, false, 'la chaîne n’a pas été normalisée en booléen');
    assert.strictEqual(relu.emplacementRevues, 'production', 'le reste de config.json a été perdu');
    assert.strictEqual(archivage.ecrireVerifTraduction(true), null);
    assert.strictEqual(archivage.lireVerifTraduction(), true);
  } finally {
    delete process.env.SZH_CONFIG_OJS;
  }
});

// ---- La pastille, dans le DOM, par le chemin réel ----
//
// Le défaut qui a valu ces trois tests : Robin a activé le mode et n'a jamais vu la
// pastille. Tout ce qui précède passait au vert, parce que tout ce qui précède éprouve le
// MODULE — le format des fichiers, le réglage, la relecture — et jamais la webview. Entre le
// réglage sur le disque et un bouton à l'écran il y a quatre relais, et aucun n'était gardé :
// l'hôte lit le réglage, le met dans le message `valeurs`, la page le retient, et les cartes
// posent leurs pastilles au rendu. Un seul relais muet, et le mode est invisible sans qu'une
// ligne de code n'ait l'air fausse.
//
// On rend donc ici la vraie page, avec le vrai _fiches.js, et on compte les boutons.
const { ouvrir, libellesHote } = require('./dom-minimal');

function ouvrirFichesVerif(verifTrad) {
  const page = ouvrir({
    racine: RACINE, page: 'metadata-articles',
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_messages.js', '_auteurs.js', '_fiches.js'],
    txt: libellesHote(RACINE, ['textesCarteArticle', 'textesAuteur', 'htmlApercuMetadonnees'])
  });
  const message = {
    type: 'valeurs', langue: 'fr', filtre: null, types: [],
    articles: [{
      slug: 'mon-article',
      valeurs: {
        title: { fr: 'Le titre', de: 'Der Titel' },
        resume: { fr: 'Un résumé.', de: 'Eine Zusammenfassung.' },
        keywords: { fr: ['un', 'deux'], de: ['eins', 'zwei'] }
      }
    }]
  };
  if (verifTrad !== undefined) { message.verifTrad = verifTrad; }
  page.envoyer(message);
  return page;
}

const pastilles = (page) => page.conteneur().querySelectorAll('.szh-sugg-trad');

test('pastilles : le mode actif en pose, et chacune dit sa langue', () => {
  const vues = pastilles(ouvrirFichesVerif(true));
  assert.ok(vues.length > 0,
    'aucune pastille alors que le mode est actif : le réglage ne parvient plus à la page');
  // Le contenu EST le code de langue : c'est lui qui distingue les deux pastilles des
  // mots-clés, que rien d'autre ne sépare.
  for (const b of vues) {
    assert.strictEqual(b.balise, 'button', 'la pastille n’est pas un bouton');
    assert.match(b.textContent, /^(FR|DE|IT)$/,
      'pastille sans code de langue lisible : ' + JSON.stringify(b.textContent));
  }
  // Les quatre champs traduisibles, dans les deux langues de la fiche.
  assert.strictEqual(vues.filter((b) => b.textContent === 'FR').length,
    vues.filter((b) => b.textContent === 'DE').length,
    'les deux langues n’ont pas le même nombre de pastilles');
});

test('pastilles : le mode inactif n’en pose aucune, et n’en réserve pas la place', () => {
  assert.strictEqual(pastilles(ouvrirFichesVerif(false)).length, 0,
    'le mode est éteint et des pastilles restent');
});

test('pastilles : un message sans verifTrad n’en pose aucune — l’absence vaut éteint', () => {
  // Un hôte plus ancien, ou un relais qui oublierait la clé, ne doit pas allumer le mode
  // par accident. C'est l'inverse du défaut gardé plus haut, et les deux comptent.
  assert.strictEqual(pastilles(ouvrirFichesVerif(undefined)).length, 0,
    'une clé absente allume le mode');
});
