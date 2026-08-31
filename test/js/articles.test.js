// La vue « Articles » : l'ordre du numéro, le nom des articles, leurs tâches, la
// couverture, et le brouillon « Envoyer à l'auteur ».
//
//   node --test "test/js/*.test.js"
//
// Trois familles de contrôle. Le modèle pur (lib/articles.js) d'abord : l'ordre se répare,
// le sidecar fait l'aller-retour, les deux revues ne se mélangent pas. Le partage ensuite :
// le formulaire du numéro n'existe qu'une fois, et les deux pages qui le montrent montrent
// exactement les mêmes champs — c'est cela qu'il ne faut pas laisser se dédoubler. L'hôte
// enfin, réellement activé : déplacer un article écrit ausgabe.yaml et ne renomme aucun
// dossier, un article ajouté à la main apparaît, une couverture déposée atterrit là où
// l'export OJS la cherche.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const art = require(path.join(COCKPIT, 'lib', 'articles.js'));
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
const { ouvrir, libellesHote } = require('./dom-minimal');
const { revueDEssai, activerHote } = require('./hote-factice');

const LF = String.fromCharCode(10);
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

// ---- L'ordre du numéro ----

test('ordre des articles : la clé fait l’aller-retour et laisse le reste du fichier', () => {
  const src = '# en-tête' + LF + 'title: "Dossier"' + LF + 'lang: fr' + LF;
  const sortie = yaml.serialiserAusgabe(src, { 'ordre-articles': ['03-c', '01-a', '02-b'] });
  assert.match(sortie, /^# en-tête$/m, 'commentaire perdu');
  assert.match(sortie, /^lang: fr$/m, 'clé voisine perdue');
  assert.match(sortie, /^ordre-articles: \["03-c", "01-a", "02-b"\]$/m);
  assert.deepStrictEqual(art.analyserOrdre(yaml.analyserAusgabe(sortie)['ordre-articles']),
    ['03-c', '01-a', '02-b']);
  // Corrigée à la main, sans crochets ni guillemets : la clé doit se relire quand même.
  assert.deepStrictEqual(art.analyserOrdre('03-c, 01-a 02-b'), ['03-c', '01-a', '02-b']);
  // Un doublon ou un jeton qui n'est pas un slug ne casse rien.
  assert.deepStrictEqual(art.analyserOrdre('["01-a", "01-a", "../ailleurs", "Majuscule"]'), ['01-a']);
});

test('ordre des articles : incomplet ou périmé, il se répare tout seul', () => {
  // Un article ajouté hors de l'interface se range à la fin, et ne fait disparaître personne.
  const ajout = art.ordonnerArticles('["03-c", "01-a"]', ['01-a', '02-b', '03-c']);
  assert.deepStrictEqual(ajout.slugs, ['03-c', '01-a', '02-b']);
  assert.strictEqual(ajout.change, true, 'la clé mérite d’être réécrite');
  // Un article effacé quitte l'ordre sans laisser de trou.
  assert.deepStrictEqual(art.ordonnerArticles('["09-parti", "01-a"]', ['01-a', '02-b']).slugs,
    ['01-a', '02-b']);
  // Aucune clé : l'ordre du disque, tel quel.
  assert.deepStrictEqual(art.ordonnerArticles('', ['01-a', '02-b']).slugs, ['01-a', '02-b']);
  // Clé complète et à jour : rien à réécrire.
  assert.strictEqual(art.ordonnerArticles('["02-b", "01-a"]', ['01-a', '02-b']).change, false);
});

test('ordre des articles : un déplacement rend la liste entière, et s’arrête aux bords', () => {
  assert.deepStrictEqual(art.deplacerArticle(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepStrictEqual(art.deplacerArticle(['a', 'b', 'c'], 'a', 1), ['b', 'a', 'c']);
  assert.deepStrictEqual(art.deplacerArticle(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
  assert.deepStrictEqual(art.deplacerArticle(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
  assert.deepStrictEqual(art.deplacerArticle(['a', 'b'], 'inconnu', -1), ['a', 'b']);
});

test('nom d’un article : deux chiffres, le titre de la fiche, le slug en dernier recours', () => {
  assert.strictEqual(art.prefixeOrdre(0), '01');
  assert.strictEqual(art.prefixeOrdre(9), '10');
  assert.strictEqual(art.prefixeOrdre(99), '100');   // au-delà de 99, le nombre tel quel
  const meta = yaml.analyserMeta('title:' + LF + '  fr: "Un titre"' + LF);
  assert.strictEqual(art.libelleArticle(2, '03-truc', art.titreFiche(meta, 'fr')), '03 · Un titre');
  // Fiche absente, ou titre vide : l'article garde sa place et son slug s'affiche.
  assert.strictEqual(art.libelleArticle(2, '03-truc', art.titreFiche(yaml.analyserMeta(''), 'fr')),
    '03 · 03-truc');
  // Titre dans une seule langue : mieux vaut un titre allemand que le slug.
  assert.strictEqual(art.titreFiche(yaml.analyserMeta('title:' + LF + '  de: "Titel"' + LF), 'fr'),
    'Titel');
});

// ---- Les tâches : les définitions ----

test('tâches : le jeu de départ est celui demandé, dans les deux langues', () => {
  const attendus = ['version finale', 'traductions terminées', 'contraste et texte alternatif',
    'envoi de la version finale aux autrices et auteurs'];
  assert.deepStrictEqual(art.TACHES_DEFAUT.map((t) => t.fr), attendus);
  for (const t of art.TACHES_DEFAUT) {
    assert.ok(t.de && t.de.length > 0, 'tâche sans intitulé allemand : ' + t.id);
    assert.ok(!/ß/.test(t.de), 'orthographe allemande non suisse : ' + t.de);
  }
});

test('tâches : chaque revue a sa liste, et l’une ne touche pas l’autre', () => {
  const cfg = art.configAvecTaches(null, 'zeitschrift', [
    { fr: 'bon à tirer', de: 'Druckfreigabe' },
    { fr: 'ISSN vérifié', de: 'ISSN geprüft' }
  ]);
  assert.deepStrictEqual(art.tachesRevue(cfg, 'zeitschrift').map((t) => t.id),
    ['bon-a-tirer', 'issn-verifie']);
  // La Revue n'a pas bougé : elle garde le jeu de départ.
  assert.deepStrictEqual(art.tachesRevue(cfg, 'revue').map((t) => t.id),
    art.TACHES_DEFAUT.map((t) => t.id));
  // Une revue inconnue — ausgabe.yaml sans clé `revue` — reçoit le jeu de départ.
  assert.deepStrictEqual(art.tachesRevue(cfg, '').map((t) => t.id),
    art.TACHES_DEFAUT.map((t) => t.id));
  // Le reste de config.json est intact.
  assert.strictEqual(art.configAvecTaches({ emplacementRevues: 'test' }, 'revue', []).emplacementRevues,
    'test');
});

test('tâches : corriger un intitulé ne décoche rien', () => {
  const avant = art.normaliserTaches([{ fr: 'version finale', de: 'Endfassung' }]);
  assert.strictEqual(avant[0].id, 'version-finale');
  // L'identifiant est celui du fichier : il est conservé quand l'intitulé change.
  const apres = art.normaliserTaches([{ id: 'version-finale', fr: 'version finale relue', de: 'Endfassung' }]);
  assert.strictEqual(apres[0].id, 'version-finale');
  // Une rangée sans aucun intitulé n'entre pas dans la liste.
  assert.deepStrictEqual(art.normaliserTaches([{ fr: '', de: '' }]), []);
  // L'intitulé de l'interface, avec repli sur l'autre langue.
  assert.strictEqual(art.libelleTache({ id: 'x', fr: 'seul en français', de: '' }, 'de'),
    'seul en français');
});

// ---- Les tâches : l'état coché ----

test('tâches d’un article : le sidecar fait l’aller-retour et disparaît quand il est vide', () => {
  const texte = art.serialiserTachesFaites({ faites: ['version-finale', 'envoi-auteurs'] });
  assert.match(texte, /^faites:$/m);
  assert.deepStrictEqual(art.analyserTachesFaites(texte).faites, ['version-finale', 'envoi-auteurs']);
  // Rien à retenir : l'appelant supprime alors le fichier plutôt que d'en laisser un vide.
  assert.strictEqual(art.serialiserTachesFaites({ faites: [] }), '');
  // Une clé inconnue survit à l'écriture : ce sidecar peut porter d'autres états un jour.
  const avecInconnue = art.analyserTachesFaites(texte + 'futur: 3' + LF);
  assert.deepStrictEqual(avecInconnue._inconnues, ['futur: 3']);
  assert.match(art.serialiserTachesFaites(avecInconnue), /^futur: 3$/m);
});

test('tâches d’un article : l’avancement suit ce que la revue demande aujourd’hui', () => {
  const taches = art.TACHES_DEFAUT;
  assert.deepStrictEqual(art.resumeTaches(taches, ['version-finale']),
    { faites: 1, total: 4, toutes: false });
  assert.deepStrictEqual(art.resumeTaches(taches, taches.map((t) => t.id)),
    { faites: 4, total: 4, toutes: true });
  // Une tâche cochée puis retirée des définitions ne compte plus, et ne ressuscite pas.
  assert.deepStrictEqual(art.resumeTaches(taches, ['version-finale', 'disparue']).faites, 1);
  assert.deepStrictEqual(art.basculerTache(['disparue'], 'version-finale', true, taches),
    ['version-finale']);
  // Décocher retire, et l'ordre du fichier suit celui des définitions.
  assert.deepStrictEqual(
    art.basculerTache(['envoi-auteurs', 'version-finale'], 'envoi-auteurs', false, taches),
    ['version-finale']);
});

// ---- La couverture ----

test('couverture : les noms sont ceux que l’export OJS cherche', () => {
  // lib/articles.js ne peut pas importer lib/export-ojs.js sans l'écrire : la liste y est
  // recopiée, et c'est ici qu'on empêche les deux de diverger.
  const src = fs.readFileSync(path.join(COCKPIT, 'lib', 'export-ojs.js'), 'utf8');
  const m = src.match(/const NOMS_COUVERTURE = \[([^\]]+)\]/);
  assert.ok(m, 'NOMS_COUVERTURE introuvable dans lib/export-ojs.js');
  const attendus = m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
  assert.deepStrictEqual(art.NOMS_COUVERTURE, attendus,
    'une couverture déposée ne serait pas celle que l’export va chercher');
});

test('couverture : un seul nom canonique par format', () => {
  assert.strictEqual(art.nomCouverture('scan.JPEG'), 'couverture.jpg');
  assert.strictEqual(art.nomCouverture('image.jpg'), 'couverture.jpg');
  assert.strictEqual(art.nomCouverture('image.png'), 'couverture.png');
  assert.strictEqual(art.nomCouverture('image.gif'), '');
  assert.strictEqual(art.nomCouverture(''), '');
  // Le nom canonique doit être l'un de ceux que l'export essaie.
  for (const nom of ['couverture.jpg', 'couverture.png']) {
    assert.ok(art.NOMS_COUVERTURE.indexOf(nom) !== -1, 'nom hors liste : ' + nom);
  }
});

// ---- Le formulaire du numéro n'existe qu'une fois ----

// Toute la table des champs vit dans media/_numero.js. Une clé d'intitulé absente de l'hôte
// s'afficherait vide, sans erreur : c'est exactement la panne muette qu'on garde.
test('formulaire du numéro : chaque intitulé de la table est fourni par l’hôte', () => {
  const fragment = fs.readFileSync(path.join(COCKPIT, 'media', '_numero.js'), 'utf8');
  const table = fragment.slice(fragment.indexOf('var CHAMPS = ['), fragment.indexOf('\n  ];'));
  const utilisees = [...table.matchAll(/libelle: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(utilisees.length >= 15, 'table des champs trop maigre : ' + utilisees.length);
  const src = fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8');
  const bloc = src.slice(src.indexOf('const LIBELLES_NUMERO = ['), src.indexOf('];', src.indexOf('const LIBELLES_NUMERO = [')));
  const fournies = new Set([...bloc.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  for (const cle of utilisees) {
    assert.ok(fournies.has(cle), 'intitulé « ' + cle + ' » absent de LIBELLES_NUMERO');
  }
  // Et chaque clé annoncée existe vraiment dans les deux langues.
  const i18n = lire('vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js');
  for (const cle of fournies) {
    assert.ok(i18n.indexOf("'" + cle + "'") !== -1, 'clé i18n inexistante : ' + cle);
  }
});

// Les deux pages ne portent plus un seul champ dans leur HTML : elles n'ont qu'un conteneur
// vide, et c'est le fragment qui bâtit tout. Sans cela, la duplication reviendrait par le
// gabarit sans qu'aucun contrôle de code la voie.
test('formulaire du numéro : aucun champ dans le HTML des deux pages', () => {
  for (const page of ['metadata-issue', 'articles']) {
    const html = fs.readFileSync(path.join(COCKPIT, 'media', page + '.html'), 'utf8');
    assert.ok(html.indexOf('%%SZH:meta.title%%') === -1, 'champ recopié dans ' + page + '.html');
    assert.ok(!/<input|<select/.test(html), 'objet de saisie dans ' + page + '.html');
    assert.ok(html.indexOf('id="numero"') !== -1, 'conteneur du formulaire absent de ' + page + '.html');
  }
});

test('formulaire du numéro : les deux pages ne se recopient pas', () => {
  const lignes = (f) => fs.readFileSync(path.join(COCKPIT, 'media', f), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('//'));
  const a = lignes('metadata-issue.js');
  const b = new Set(lignes('articles.js'));
  let suite = 0, pire = 0;
  for (const l of a) { suite = b.has(l) ? suite + 1 : 0; pire = Math.max(pire, suite); }
  assert.ok(pire < 8, 'bloc de ' + pire + ' lignes identiques : à remonter dans _numero.js');
});

// ---- Les webviews, réellement rendues ----

// Cherche sous un élément quelconque : dom-minimal ne sait le faire que sous le conteneur
// de la page, et le formulaire du numéro vit dans un autre.
function descendants(element) {
  const sortie = [];
  const visiter = (e) => { for (const c of e.enfants) { sortie.push(c); visiter(c); } };
  visiter(element);
  return sortie;
}
function clesDeChamps(element) {
  return descendants(element).map((e) => e.dataset.cle).filter((v) => v !== undefined).sort();
}

test('formulaire du numéro : les deux pages rendent exactement les mêmes champs', () => {
  const rendre = (page, jsPartage) => ouvrir({
    racine: RACINE, page: page,
    cssPartage: ['_design.css', '_liste.css', '_numero.css'], jsPartage: jsPartage,
    txt: libellesHote(RACINE, ['textesNumero', 'textesArticles'])
  });
  const seul = rendre('metadata-issue', ['_numero.js']);
  const dansLaVue = rendre('articles', ['_numero.js']);
  const a = clesDeChamps(seul.parId.numero);
  const b = clesDeChamps(dansLaVue.parId.numero);
  assert.ok(a.length >= 8, 'formulaire du numéro vide : ' + JSON.stringify(a));
  assert.deepStrictEqual(b, a,
    'les deux pages ne montrent pas les mêmes champs : le formulaire s’est dédoublé');
  // Et ces clés sont bien celles de la table du fragment, pas une liste écrite à la main.
  const fragment = fs.readFileSync(path.join(COCKPIT, 'media', '_numero.js'), 'utf8');
  const table = fragment.slice(fragment.indexOf('var CHAMPS = ['), fragment.indexOf('\n  ];'));
  const attendues = [...table.matchAll(/\{ cle: '([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(a, attendues);
});

test('vue « Articles » : une carte par article, ses tâches et ses commandes', () => {
  const page = ouvrir({
    racine: RACINE, page: 'articles',
    cssPartage: ['_design.css', '_liste.css', '_numero.css'], jsPartage: ['_numero.js'],
    txt: libellesHote(RACINE, ['textesNumero', 'textesArticles'])
  });
  assert.deepStrictEqual(page.messages.map((m) => m.type), ['pret'], 'la page ne s’annonce pas');
  const taches = art.TACHES_DEFAUT.map((t) => ({ id: t.id, libelle: t.fr, faite: t.id === 'version-finale' }));
  page.envoyer({
    type: 'valeurs', titre: 'Articles',
    boutons: [{ id: 'importer', libelle: 'Convertir', icone: 'fleche' },
              { id: 'taches', libelle: 'Tâches', icone: 'ok' }],
    lignes: [
      // Plus de pastille d'avancement (A7.5) : elle vit dans l'entête « À faire » de la
      // carte, via `tachesResume` — la pastille reste réservée à d'autres compteurs, comme
      // celui des images.
      { cle: '01-a', titre: '01 · Premier', ouvrir: true,
        pastilles: [], tachesResume: { texte: '1/4 tâches', toutes: false },
        actions: [{ id: 'monter', libelle: 'Monter', icone: 'haut', desactive: true },
                  { id: 'descendre', libelle: 'Descendre', icone: 'bas' },
                  { id: 'envoyer', libelle: 'Envoyer à l’auteur', icone: 'traduction' }],
        taches: taches },
      { cle: '02-b', titre: '02 · 02-b', ouvrir: true,
        notif: { ton: 'attention', texte: 'Pas de titre dans la fiche' },
        pastilles: [], actions: [], taches: taches }
    ],
    valeurs: { title: 'Dossier', revue: 'revue', lang: 'fr' },
    couverture: { nom: '', description: '', apercu: null },
    taches: { revue: art.TACHES_DEFAUT, zeitschrift: art.TACHES_DEFAUT },
    revue: 'revue', accent: '#5F9FBC'
  });
  assert.strictEqual(page.compter('.szh-carte'), 2, 'une carte par article attendue');
  // Les tâches sont cochables sur la carte : l'avancement se change sans rien ouvrir.
  assert.strictEqual(page.compter('.szh-tache'), 8, 'quatre cases par carte attendues');
  assert.strictEqual(page.compter('[data-tache]'), 8);
  // Un entête « À faire » par carte à tâches (A7.2), qui porte l'avancement (A7.5).
  assert.strictEqual(page.compter('.szh-taches-entete'), 2, 'entête « À faire » manquant');
  const textes = page.textes().join(' | ');
  assert.ok(textes.indexOf('À faire') !== -1, 'le titre compact de l’encadré des tâches a disparu');
  assert.ok(textes.indexOf('1/4 tâches') !== -1, 'avancement absent de la carte');
  assert.ok(textes.indexOf('01 · Premier') !== -1, 'l’article ne porte pas son nom');
  assert.ok(textes.indexOf('Monter') !== -1 && textes.indexOf('Descendre') !== -1,
    'les boutons de déplacement manquent : l’ordre ne se pilote pas au clavier');
  assert.ok(textes.indexOf('Envoyer à l’auteur') !== -1, 'le bouton d’envoi manque');
  // Un article sans titre reste visible, et la carte dit pourquoi.
  assert.ok(textes.indexOf('02 · 02-b') !== -1, 'l’article sans fiche a disparu');
  assert.strictEqual(page.compter('.szh-notif--attention'), 1);
  // La couverture absente est dite, dans le formulaire du numéro replié.
  const dansNumero = descendants(page.parId.numero).map((e) => e._texte).join(' | ');
  assert.ok(/couverture/i.test(dansNumero), 'la couverture n’est nommée nulle part');
});

test('vue d’ensemble : le même rendu de cartes qu’avant l’extraction du fragment', () => {
  const page = ouvrir({
    racine: RACINE, page: 'vue-ensemble',
    cssPartage: ['_design.css', '_liste.css'], jsPartage: []
  });
  page.envoyer({
    type: 'valeurs', titre: 'Traductions', i18n: { ouvrir: 'Ouvrir', listeVide: 'Rien' },
    boutons: [{ id: 'tout-traduction', libelle: 'À traduire', icone: 'fleche' }],
    lignes: [{ cle: '01-a', groupe: 'Groupe', titre: '01 · Premier', meta: '2/8',
      pastilles: [{ texte: 'prêt', ton: 'info', icone: 'fleche' }],
      notif: { ton: 'info', texte: 'Une question' }, ouvrir: true }]
  });
  // Cette page nomme son conteneur « lignes » : on y descend directement.
  const dedans = descendants(page.parId.lignes);
  const aLaClasse = (c) => dedans.filter((e) => e.classes.has(c)).length;
  assert.strictEqual(aLaClasse('szh-carte'), 1);
  assert.strictEqual(aLaClasse('titre-section'), 1, 'le titre de groupe a disparu');
  const textes = dedans.map((e) => e._texte).join(' | ');
  for (const attendu of ['01 · Premier', '2/8', 'prêt', 'Une question', 'Ouvrir']) {
    assert.ok(textes.indexOf(attendu) !== -1, 'perdu au passage : ' + attendu);
  }
});

// ---- L'hôte, réellement activé ----

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const AUSGABE = path.join(REVUE, 'ausgabe.yaml');

function sectionArticles() {
  return HOTE.arbre().getChildren().find((it) => it.categorie === 'articles');
}

test('arborescence : les articles portent leur titre, préfixé de deux chiffres', async () => {
  const items = await HOTE.arbre().getChildren(sectionArticles());
  const libelles = items.map((it) => it.label);
  // « 01-essai » a un titre dans sa fiche, « 02-sans-fiche » n'en a pas : les deux se voient.
  assert.deepStrictEqual(libelles, ['01 · Titre', '02 · 02-sans-fiche']);
  // Le slug passe en description : c'est par lui qu'on retrouve le dossier.
  assert.ok(items[0].description.indexOf('01-essai') === 0,
    'le slug a disparu de la description : ' + items[0].description);
  // Et l'avancement des tâches s'y lit aussi, sans ouvrir la vue.
  assert.match(items[0].description, /0\/4/);
});

test('ordre : monter un article écrit ausgabe.yaml et ne renomme aucun dossier', async () => {
  const avant = fs.readFileSync(AUSGABE, 'utf8');
  assert.ok(avant.indexOf('ordre-articles') === -1, 'la clé existait déjà');
  const dossiersAvant = fs.readdirSync(path.join(REVUE, 'articles')).sort();

  await HOTE.executer('szh.vueArticles');
  const p = HOTE.panneauDeType('szhVueArticles');
  assert.ok(p, 'panneau de la vue « Articles » absent');
  await p._recepteur({ type: 'pret' });
  await p._recepteur({ type: 'action', cle: '02-sans-fiche', id: 'monter' });

  const apres = fs.readFileSync(AUSGABE, 'utf8');
  assert.match(apres, /^ordre-articles: \["02-sans-fiche", "01-essai"\]$/m);
  // Ce qui précédait la clé est intact : le sérialiseur ne touche pas ce qu'il ne connaît pas.
  assert.match(apres, /^title: "Essai"$/m);
  assert.deepStrictEqual(fs.readdirSync(path.join(REVUE, 'articles')).sort(), dossiersAvant,
    'un dossier a été renommé : out/ serait à recompiler');

  // L'ordre pilote l'arborescence, et donc les préfixes à deux chiffres.
  const items = await HOTE.arbre().getChildren(sectionArticles());
  assert.deepStrictEqual(items.map((it) => it.label), ['01 · 02-sans-fiche', '02 · Titre']);
  // Et la carte de la vue le dit aussi.
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  assert.deepStrictEqual(charge.lignes.map((l) => l.cle), ['02-sans-fiche', '01-essai']);
  assert.strictEqual(charge.lignes[0].actions.find((a) => a.id === 'monter').desactive, true,
    'le premier article peut encore monter');
});

test('ordre : un article ajouté à la main apparaît sans casser l’ordre', async () => {
  const slug = '07-ajoute-a-la-main';
  const dossier = path.join(REVUE, 'articles', slug);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, slug + '.md'), 'Texte.' + LF);
  fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'),
    ['type: article', 'title:', '  fr: "Ajouté hors interface"', ''].join(LF));

  const items = await HOTE.arbre().getChildren(sectionArticles());
  assert.deepStrictEqual(items.map((it) => it.label),
    ['01 · 02-sans-fiche', '02 · Titre', '03 · Ajouté hors interface'],
    'l’article ajouté n’apparaît pas, ou l’ordre s’est perdu');
  // Rien n'a été réécrit au passage : la clé n'est écrite que par un geste de l'utilisateur.
  assert.match(fs.readFileSync(AUSGABE, 'utf8'), /^ordre-articles: \["02-sans-fiche", "01-essai"\]$/m);
});

// Cocher une case ne doit PAS renvoyer « valeurs » : la page reconstruirait sa liste
// entière, et le focus clavier quitterait la case qu'on vient d'utiliser. La page sait
// traiter « avancement » depuis longtemps ; c'est l'hôte qui ne l'envoyait pas.
// L'avancement lui-même vit dans `tachesResume` (A7.5) et non plus dans `pastilles` :
// c'est l'entête « À faire » de la carte qu'il faut reposer sans rien reconstruire.
test('tâches : cocher une case écrit le sidecar, et ne repose que son entête', async () => {
  const sidecar = path.join(REVUE, 'articles', '01-essai', '01-essai.taches.yaml');
  await HOTE.executer('szh.vueArticles');
  const p = HOTE.panneauDeType('szhVueArticles');

  // L'état de départ, tel que la page l'a reçu à l'ouverture.
  const depart = p.messages.filter((m) => m.type === 'valeurs').pop();
  const ligneDepart = depart.lignes.find((l) => l.cle === '01-essai');
  assert.strictEqual(ligneDepart.taches.length, 4, 'les quatre tâches de départ attendues');
  const rendusAvant = p.messages.filter((m) => m.type === 'valeurs').length;

  await p._recepteur({ type: 'tache', cle: '01-essai', id: 'version-finale', cochee: true });
  assert.ok(fs.existsSync(sidecar), 'sidecar des tâches non écrit');
  assert.match(fs.readFileSync(sidecar, 'utf8'), /version-finale/);

  assert.strictEqual(p.messages.filter((m) => m.type === 'valeurs').length, rendusAvant,
    'la liste entière a été renvoyée : le focus clavier quitterait la case cochée');
  const avancement = p.messages.filter((m) => m.type === 'avancement').pop();
  assert.ok(avancement, 'aucun message « avancement » : la page n’a rien à reposer');
  assert.strictEqual(avancement.cle, '01-essai');
  assert.strictEqual(avancement.tachesResume.texte, '1/4 tâches',
    'l’avancement ne se lit pas sur la carte');
  assert.strictEqual(avancement.tachesResume.toutes, false);
  // Et l'état coché est bien sur le disque, donc dans le prochain rendu complet.
  await HOTE.executer('szh.vueArticles');
  const relu = p.messages.filter((m) => m.type === 'valeurs').pop()
    .lignes.find((l) => l.cle === '01-essai');
  assert.strictEqual(relu.taches.find((t) => t.id === 'version-finale').faite, true);

  // Décocher la dernière case retire le fichier : pas de résidu dans le dossier.
  await p._recepteur({ type: 'tache', cle: '01-essai', id: 'version-finale', cochee: false });
  assert.ok(!fs.existsSync(sidecar), 'sidecar laissé vide sur le disque');
  assert.strictEqual(p.messages.filter((m) => m.type === 'avancement').pop().tachesResume.texte,
    '0/4 tâches', 'l’avancement ne redescend pas quand la case est décochée');
});

test('couverture : déposée, elle atterrit là où l’export OJS la cherche', async () => {
  await HOTE.executer('szh.vueArticles');
  const p = HOTE.panneauDeType('szhVueArticles');
  // Un PNG minuscule mais réel, pour que l'aperçu soit un data: valide.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DAwAAABQABz1Vp4gAAAABJRU5ErkJggg==',
    'base64');
  await p._recepteur({
    type: 'couverture-deposer', nomFichier: 'scan.jpeg', donneesBase64: png.toString('base64')
  });
  // « .jpeg » est écrit sous le premier nom que l'export essaie : jamais deux couvertures.
  assert.ok(fs.existsSync(path.join(REVUE, 'couverture.jpg')), 'couverture non écrite');
  assert.ok(!fs.existsSync(path.join(REVUE, 'couverture.jpeg')));
  const reponse = p.messages.filter((m) => m.type === 'couverture').pop();
  assert.strictEqual(reponse.nom, 'couverture.jpg');
  assert.match(String(reponse.apercu), /^data:image\/jpeg;base64,/);

  // Un PNG déposé ensuite remplace le JPEG : l'export ne doit pas trouver l'ancienne.
  await p._recepteur({
    type: 'couverture-deposer', nomFichier: 'autre.png', donneesBase64: png.toString('base64')
  });
  assert.ok(fs.existsSync(path.join(REVUE, 'couverture.png')));
  assert.ok(!fs.existsSync(path.join(REVUE, 'couverture.jpg')), 'deux couvertures sur le disque');

  // Un format refusé ne touche à rien et le dit.
  await p._recepteur({ type: 'couverture-deposer', nomFichier: 'x.gif', donneesBase64: 'AAAA' });
  const erreur = p.messages.filter((m) => m.type === 'erreur').pop();
  assert.ok(erreur && /JPEG/.test(erreur.message), 'le refus de format n’est pas dit');
  assert.ok(fs.existsSync(path.join(REVUE, 'couverture.png')), 'la couverture a été perdue');
});

test('formulaire du numéro : la vue « Articles » écrit par le même chemin', async () => {
  await HOTE.executer('szh.vueArticles');
  const p = HOTE.panneauDeType('szhVueArticles');
  await p._recepteur({ type: 'enregistrer', auto: true, modifies: { volume: '17' } });
  assert.match(fs.readFileSync(AUSGABE, 'utf8'), /^volume: "17"$/m);
  assert.ok(p.messages.some((m) => m.type === 'enregistre'), 'aucune confirmation');
  // Et la charge utile de la vue porte les valeurs du numéro, comme la page dédiée.
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  assert.strictEqual(charge.valeurs.volume, '17');
  assert.ok(charge.couverture, 'la couverture n’est pas dans la charge de la vue');
  assert.ok(charge.taches.revue && charge.taches.zeitschrift,
    'les deux jeux de tâches ne sont pas envoyés');
});

test('« Envoyer à l’auteur » : le brouillon parle la langue de l’auteur', () => {
  const pur = require(path.join(COCKPIT, 'extension.js'))._pur;
  const meta = yaml.analyserMeta([
    'lang: de', 'title:', '  de: "Inklusive Bildung"',
    'author:', '- prenom: "Anne"', '  nom: "Dupont"', '  email: "anne@example.ch"',
    '- prenom: "Beat"', '  nom: "Muster"', '  email: "beat@example.ch"',
    '- prenom: "Sans"', '  nom: "Adresse"', ''].join(LF));
  const adresses = pur.adressesAuteurs(meta);
  assert.deepStrictEqual(adresses, ['anne@example.ch', 'beat@example.ch'],
    'les adresses de la fiche ne sont pas reprises, ou une fiche sans adresse en invente une');
  const brouillon = pur.brouillonAuteur('de', adresses, 'Inklusive Bildung', 'Z2026-03 | Essai');
  assert.strictEqual(brouillon.destinataire, 'anne@example.ch,beat@example.ch');
  assert.match(brouillon.sujet, /^Endfassung/, 'le sujet n’est pas dans la langue de l’auteur');
  assert.match(brouillon.corps, /Im Anhang/);
  assert.match(brouillon.corps, /Inklusive Bildung/);
  assert.match(brouillon.corps, /Z2026-03/);
  // Le corps part tel quel à l'auteur : aucune consigne interne au rédacteur n'y traîne.
  assert.doesNotMatch(brouillon.corps, /Ctrl\+V|presse-papiers|Zwischenablage/);
  // Et le mailto: encode tout ce que l'adresse ne peut pas porter nue.
  const uri = pur.uriMailto(brouillon);
  assert.ok(uri.indexOf('mailto:anne@example.ch,beat@example.ch?subject=') === 0);
  assert.ok(uri.indexOf('%0A') !== -1, 'les retours à la ligne du corps ne sont pas encodés');
});
