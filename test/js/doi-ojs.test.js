// Le DOI qui part vers OJS : il est CALCULÉ, et c'est le même calcul que celui que la carte
// d'article affiche.
//
//   node --test "test/js/*.test.js"
//
// Pourquoi ce fichier. Le DOI se déduit du rang de l'article parmi les porteurs du numéro,
// et ce rang vient de l'ordre du numéro — un ordre qui se change d'un clic, sans renommer
// aucun dossier. Deux endroits le lisent : la carte, qui le montre à la rédaction, et
// l'export, qui l'expédie. S'ils divergeaient, le DOI affiché ne serait pas le DOI publié,
// et rien ne le dirait avant le dépôt chez Crossref — d'où le contrôle central de ce
// fichier, qui fait tourner l'HÔTE RÉEL et l'export sur le MÊME numéro et compare les deux
// listes, article par article, avant et après un déplacement.
//
// Le numéro d'essai est monté à l'image de R2026-03 de la Revue, tel que l'instance le
// porte : un éditorial en « 00 », sept articles du dossier, un varia, une tribune libre et
// une page de documentation, qui n'en reçoit aucun.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SZH_LANGUE = 'fr';
// Aucune configuration de poste : la carte et l'export lisent tous deux la table par défaut,
// et non celle de la machine où le contrôle tourne. Posé avant le premier require, la valeur
// étant relue à chaque appel mais le module chargé une fois.
process.env.SZH_CONFIG_OJS = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'szh-doi-cfg-')), 'config.json');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { chargerAvecVscodeFactice } = require('./dom-minimal');
const { activerHote } = require('./hote-factice');
const ojs = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'export-ojs.js'));
const yaml = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'yaml.js'));

const LF = String.fromCharCode(10);
const MAINTENANT = new Date(2026, 7, 21, 9, 30, 0);   // 21 août 2026, 09:30:00

// ---- Le numéro d'essai --------------------------------------------------------------

// Les onze articles de R2026-03, dans l'ordre du sommaire paru. Aucune fiche ne porte de
// DOI : il n'y en a plus à saisir.
const ARTICLES = [
  { slug: '00-editorial', type: 'editorial', titre: 'Éditorial' },
  { slug: '01-gremion', type: 'article', titre: 'Les transitions scolaires' },
  { slug: '02-chanier', type: 'article', titre: 'Après l’école obligatoire' },
  { slug: '03-guilley', type: 'article', titre: 'Mesures renforcées et statistiques' },
  { slug: '04-leclerc', type: 'interview', titre: 'Entretien avec une enseignante' },
  { slug: '05-pagnamenta', type: 'article', titre: 'Formation professionnelle et handicap' },
  { slug: '06-pirico', type: 'article', titre: 'Le rôle des parents' },
  { slug: '07-zufferey', type: 'article', titre: 'Coopération entre professionnels' },
  { slug: '08-dentz', type: 'varia', titre: 'Varia' },
  { slug: '09-tribune', type: 'tribune-libre', titre: 'Tribune libre' },
  { slug: '10-documentation', type: 'documentation', titre: 'Documentation' }
];

function fiche(a) {
  return ['type: ' + a.type, 'lang: fr']
    .concat(a.doi ? ['doi: "' + a.doi + '"'] : [])
    .concat(['title:', '  fr: "' + a.titre + '"',
      'resume:', '  fr: "Un résumé."',
      'author:', '- prenom: "Anne"', '  nom: "Dupont"', ''])
    .join(LF);
}

// Un article complet sur le disque : son texte, sa fiche, et les trois galleys que l'export
// exige. Sert aussi à en ajouter un À LA MAIN, après coup, hors de l'ordre du numéro.
function poserArticle(revue, a) {
  const dossier = path.join(revue, 'articles', a.slug);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, a.slug + '.md'), 'Un paragraphe.' + LF);
  fs.writeFileSync(path.join(dossier, a.slug + '.meta.yaml'), fiche(a));
  const sortie = path.join(revue, 'out', a.slug);
  fs.mkdirSync(sortie, { recursive: true });
  for (const ext of ['pdf', 'html', 'docx']) {
    fs.writeFileSync(path.join(sortie, a.slug + '.' + ext), Buffer.from(a.slug + ':' + ext));
  }
}

// opts.numero  le nombre du numéro, « 03 » par défaut
// opts.cles    clés supplémentaires du fichier du numéro (ordre-articles, articles-sans-doi…)
// opts.articles la liste à poser, celle de R2026-03 par défaut
function monterNumero(opts) {
  opts = opts || {};
  const revue = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-doi-'));
  const lignes = ['revue: revue', 'title: "Transitions"', 'lang: fr', 'volume: "16"',
    'numero: "' + (opts.numero === undefined ? '03' : opts.numero) + '"',
    'date: "2026-09-08"', 'couleur: "#5F9FBC"', ''];
  fs.writeFileSync(path.join(revue, 'ausgabe.yaml'), lignes.join(LF));
  if (opts.cles) { poserCles(revue, opts.cles); }
  fs.writeFileSync(path.join(revue, 'couverture.jpg'), Buffer.from('JPEG'));
  for (const a of (opts.articles || ARTICLES)) { poserArticle(revue, a); }
  return revue;
}

function poserCles(revue, cles) {
  const fichier = path.join(revue, 'ausgabe.yaml');
  fs.writeFileSync(fichier, yaml.serialiserAusgabe(fs.readFileSync(fichier, 'utf8'), cles));
}

// ---- Lire les DOI, des deux côtés ---------------------------------------------------

// Les DOI EXPÉDIÉS, dans l'ordre où l'XML porte les articles : [slug, doi] par article, et
// un DOI vide pour celui qui n'en reçoit aucun. Le slug se lit sur le nom du fichier joint,
// le seul endroit où l'XML le nomme.
function doisExpedies(xml) {
  return xml.split('    <article ').slice(1).map((bloc) => {
    const slug = (bloc.match(/<name locale="[a-z]{2}">(.+)\.docx<\/name>/) || ['', '?'])[1];
    const doi = (bloc.match(/<id type="doi" advice="update">([^<]*)<\/id>/) || ['', ''])[1];
    return [slug, doi];
  });
}

function exporter(revue) {
  const resultat = ojs.genererExportOjs(revue, { maintenant: MAINTENANT });
  const xml = fs.readFileSync(resultat.chemin, 'utf8')
    .replace(/(<embed encoding="base64">)[^<]*/g, '$1');
  fs.unlinkSync(resultat.chemin);            // le suivant ne doit pas relire celui d'avant
  return { xml: xml, nom: path.basename(resultat.chemin),
           dois: doisExpedies(xml), avertissements: resultat.avertissements };
}

// Le sommaire expédié, lisible : c'est ce que montrent les messages d'échec.
function sommaire(dois) {
  return dois.map(([slug, doi]) => slug + ' -> ' + (doi || '(aucun)')).join(LF);
}

// ---- L'ordre du numéro décide du DOI ------------------------------------------------

test('DOI expédié : l’éditorial ouvre à 00, la Documentation n’en reçoit aucun', () => {
  const sortie = exporter(monterNumero({}));
  // Le nom du fichier porte le volume et le nombre du numéro, tels qu'ils sont saisis.
  assert.strictEqual(sortie.nom, 'native-20260821-093000-16-03.xml');
  assert.deepStrictEqual(sortie.dois, [
    ['00-editorial', '10.57161/r2026-03-00'],
    ['01-gremion', '10.57161/r2026-03-01'],
    ['02-chanier', '10.57161/r2026-03-02'],
    ['03-guilley', '10.57161/r2026-03-03'],
    ['04-leclerc', '10.57161/r2026-03-04'],
    ['05-pagnamenta', '10.57161/r2026-03-05'],
    ['06-pirico', '10.57161/r2026-03-06'],
    ['07-zufferey', '10.57161/r2026-03-07'],
    ['08-dentz', '10.57161/r2026-03-08'],
    ['09-tribune', '10.57161/r2026-03-09'],
    ['10-documentation', '']
  ], LF + sommaire(sortie.dois));
  // Aucune balise vide pour la Documentation : dix DOI pour onze articles.
  assert.strictEqual((sortie.xml.match(/type="doi"/g) || []).length, 10);
  assert.strictEqual(sortie.xml.indexOf('<id type="doi" advice="update"></id>'), -1);
  // Et l'XML tel quel, sur l'article qui ouvre le numéro : la balise, son attribut et sa
  // place, juste après l'identifiant interne de la publication.
  const bloc = sortie.xml.slice(sortie.xml.indexOf('      <publication'));
  assert.match(bloc.slice(0, bloc.indexOf('<title')), new RegExp(
    '<id type="internal" advice="ignore">\\d+</id>' + LF +
    '        <id type="doi" advice="update">10\\.57161/r2026-03-00</id>' + LF));
});

test('DOI expédié : un article sans DOI passe en fin de numéro et resserre les autres', () => {
  // Le varia coché « pas de DOI » : il quitte le rang 08, la tribune libre le prend, et lui
  // s'en va après les porteurs — sinon le rang 08 désignerait le neuvième article qu'on lit.
  const revue = monterNumero({ cles: { 'articles-sans-doi': ['08-dentz'] } });
  const sortie = exporter(revue);
  assert.deepStrictEqual(sortie.dois.slice(8), [
    ['09-tribune', '10.57161/r2026-03-08'],
    ['08-dentz', ''],
    ['10-documentation', '']
  ], LF + sommaire(sortie.dois));
  // Les huit premiers n'ont pas bougé : le compteur ne compte que les porteurs.
  assert.deepStrictEqual(sortie.dois.slice(0, 8).map(([, doi]) => doi.slice(-2)),
    ['00', '01', '02', '03', '04', '05', '06', '07']);
  // L'absence est VOULUE : elle se dit, et autrement que celle d'une rubrique.
  const dits = sortie.avertissements.filter((a) => a.indexOf('08-dentz') !== -1);
  assert.ok(dits.some((a) => /décidé pour cet article/.test(a)),
    'l’absence voulue n’est pas dite : ' + dits.join(' | '));
  assert.ok(sortie.avertissements.some((a) => a.indexOf('10-documentation') !== -1
    && /normal pour cette rubrique/.test(a)));
});

test('DOI expédié : réordonner deux articles change les DOI en conséquence', () => {
  const avant = exporter(monterNumero({}));
  assert.strictEqual(avant.dois[2][0], '02-chanier');
  assert.strictEqual(avant.dois[2][1], '10.57161/r2026-03-02');
  assert.strictEqual(avant.dois[3][1], '10.57161/r2026-03-03');

  // Le même numéro, avec le troisième article passé devant le deuxième. Aucun dossier n'est
  // renommé : seul l'ordre du numéro change.
  const ordre = ARTICLES.map((a) => a.slug);
  ordre[2] = '03-guilley';
  ordre[3] = '02-chanier';
  const apres = exporter(monterNumero({ cles: { 'ordre-articles': ordre } }));
  assert.deepStrictEqual(apres.dois.slice(2, 4), [
    ['03-guilley', '10.57161/r2026-03-02'],
    ['02-chanier', '10.57161/r2026-03-03']
  ], LF + sommaire(apres.dois));
  // Les deux DOI se sont échangés, et rien d'autre n'a bougé.
  assert.deepStrictEqual(
    avant.dois.filter(([slug]) => slug !== '02-chanier' && slug !== '03-guilley'),
    apres.dois.filter(([slug]) => slug !== '02-chanier' && slug !== '03-guilley'));
});

test('DOI expédié : un article ajouté à la main, hors de l’ordre, ne casse pas le compteur', () => {
  // L'ordre du numéro ne connaît que les dix premiers ; le onzième et le douzième sont posés
  // sur le disque sans passer par l'interface. Ils se rangent à la fin, et rien d'autre ne
  // change de DOI.
  const revue = monterNumero({ cles: { 'ordre-articles': ARTICLES.slice(0, 10).map((a) => a.slug) } });
  const attendu = exporter(revue).dois;
  poserArticle(revue, { slug: '11-tardif', type: 'article', titre: 'Arrivé après coup' });
  const sortie = exporter(revue);
  assert.deepStrictEqual(sortie.dois, attendu.slice(0, 10)
    .concat([['11-tardif', '10.57161/r2026-03-10'], ['10-documentation', '']]),
    LF + sommaire(sortie.dois));
  // L'ordre du numéro n'a pas été réécrit au passage : un export ne modifie pas son numéro.
  assert.match(fs.readFileSync(path.join(revue, 'ausgabe.yaml'), 'utf8'),
    /^ordre-articles: \["00-editorial".*"09-tribune"\]$/m);
});

// ---- Le contrôle central : le DOI expédié est celui que la carte affiche -------------
//
// Un seul activerHote() par processus, et il vient avec sa propre revue : c'est donc CE
// numéro-là que l'hôte et l'export regardent tous les deux.

const REVUE = monterNumero({});
const HOTE = activerHote(REVUE);
const pret = new Promise((r) => setTimeout(r, 30));

async function vue() {
  await pret;
  await HOTE.executer('szh.vueArticles');
  const p = HOTE.panneauDeType('szhVueArticles');
  assert.ok(p, 'panneau de la vue « Articles » absent');
  await p._recepteur({ type: 'pret' });
  return p;
}

// Le DOI que la CARTE affiche : la dernière ligne de son aperçu.
function doiCarte(ligne) {
  const lignes = ligne.apercu.lignes;
  return lignes[lignes.length - 1].valeurs[0].texte;
}

// Ce que les cartes annoncent, mis dans la forme de ce que l'XML porte : un DOI, ou rien du
// tout quand la carte dit « aucun ».
function attenduDepuisCartes(p) {
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  return charge.lignes.map((l) => {
    const dit = doiCarte(l);
    return [l.cle, /^10\./.test(dit) ? dit : ''];
  });
}

test('DOI : celui qui part est celui que la carte affiche, article par article', async () => {
  const p = await vue();
  const cartes = attenduDepuisCartes(p);
  assert.strictEqual(cartes.length, ARTICLES.length, 'toutes les cartes ne sont pas chargées');
  // Onze articles comparés d'un coup, et non un seul : c'est la divergence entre les deux
  // lectures qu'on cherche, et elle peut ne toucher qu'un rang.
  const sortie = exporter(REVUE);
  assert.deepStrictEqual(sortie.dois, cartes,
    'la carte et l’export ne disent pas le même DOI :' + LF + sommaire(sortie.dois));
  // Et ce ne sont pas deux listes vides qui se ressemblent.
  assert.strictEqual(cartes.filter(([, doi]) => doi !== '').length, 10);
  assert.strictEqual(cartes[0][1], '10.57161/r2026-03-00');
});

test('DOI : après un déplacement fait à l’écran, les deux suivent ensemble', async () => {
  const p = await vue();
  // Le geste réel de la rédaction : « Monter » sur la carte du troisième article.
  await p._recepteur({ type: 'action', cle: '02-chanier', id: 'monter' });
  const cartes = attenduDepuisCartes(p);
  assert.deepStrictEqual(cartes.slice(1, 3), [
    ['02-chanier', '10.57161/r2026-03-01'],
    ['01-gremion', '10.57161/r2026-03-02']
  ], 'la carte n’a pas renuméroté après le déplacement');
  const sortie = exporter(REVUE);
  assert.deepStrictEqual(sortie.dois, cartes,
    'après un déplacement, la carte et l’export divergent :' + LF + sommaire(sortie.dois));
});

test('DOI : la case « pas de DOI » cochée à l’écran vide aussi la balise de l’export', async () => {
  const p = await vue();
  await p._recepteur({ type: 'sansdoi', cle: '08-dentz', coche: true });
  const cartes = attenduDepuisCartes(p);
  const sortie = exporter(REVUE);
  assert.deepStrictEqual(sortie.dois, cartes,
    'la case cochée ne produit pas le même effet des deux côtés :' + LF + sommaire(sortie.dois));
  assert.strictEqual(sortie.dois[sortie.dois.length - 2][0], '08-dentz');
  assert.strictEqual(sortie.dois[sortie.dois.length - 2][1], '');
  // Décochée, l'article retrouve un DOI, et les deux côtés le retrouvent ensemble.
  await p._recepteur({ type: 'sansdoi', cle: '08-dentz', coche: false });
  const rendu = exporter(REVUE);
  assert.deepStrictEqual(rendu.dois, attenduDepuisCartes(p),
    'la case décochée laisse les deux côtés divergents :' + LF + sommaire(rendu.dois));
  assert.ok(rendu.dois.some(([slug, doi]) => slug === '08-dentz' && /^10\./.test(doi)),
    'le varia n’a pas retrouvé de DOI : ' + LF + sommaire(rendu.dois));
});
