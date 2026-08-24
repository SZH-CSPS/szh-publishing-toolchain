// La carte d'article de la vue « Articles » : ce qu'elle montre, ce qu'elle signale, et où
// elle mène.
//
//   node --test "test/js/*.test.js"
//
// Quatre choses sont éprouvées ici, et toutes les quatre ont un moyen de casser en silence :
//
//  1. L'APERÇU des métadonnées. Complet — les neuf champs de la fiche — et NON éditable :
//     un champ de saisie qui s'y glisserait ferait de cette carte un second formulaire, et
//     les valeurs se modifieraient à deux endroits. Le contrôle compte les champs de saisie
//     dans la grille, et en attend zéro.
//
//  2. Les DEUX BOUTONS. Ils ne réimplémentent rien : ils appellent les commandes qui
//     existent, sur l'article de leur carte. Un mauvais slug ouvrirait le formulaire d'un
//     autre article sans que rien ne le dise.
//
//  3. Le COMPTEUR D'IMAGES et ce qui manque. Trois cas, et le second est celui qu'on rate :
//     une image décorative n'a PAS à porter de texte alternatif, et l'annoncer comme un
//     défaut serait faux. Une image déclarée « sans légende ni numéro », de même, n'a pas
//     de légende à avoir.
//
//  4. Le DOI CALCULÉ et l'ordre qu'il impose. Le DOI est le rang de l'article parmi ceux
//     qui en portent un : l'éditorial ouvre le numéro et prend « 00 ». Les articles sans
//     DOI passent à la fin, et les boutons de déplacement refusent de franchir la
//     frontière — sinon la règle se contredirait d'un clic.
//
//     S'y ajoute le gel de l'ordre, qui n'appartient qu'à l'ARCHIVAGE : un numéro
//     verrouillé a ses textes figés mais son sommaire peut encore se décider. Les deux
//     sens sont éprouvés, et le second — verrouillé mais non archivé, le déplacement PASSE
//     — est celui qui protège la distinction ; sans lui, remettre le garde complet
//     passerait inaperçu.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const art = require(path.join(COCKPIT, 'lib', 'articles.js'));
const { ouvrir, libellesHote, chargerAvecVscodeFactice } = require('./dom-minimal');
const { activerHote } = require('./hote-factice');
const ojs = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'export-ojs.js'));
const journal = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'journal.js'));

const LF = String.fromCharCode(10);

// ---- Le modèle pur : l'ordre que le DOI impose ----

test('ordre : les articles sans DOI passent à la fin, et le reste ne bouge pas', () => {
  // Tri stable : les porteurs gardent leur ordre entre eux, les autres aussi.
  assert.deepStrictEqual(
    art.trierParDoi(['00-edito', '01-doc', '02-a', '03-b'], ['01-doc']),
    ['00-edito', '02-a', '03-b', '01-doc']);
  // Deux sans DOI : ils se suivent dans l'ordre où ils étaient.
  assert.deepStrictEqual(
    art.trierParDoi(['a', 'x', 'b', 'y'], ['x', 'y']), ['a', 'b', 'x', 'y']);
  // Aucun : rien à trier, et la liste rendue est bien la même.
  assert.deepStrictEqual(art.trierParDoi(['a', 'b'], []), ['a', 'b']);
  // La règle s'applique aussi à la réparation de la clé, à la lecture.
  const r = art.ordonnerArticles('["01-doc", "02-a"]', ['01-doc', '02-a', '03-b'], ['01-doc']);
  assert.deepStrictEqual(r.slugs, ['02-a', '03-b', '01-doc']);
  assert.strictEqual(r.change, true, 'la clé mérite d’être réécrite');
});

test('compteur du DOI : contigu, et l’éditorial ouvre à zéro', () => {
  const ordre = ['00-edito', '01-a', '02-doc', '03-b'];
  const sans = ['02-doc'];
  assert.strictEqual(art.rangDoi(ordre, '00-edito', sans), 0, 'l’éditorial porte 00');
  assert.strictEqual(art.rangDoi(ordre, '01-a', sans), 1);
  assert.strictEqual(art.rangDoi(ordre, '02-doc', sans), -1, 'un article sans DOI n’a pas de rang');
  // Le compteur ne compte que les porteurs : il ne saute donc pas par-dessus le sans-DOI.
  assert.strictEqual(art.rangDoi(ordre, '03-b', sans), 2);
  assert.strictEqual(art.rangDoi(ordre, 'inconnu', sans), -1);
});

test('déplacement : le bord ne se dit pas, la frontière du DOI se dit', () => {
  const ordre = ['00-edito', '01-a', '02-doc'];
  const sans = ['02-doc'];
  // Au milieu du bloc des porteurs : rien à refuser.
  assert.strictEqual(art.refusDeplacement(ordre, '01-a', -1, sans), '');
  // En tête et en queue de la liste : un bord, une évidence, aucun message.
  assert.strictEqual(art.refusDeplacement(ordre, '00-edito', -1, sans), 'bord');
  assert.strictEqual(art.refusDeplacement(ordre, '02-doc', 1, sans), 'bord');
  // La frontière : on ne remonte pas un article sans DOI au-dessus d'un porteur, et on
  // ne fait pas descendre un porteur sous un article sans DOI.
  assert.strictEqual(art.refusDeplacement(ordre, '02-doc', -1, sans), 'frontiere');
  assert.strictEqual(art.refusDeplacement(ordre, '01-a', 1, sans), 'frontiere');
  // Sans aucun article sans DOI, il n'y a pas de frontière du tout.
  assert.strictEqual(art.refusDeplacement(ordre, '01-a', 1, []), '');
});

test('case « pas de DOI » : elle fait l’aller-retour et suit l’ordre du numéro', () => {
  const ordre = ['a', 'b', 'c'];
  assert.deepStrictEqual(art.basculerSansDoi('', 'c', true, ordre), ['c']);
  assert.deepStrictEqual(art.basculerSansDoi('["c"]', 'a', true, ordre), ['a', 'c'],
    'la liste doit se relire dans l’ordre du numéro');
  assert.deepStrictEqual(art.basculerSansDoi('["a", "c"]', 'a', false, ordre), ['c']);
  // Un jeton qui n'est pas un slug ne salit pas la clé.
  assert.deepStrictEqual(art.basculerSansDoi('["c"]', '../ailleurs', true, ordre), ['c']);
});

// ---- Le modèle pur : les images ----

test('images : l’informative sans alternative se dit, la décorative non', () => {
  // Les trois cas demandés, dans un seul jeu.
  const r = art.resumeImages([
    // 1. informative, sans texte alternatif : l'attribut est absent -> SIGNALÉE.
    { relatif: 'figure-01.png', legende: 'Parcours des cohortes', alt: '', altDefini: false, horsFigure: false },
    // 2. décorative : alt="" est explicite, c'est une décision -> PAS signalée.
    { relatif: 'deco.png', legende: 'Bandeau', alt: '', altDefini: true, horsFigure: false },
    // 3. légende vide sur une figure -> SIGNALÉE, quel que soit le texte alternatif.
    { relatif: 'figure-02.png', legende: '', alt: 'Répartition par canton', altDefini: true, horsFigure: false }
  ]);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.sansAlt, 1, 'la décorative a été comptée comme un défaut');
  assert.strictEqual(r.sansLegende, 1);
  assert.strictEqual(r.decoratives, 1);
});

test('images : « sans légende ni numéro » n’a pas de légende à avoir', () => {
  // Même raison que la décorative : le gestionnaire vide et verrouille le champ légende
  // quand l'image sort de la mise en figure. Reprocher cette absence serait reprocher à la
  // rédaction ce qu'elle vient de décider.
  const r = art.resumeImages([
    { relatif: 'logo.png', legende: '', alt: '', altDefini: true, horsFigure: true }
  ]);
  assert.strictEqual(r.total, 1);
  assert.strictEqual(r.sansLegende, 0, 'une image hors figure est signalée sans légende');
  assert.strictEqual(r.horsFigure, 1);
  assert.strictEqual(r.sansAlt, 0, 'elle est décorative : pas de reproche non plus de ce côté');
  // Hors figure MAIS informative sans alternative : là, il y a bien quelque chose à dire.
  const parle = art.resumeImages([
    { relatif: 'schema.png', legende: '', alt: '', altDefini: false, horsFigure: true }
  ]);
  assert.strictEqual(parle.sansAlt, 1);
  assert.strictEqual(parle.sansLegende, 0);
});

// ---- Le DOI, calculé ----

test('DOI : la forme est celle de l’instance, et la lettre distingue les deux revues', () => {
  assert.strictEqual(ojs.doiCalcule('de', '2026', '06', 0), '10.57161/z2026-06-00');
  assert.strictEqual(ojs.doiCalcule('fr', '2026', '06', 0), '10.57161/r2026-06-00');
  // Le numéro se complète à deux chiffres, la date complète donne son année.
  assert.strictEqual(ojs.doiCalcule('fr', '2026-09-08', '3', 5), '10.57161/r2026-03-05');
  // Rien à inventer : sans année, sans numéro, ou pour un article qui n'en reçoit pas.
  assert.strictEqual(ojs.doiCalcule('fr', '', '3', 1), '');
  assert.strictEqual(ojs.doiCalcule('fr', '2026', '', 1), '');
  assert.strictEqual(ojs.doiCalcule('fr', '2026', '3', -1), '');
  assert.strictEqual(ojs.doiCalcule('it', '2026', '3', 1), '', 'une revue inconnue n’a pas de lettre');
  // L'exemple du contrôle de forme est produit par le générateur, et son propre motif le
  // reconnaît : un exemple recopié à la main finirait par mentir.
  for (const locale of ['fr', 'de']) {
    assert.match(ojs.FORME_DOI[locale].exemple, ojs.FORME_DOI[locale].motif);
  }
});

test('DOI : la rubrique Documentation n’en reçoit pas, l’article du dossier oui', () => {
  const cfg = ojs.normaliserConfigOjs({});
  assert.strictEqual(ojs.typeSansDoi(cfg, 'documentation'), true);
  assert.strictEqual(ojs.typeSansDoi(cfg, 'editorial'), false);
  assert.strictEqual(ojs.typeSansDoi(cfg, 'article'), false);
  assert.strictEqual(ojs.typeSansDoi(cfg, 'varia'), false);
  assert.strictEqual(ojs.typeSansDoi(cfg, ''), false, 'un type absent ne doit rien décider');
});

// ---- Les citations, regroupées par article ----

test('citations : les avertissements se regroupent par article, par leur code', () => {
  const ligne = (code, slug, champ) =>
    '[citations-avertissement] ' + code + ' | article « ' + slug + ' » | ' + champ
    + ' | Phrase du pipeline. | [de] Satz der Kette.';
  const constats = journal.analyserJournal([
    ligne('appel-sans-reference', '01-a', 'appel « (Shaw et al., 2023) »'),
    ligne('appel-sans-reference', '01-a', 'appel « (Sen, 2001) »'),
    ligne('appel-ambigu', '01-a', 'appel « (Muller) »'),
    ligne('reference-orpheline', '02-b', 'reference « Ricoeur, P. (1990). »'),
    // Un constat qui ne nomme pas son article ne se rattache à aucune carte.
    '[citations-avertissement] appel-sans-reference | appel « (Anonyme) » | Phrase. | [de] Satz.',
    ''].join(LF), 'fr');
  const parArticle = journal.citationsParArticle(constats);
  assert.deepStrictEqual([...parArticle.keys()], ['01-a', '02-b']);
  assert.strictEqual(parArticle.get('01-a')['appel-sans-reference'], 2);
  assert.strictEqual(parArticle.get('01-a')['appel-ambigu'], 1);
  assert.strictEqual(parArticle.get('01-a').total, 3);
  assert.strictEqual(parArticle.get('02-b')['reference-orpheline'], 1);
  assert.strictEqual(parArticle.get('02-b').total, 1);
});

// ---- L'hôte, réellement activé, sur un numéro réel ----
//
// R2026-03 de la Revue, tel que l'instance le porte : un éditorial, sept articles du
// dossier, un varia, une tribune libre, et une page de documentation. Les DOI relevés sur
// ojs.szh.ch pour ce numéro sont 10.57161/r2026-03-01 à -09 pour les neuf articles publiés,
// l'éditorial portant -00.

function fiche(o) {
  const l = ['type: ' + o.type];
  if (o.lang) { l.push('lang: ' + o.lang); }
  if (o.licence) { l.push('licence: ' + o.licence); }
  if (o.doi) { l.push('doi: "' + o.doi + '"'); }
  l.push('title:', '  fr: "' + o.titre + '"');
  if (o.titreDe) { l.push('  de: "' + o.titreDe + '"'); }
  if (o.soustitre) { l.push('subtitle:', '  fr: "' + o.soustitre + '"'); }
  if (o.resume) { l.push('resume:', '  fr: "' + o.resume + '"'); }
  if (o.motscles) {
    l.push('keywords:', '  fr:');
    for (const m of o.motscles) { l.push('  - "' + m + '"'); }
  }
  l.push('author:');
  for (const a of (o.auteurs || [{ nom: 'SZH/CSPS' }])) {
    let premier = true;
    for (const c of ['prenom', 'nom', 'fonction', 'affiliation', 'orcid', 'email', 'photo']) {
      if (!a[c]) { continue; }
      l.push((premier ? '- ' : '  ') + c + ': "' + a[c] + '"');
      premier = false;
    }
  }
  return l.join(LF) + LF;
}

const ARTICLES = [
  { slug: '00-editorial', type: 'editorial', titre: 'Éditorial',
    auteurs: [{ prenom: 'Romain', nom: 'Lanners', fonction: 'Directeur', affiliation: 'SZH/CSPS' }] },
  { slug: '01-gremion', type: 'article',
    titre: 'Les transitions scolaires des élèves à besoins éducatifs particuliers',
    titreDe: 'Schulische Übergänge von Schülerinnen und Schülern',
    soustitre: 'Une étude longitudinale en Suisse romande',
    resume: 'Cet article examine les parcours de transition entre le degré primaire et le '
      + 'degré secondaire I, à partir d’un suivi de trois cohortes sur six ans.',
    motscles: ['transition', 'besoins éducatifs particuliers'],
    auteurs: [{ prenom: 'Lise', nom: 'Grémion', fonction: 'Professeure', affiliation: 'HEP Vaud',
                orcid: '0000-0002-1825-0097', email: 'lise@exemple.ch',
                photo: 'portraits/lise-gremion.sans-fond.png' },
              { prenom: 'Marc', nom: 'Rytz' }] },
  { slug: '02-chanier', type: 'article', titre: 'Accompagner la sortie de l’école obligatoire' },
  { slug: '03-guilley', type: 'article', titre: 'Mesures renforcées et statistiques' },
  { slug: '04-leclerc', type: 'interview', titre: 'Entretien avec une enseignante' },
  { slug: '05-pagnamenta', type: 'article', titre: 'Formation professionnelle et handicap' },
  { slug: '06-pirico', type: 'article', titre: 'Le rôle des parents' },
  { slug: '07-zufferey', type: 'article', titre: 'Coopération entre professionnels', lang: 'de' },
  { slug: '08-dentz', type: 'varia', titre: 'Varia', licence: 'droits-reserves' },
  { slug: '09-tribune', type: 'tribune-libre', titre: 'Tribune libre' },
  { slug: '10-documentation', type: 'documentation', titre: 'Documentation' }
];

function numeroReel() {
  const revue = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-carte-'));
  fs.writeFileSync(path.join(revue, 'ausgabe.yaml'),
    ['revue: "Revue suisse de pedagogie specialisee"', 'title: "Transitions"', 'lang: fr',
     'volume: "16"', 'numero: "03"', 'date: "2026-09-08"', 'couleur: bleuacier', ''].join(LF));
  for (const a of ARTICLES) {
    const d = path.join(revue, 'articles', a.slug);
    fs.mkdirSync(path.join(d, 'media'), { recursive: true });
    let corps = 'Un paragraphe.' + LF;
    if (a.slug === '01-gremion') {
      // Les trois cas d'images, dans un article réel : une informative sans alternative,
      // une décorative (alt="" explicite), une figure sans légende.
      corps += ['',
        '![Parcours des trois cohortes](media/figure-01.png)', '',
        '![Bandeau décoratif](media/deco.png){alt=""}', '',
        '![](media/figure-02.png){alt="Répartition par canton"}', ''].join(LF);
      for (const n of ['figure-01.png', 'deco.png', 'figure-02.png']) {
        fs.writeFileSync(path.join(d, 'media', n), Buffer.alloc(64));
      }
      // Et trois fichiers de portrait, qui ne DOIVENT PAS entrer dans le compteur.
      fs.mkdirSync(path.join(d, 'portraits'), { recursive: true });
      for (const n of ['lise-gremion.original.jpg', 'lise-gremion.avec-fond.png',
                       'lise-gremion.sans-fond.png']) {
        fs.writeFileSync(path.join(d, 'portraits', n), Buffer.alloc(128));
      }
    }
    fs.writeFileSync(path.join(d, a.slug + '.md'), corps);
    fs.writeFileSync(path.join(d, a.slug + '.meta.yaml'), fiche(a));
  }
  // Le journal de la dernière compilation, au format à codes que les filtres écrivent.
  fs.writeFileSync(path.join(revue, '.szh-journal.log'), [
    '[citations-avertissement] appel-sans-reference | article « 01-gremion » | appel « (Shaw et al., 2023) » | Appel sans référence. | [de] Verweis ohne Referenz.',
    '[citations-avertissement] appel-sans-reference | article « 01-gremion » | appel « (Sen, 2001) » | Appel sans référence. | [de] Verweis ohne Referenz.',
    '[citations-avertissement] appel-ambigu | article « 01-gremion » | appel « (Muller) » | Appel ambigu. | [de] Mehrdeutiger Verweis.',
    ''].join(LF));
  return revue;
}

const REVUE = numeroReel();
const HOTE = activerHote(REVUE);
const AUSGABE = path.join(REVUE, 'ausgabe.yaml');

// Le démarrage de l'hôte passe par un indicateur de progression : ses microtâches doivent
// avoir tourné avant qu'on lui demande quoi que ce soit.
const pret = new Promise((r) => setTimeout(r, 30));

async function vue() {
  await pret;
  await HOTE.executer('szh.vueArticles');
  const p = HOTE.panneauDeType('szhVueArticles');
  assert.ok(p, 'panneau de la vue « Articles » absent');
  await p._recepteur({ type: 'pret' });
  return p;
}

function derniereCharge(p) { return p.messages.filter((m) => m.type === 'valeurs').pop(); }

function doiDe(ligne) {
  const lignes = ligne.apercu.lignes;
  return lignes[lignes.length - 1].valeurs[0].texte;
}

// Écrit une clé d'état dans le fichier du numéro et fait relire l'hôte : c'est le seul
// chemin, l'état d'un numéro ne vivant nulle part ailleurs que dans son fichier.
async function poserEtat(cles) {
  const yaml = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'yaml.js'));
  fs.writeFileSync(AUSGABE, yaml.serialiserAusgabe(fs.readFileSync(AUSGABE, 'utf8'), cles));
  await HOTE.executer('szh.cockpit.rafraichir');
}

test('DOI : sur un numéro réel, l’éditorial porte 00 et la Documentation n’en reçoit aucun', async () => {
  const p = await vue();
  const charge = derniereCharge(p);
  assert.strictEqual(charge.lignes.length, 11);
  // Les dix porteurs, dans l'ordre du sommaire, et leur DOI calculé.
  const attendus = ['10.57161/r2026-03-00', '10.57161/r2026-03-01', '10.57161/r2026-03-02',
    '10.57161/r2026-03-03', '10.57161/r2026-03-04', '10.57161/r2026-03-05',
    '10.57161/r2026-03-06', '10.57161/r2026-03-07', '10.57161/r2026-03-08',
    '10.57161/r2026-03-09'];
  assert.deepStrictEqual(charge.lignes.slice(0, 10).map(doiDe), attendus);
  // La Documentation : aucun DOI, et elle est en fin de numéro.
  const doc = charge.lignes[10];
  assert.strictEqual(doc.cle, '10-documentation', 'la Documentation n’est pas en fin de numéro');
  assert.match(doiDe(doc), /aucun/);
  // Sa case est cochée et verrouillée : c'est la rubrique qui décide, pas la rédaction.
  assert.strictEqual(doc.sansDoi.coche, true);
  assert.strictEqual(doc.sansDoi.verrouille, true);
  // Et le rang du DOI reste contigu : aucun trou, aucun saut.
  assert.deepStrictEqual(attendus.map((d) => d.slice(-2)),
    ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09']);
});

test('carte : l’aperçu est complet, et il ne porte aucun champ de saisie', async () => {
  const p = await vue();
  const charge = derniereCharge(p);
  const page = ouvrir({
    racine: RACINE, page: 'articles',
    cssPartage: ['_design.css', '_liste.css', '_numero.css'], jsPartage: ['_numero.js'],
    txt: libellesHote(RACINE, ['textesNumero', 'textesArticles'])
  });
  page.envoyer(charge);
  assert.strictEqual(page.compter('.szh-carte'), 11);
  // Neuf champs par carte : rubrique, langue, titre, sous-titre, résumé, mots-clés,
  // auteur·e·s, licence, DOI.
  assert.strictEqual(page.compter('.apercu-rangee'), 9 * 11);
  // Non éditable : la grille ne porte ni champ de texte ni liste déroulante. La seule case
  // du bloc est « pas de DOI », qui n'est pas une métadonnée mais une décision de numéro.
  assert.strictEqual(page.compter('.apercu-grille input'), 0,
    'un champ de saisie s’est glissé dans l’aperçu : les valeurs se modifieraient à deux endroits');
  assert.strictEqual(page.compter('.apercu-grille select'), 0);
  assert.strictEqual(page.compter('.apercu-grille textarea'), 0);
  assert.strictEqual(page.compter('[data-sansdoi]'), 11, 'une case « pas de DOI » par article');
  // Et l'aperçu montre vraiment les valeurs de la fiche, y compris ses deux langues.
  const textes = page.textes().join(' | ');
  for (const attendu of ['Les transitions scolaires des élèves à besoins éducatifs particuliers',
    'Schulische Übergänge von Schülerinnen und Schülern',
    'Une étude longitudinale en Suisse romande',
    'transition · besoins éducatifs particuliers',
    'Lise Grémion · Professeure · HEP Vaud', 'Marc Rytz',
    'CC-BY 4.0', '10.57161/r2026-03-01', 'FR', 'DE']) {
    assert.ok(textes.indexOf(attendu) !== -1, 'absent de l’aperçu : ' + attendu);
  }
  // La licence « droits réservés » se dit, elle n'a pas de sigle à montrer.
  assert.ok(textes.indexOf('Droits réservés') !== -1, 'la licence fermée ne se lit pas');
  // Un article qui déclare sa langue le dit ; les autres suivent le numéro.
  assert.ok(textes.indexOf('allemand') !== -1, 'la langue déclarée d’un article ne se lit pas');
  assert.ok(textes.indexOf('celle du numéro') !== -1);
});

test('carte : les deux boutons ouvrent les bons formulaires, sur le bon article', async () => {
  const p = await vue();
  const avant = HOTE.panneaux.length;
  await p._recepteur({ type: 'action', cle: '01-gremion', id: 'metadonnees' });
  const fiches = HOTE.panneauDeType('szhApercuMetadonnees');
  assert.ok(fiches, 'le bouton « Éditer les métadonnées » n’ouvre rien');
  // Filtré sur cet article, et non sur tout le numéro : le titre le porte.
  assert.ok(String(fiches.title).indexOf('01-gremion') !== -1,
    'le formulaire n’est pas filtré sur l’article de la carte : ' + fiches.title);

  await p._recepteur({ type: 'action', cle: '01-gremion', id: 'medias' });
  const medias = HOTE.panneauDeType('szhMedias');
  assert.ok(medias, 'le bouton « Éditer les médias » n’ouvre rien');
  assert.ok(String(medias.title).indexOf('01-gremion') !== -1,
    'le gestionnaire des médias n’est pas ouvert sur le bon article : ' + medias.title);
  assert.ok(HOTE.panneaux.length > avant);
});

test('carte : le compteur d’images exclut les portraits, et ne reproche que ce qui manque', async () => {
  const p = await vue();
  const ligne = derniereCharge(p).lignes.find((l) => l.cle === '01-gremion');
  // Trois images dans media/, et trois fichiers de portrait à côté : le compteur dit trois.
  const compteur = ligne.pastilles.find((x) => /image/.test(x.texte));
  assert.ok(compteur, 'aucun compteur d’images sur la carte');
  assert.match(compteur.texte, /^3 image/,
    'les photos des autrices et auteurs sont comptées comme des figures : ' + compteur.texte);
  const dits = ligne.constats.map((c) => c.texte).join(' | ');
  // Une seule image informative sans texte alternatif : la décorative n'est pas comptée.
  assert.match(dits, /1 image\(s\) apportent une information et n’ont pas de texte alternatif/);
  // Une seule légende vide.
  assert.match(dits, /1 image\(s\) sans légende/);
  // Un article sans image ne dit rien du tout de ses images.
  const nu = derniereCharge(p).lignes.find((l) => l.cle === '02-chanier');
  assert.ok(!nu.pastilles.some((x) => /image/.test(x.texte)),
    'un compteur à zéro s’affiche : c’est du bruit');
  assert.ok(!nu.constats.some((c) => /image/.test(c.texte)));
});

test('carte : un appel de citation sans référence se dit sur la carte, avec son compte', async () => {
  const p = await vue();
  const ligne = derniereCharge(p).lignes.find((l) => l.cle === '01-gremion');
  const dits = ligne.constats.map((c) => c.texte);
  assert.ok(dits.some((t) => /2 appel\(s\) de citation ne mènent à aucune référence/.test(t)),
    'l’article ne dit pas ses appels non liés : ' + dits.join(' | '));
  assert.ok(dits.some((t) => /1 appel\(s\) de citation désignent plusieurs références/.test(t)));
  // Et l'article que le journal ne nomme pas ne porte rien de la sorte.
  const autre = derniereCharge(p).lignes.find((l) => l.cle === '02-chanier');
  assert.ok(!autre.constats.some((c) => /citation/.test(c.texte)),
    'un constat s’est rattaché au mauvais article');
});

test('déplacement : franchir la frontière du DOI est refusé, et le refus s’explique', async () => {
  const p = await vue();
  const charge = derniereCharge(p);
  // Le bouton l'annonce déjà : la Documentation ne peut ni monter ni descendre, seule dans
  // son bloc et en fin de numéro.
  const doc = charge.lignes.find((l) => l.cle === '10-documentation');
  assert.strictEqual(doc.actions.find((a) => a.id === 'monter').desactive, true);
  assert.strictEqual(doc.actions.find((a) => a.id === 'descendre').desactive, true);
  // Le dernier porteur ne peut pas descendre sous elle.
  const tribune = charge.lignes.find((l) => l.cle === '09-tribune');
  assert.strictEqual(tribune.actions.find((a) => a.id === 'descendre').desactive, true);
  assert.strictEqual(tribune.actions.find((a) => a.id === 'monter').desactive, false);

  // Et l'hôte refuse aussi, une webview pouvant envoyer n'importe quel message. Le refus
  // est DIT : c'est une règle, pas une évidence de bord de liste.
  const avant = fs.readFileSync(AUSGABE, 'utf8');
  await p._recepteur({ type: 'action', cle: '10-documentation', id: 'monter' });
  const etat = p.messages.filter((m) => m.type === 'etat').pop();
  assert.ok(etat && /sans DOI reste après/.test(etat.message),
    'le refus ne s’explique pas : ' + JSON.stringify(etat));
  assert.strictEqual(fs.readFileSync(AUSGABE, 'utf8'), avant, 'l’ordre a bougé malgré le refus');
});

test('case « pas de DOI » : elle renumérote le numéro et range l’article à la fin', async () => {
  const p = await vue();
  await p._recepteur({ type: 'sansdoi', cle: '08-dentz', coche: true });
  const texte = fs.readFileSync(AUSGABE, 'utf8');
  assert.match(texte, /^articles-sans-doi: \["08-dentz"\]$/m, 'la case n’est pas retenue');
  // L'ordre part avec : le fichier doit dire la même chose que l'écran.
  assert.match(texte, /^ordre-articles: \[.*"09-tribune", "08-dentz", "10-documentation"\]$/m,
    'l’ordre du fichier ne suit pas la règle : ' + texte);
  // Et les DOI se sont resserrés : la tribune libre prend le rang que le varia occupait.
  const charge = derniereCharge(p);
  const par = {};
  for (const l of charge.lignes) { par[l.cle] = doiDe(l); }
  assert.strictEqual(par['09-tribune'], '10.57161/r2026-03-08');
  assert.match(par['08-dentz'], /aucun — décidé/);
  // La case est cochée et NON verrouillée : c'est une décision, elle se reprend.
  const varia = charge.lignes.find((l) => l.cle === '08-dentz');
  assert.strictEqual(varia.sansDoi.coche, true);
  assert.strictEqual(varia.sansDoi.verrouille, false);

  // Décochée, l'article retrouve un DOI — mais PAS sa place d'avant, et c'est voulu :
  // l'ordre est une donnée du numéro, pas un souvenir. Il est descendu d'un cran quand la
  // case l'a rangé à la fin, il reste là, et il porte donc maintenant le dernier rang. Les
  // boutons de déplacement servent à le remonter si on le veut.
  await p._recepteur({ type: 'sansdoi', cle: '08-dentz', coche: false });
  const revenu = derniereCharge(p);
  assert.deepStrictEqual(revenu.lignes.map((l) => l.cle).slice(8),
    ['09-tribune', '08-dentz', '10-documentation']);
  assert.strictEqual(doiDe(revenu.lignes.find((l) => l.cle === '09-tribune')), '10.57161/r2026-03-08');
  assert.strictEqual(doiDe(revenu.lignes.find((l) => l.cle === '08-dentz')), '10.57161/r2026-03-09');
  // Et la clé est repartie : plus aucun article coché.
  assert.ok(!/^articles-sans-doi: \[".+"\]$/m.test(fs.readFileSync(AUSGABE, 'utf8')),
    'la case décochée laisse un résidu dans le fichier du numéro');
  // On le remet où il était, pour les contrôles qui suivent.
  await p._recepteur({ type: 'action', cle: '08-dentz', id: 'monter' });
});

// ---- Le gel de l'ordre : l'archivage seul ----
//
// Les deux sens, et le second est celui qui protège la distinction. Sans lui, remettre
// refuserSiVerrouille() sur le réordonnancement passerait tous les contrôles.

test('ordre : un numéro VERROUILLÉ mais non archivé accepte encore un déplacement', async () => {
  const p = await vue();
  await poserEtat({ locked: true, archived: false });
  const avant = fs.readFileSync(AUSGABE, 'utf8');
  await p._recepteur({ type: 'action', cle: '02-chanier', id: 'monter' });
  const apres = fs.readFileSync(AUSGABE, 'utf8');
  assert.notStrictEqual(apres, avant,
    'le verrou a gelé l’ordre : un numéro verrouillé a ses TEXTES figés, pas sa séquence');
  assert.match(apres, /^ordre-articles: \["00-editorial", "02-chanier", "01-gremion"/m);
  // Le verrou est bien posé, et il n'a simplement pas voix au chapitre sur l'ordre.
  assert.match(apres, /^locked: true$/m);
  // La case « pas de DOI » suit la même règle : elle décide de l'ordre.
  await p._recepteur({ type: 'sansdoi', cle: '08-dentz', coche: true });
  assert.match(fs.readFileSync(AUSGABE, 'utf8'), /^articles-sans-doi: \["08-dentz"\]$/m);
  await p._recepteur({ type: 'sansdoi', cle: '08-dentz', coche: false });
});

test('ordre : un numéro ARCHIVÉ refuse le déplacement, et l’ordre ne bouge pas', async () => {
  const p = await vue();
  await poserEtat({ locked: false, archived: true });
  const avant = fs.readFileSync(AUSGABE, 'utf8');
  const avertissements = HOTE.avertissements.length;
  await p._recepteur({ type: 'action', cle: '01-gremion', id: 'monter' });
  assert.strictEqual(fs.readFileSync(AUSGABE, 'utf8'), avant,
    'l’ordre d’un numéro archivé a changé : les DOI déposés ne désignent plus les mêmes articles');
  assert.ok(HOTE.avertissements.length > avertissements, 'le refus n’est pas affiché');
  assert.match(HOTE.avertissements[HOTE.avertissements.length - 1], /archiv/i);
  // La case « pas de DOI » est refusée aussi : elle décide de l'ordre.
  await p._recepteur({ type: 'sansdoi', cle: '08-dentz', coche: true });
  assert.strictEqual(fs.readFileSync(AUSGABE, 'utf8'), avant,
    'la case a modifié un numéro archivé');
  // Désarchiver rend l'ordre, et ne déverrouille rien : les deux drapeaux sont indépendants.
  await poserEtat({ archived: false, locked: true });
  await p._recepteur({ type: 'action', cle: '01-gremion', id: 'monter' });
  const rendu = fs.readFileSync(AUSGABE, 'utf8');
  assert.notStrictEqual(rendu, avant, 'sorti des archives, le numéro reste gelé');
  assert.match(rendu, /^locked: true$/m, 'désarchiver a déverrouillé');
});

// ---- L'export : une absence VOULUE n'est pas un oubli ----

test('export : un article coché « pas de DOI » ne bloque plus l’export', () => {
  const revue = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-doi-'));
  const gabarit = fs.readFileSync(path.join(RACINE, 'revue-template', 'ausgabe.yaml'), 'utf8');
  const yaml = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'yaml.js'));
  const monter = (sansDoi) => {
    const cles = { revue: 'revue', lang: 'fr', date: '2026-09-08' };
    if (sansDoi) { cles[yaml.CLE_SANS_DOI] = sansDoi; }
    fs.writeFileSync(path.join(revue, 'ausgabe.yaml'), yaml.serialiserAusgabe(gabarit, cles));
  };
  fs.writeFileSync(path.join(revue, 'couverture.jpg'), Buffer.from('JPEG'));
  const slug = '01-varia';
  const d = path.join(revue, 'articles', slug);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, slug + '.md'), 'Texte.' + LF);
  fs.writeFileSync(path.join(d, slug + '.meta.yaml'),
    ['type: varia', 'lang: fr', 'title:', '  fr: "Varia"', 'resume:', '  fr: "Un résumé."',
     'author:', '- nom: "SZH/CSPS"', ''].join(LF));
  const sortie = path.join(revue, 'out', slug);
  fs.mkdirSync(sortie, { recursive: true });
  for (const ext of ['pdf', 'html', 'docx']) {
    fs.writeFileSync(path.join(sortie, slug + '.' + ext), Buffer.from(ext));
  }
  const config = {
    revues: {
      fr: { genreFichier: "Texte de l'article", groupeAuteur: 'Auteur', televerseur: 'redaction', paysAuteur: '' },
      de: { genreFichier: 'Artikeltext', groupeAuteur: 'Autor/in', televerseur: 'redaktion', paysAuteur: '' }
    }
  };

  // Sans la case : l'article reçoit le DOI que sa place lui donne, calculé et non saisi.
  // Il est seul dans le numéro 2 de 2026, il ouvre donc à « 00 ».
  monter(null);
  const avec = ojs.genererExportOjs(revue, { config: config });
  assert.ok(fs.readFileSync(avec.chemin, 'utf8')
    .indexOf('<id type="doi" advice="update">10.57161/r2026-02-00</id>') !== -1,
    'le DOI calculé n’est pas parti');

  // Avec la case : l'absence est voulue, l'export passe et le DIT.
  monter([slug]);
  const r = ojs.genererExportOjs(revue, { config: config });
  assert.ok(r.avertissements.some((a) => /voulu|gewollt/i.test(a) || /décidé/.test(a)),
    'l’absence voulue n’est pas signalée : ' + r.avertissements.join(' | '));
  const xml = fs.readFileSync(r.chemin, 'utf8');
  assert.strictEqual(xml.indexOf('type="doi"'), -1, 'un DOI a été inventé');
});
