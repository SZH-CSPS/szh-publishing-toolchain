// pipeline/manuscrit_gabarit.py : l'écrivain du nettoyeur de manuscrit (article), §4/§5.3/
// §10/§11 de outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md. Ce fichier éprouve les sept
// contrôles posés au §11 pour manuscrit-gabarit.test.js :
//   1. aller-retour : un document (corps + titres + une image + un tableau), écrit puis relu
//      par pronto-lire.py, rend les champs attendus (légende, blocs reconnus) ;
//   2. aucun signe perdu : le texte du corps en sortie (relu par manuscrit_docx.py, LA
//      référence de vérité du contrat) est celui d'entrée, caractère pour caractère ;
//   3. chaque image est dans un bloc figure, et ses OCTETS sont identiques à l'entrée (sha256,
//      jamais la seule taille) ;
//   4. chaque bloc porte sa rangée de métadonnées fusionnée sur TOUTE la largeur déclarée du
//      bloc, quel que soit le nombre de colonnes du tableau qu'il enveloppe ;
//   5. un paragraphe vide sépare toujours deux blocs qui se touchent (contrôle du repliage
//      LibreOffice, §10) ;
//   6. l'italique survit au passage dans l'écrivain ;
//   7. un document sans aucune image ni tableau produit un .docx valide et relisible — le cas
//      le plus courant, le plus facile à casser en soignant les cas rares.
// Plus le contrôle sur le corpus réel (§11, note finale) : les onze manuscrits de
// tmp/corpus-relecture/lot-A/ s'écrivent au gabarit sans exception et se relisent tous par
// pronto-lire.py — sauté sous un motif nommé si tmp/ (hors git) est absent.
//
//   node --test test/js/manuscrit-gabarit.test.js
//
// Patron : test/js/manuscrit-docx.test.js. Gardes de test/js/gardes.js : PYTHON (jamais
// `python3` en dur). manuscrit_gabarit.py n'a pas de CLI propre (c'est une bibliothèque,
// §4 : « def ecrire(document, chemin_gabarit, chemin_sortie, decisions) ») : ce fichier le
// pilote via un petit programme Python écrit au vol (patron FABRIQUE de
// manuscrit-docx.test.js), qui importe le module et appelle ecrire() directement — puis relit
// le résultat par les DEUX lecteurs de production, jamais un lecteur maison : manuscrit_docx.py
// (référence de vérité du contrat, §5.3) et pipeline/pronto-lire.py (le lecteur de production,
// §11 : « c'est le seul contrôle qui prouve que ton écrivain et le lecteur de production sont
// d'accord »).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { PYTHON, sansPython, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');
const MANUSCRIT_DOCX = path.join(PIPELINE, 'manuscrit_docx.py');
const PRONTO_LIRE = path.join(PIPELINE, 'pronto-lire.py');
const GABARIT_LIVRE = path.join(RACINE, "revue-template", "Pronto - modele d'article.docx");
const CORPUS_LOT_A = path.join(RACINE, 'tmp', 'corpus-relecture', 'lot-A');

// PYTHONIOENCODING=utf-8 : sans elle, l'interprète Python de ce poste écrit son stdout dans
// l'encodage de la console Windows (cp1252, mesuré le 18.09.2026) — pronto-lire.py écrit
// pourtant du JSON en UTF-8 littéral (ensure_ascii=False, contrairement à manuscrit_docx.py
// et manuscrit_modele.py qui posent ensure_ascii=True pour cette même raison). Sans cette
// variable, un accent fait soit une bouillie de caractères (mojibake), soit un
// UnicodeEncodeError qui fait carrément planter pronto-lire.py — mesuré sur le corpus réel
// (lot-A/4_La méthode Flip Flap.docx, dont le nom même porte un accent). C'est un défaut de
// pronto-lire.py, pas de ce chantier (fichier existant, hors des deux qu'il touche) : contourné
// ici côté harnais de test, jamais réparé en silence dans le pipeline — voir le rapport final.
const ENV_UTF8 = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });

function python(args) {
  return cp.spawnSync(PYTHON, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
}

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-manuscritgabarit-'));
}

// ---------------------------------------------------------------------------------
// Pilotage de manuscrit_gabarit.ecrire() depuis Node : construit un Document (via
// manuscrit_modele.document_depuis_json(), déjà éprouvé par manuscrit_modele.test.js — même
// schéma JSON que son mode --diagnostic, documenté en tête de ce fichier) et appelle ecrire().
const ECRIRE_DEPUIS_JSON = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import manuscrit_modele as mm',
  'import manuscrit_gabarit as mg',
  'chemin_gabarit, chemin_sortie, json_doc = sys.argv[2], sys.argv[3], sys.argv[4]',
  'document = mm.document_depuis_json(json.loads(json_doc))',
  'resultat = mg.ecrire(document, chemin_gabarit, chemin_sortie, decisions=None)',
  'print(json.dumps(resultat, ensure_ascii=True))',
].join('\n');

function ecrireDepuisSpec(spec, cheminSortie, cheminGabarit) {
  const r = python(['-c', ECRIRE_DEPUIS_JSON, PIPELINE, cheminGabarit || GABARIT_LIVRE,
    cheminSortie, JSON.stringify(spec)]);
  assert.strictEqual(r.status, 0, 'ecrire() a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

// Pilotage depuis un .docx RÉEL (pas un JSON) — pour le contrôle sur le corpus lot-A : lit le
// manuscrit avec manuscrit_docx.lire() (le lecteur de production) puis écrit au gabarit.
const ECRIRE_DEPUIS_DOCX = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import manuscrit_docx as md',
  'import manuscrit_gabarit as mg',
  'chemin_manuscrit, chemin_gabarit, chemin_sortie = sys.argv[2], sys.argv[3], sys.argv[4]',
  'document = md.lire(chemin_manuscrit)',
  'resultat = mg.ecrire(document, chemin_gabarit, chemin_sortie, decisions=None)',
  'print(json.dumps(resultat, ensure_ascii=True))',
].join('\n');

function diagnostiquerManuscritDocx(mode, chemin) {
  const r = python([MANUSCRIT_DOCX, mode, chemin]);
  assert.strictEqual(r.status, 0, mode + ' a échoué sur ' + chemin + ' : ' + r.stderr);
  return JSON.parse(r.stdout);
}

function prontoLire(chemin, slug, dossier) {
  const r = python([PRONTO_LIRE, chemin, slug, dossier]);
  assert.strictEqual(r.status, 0, 'pronto-lire.py a échoué sur ' + chemin + ' : ' + r.stderr);
  return JSON.parse(r.stdout);
}

// Lit word/document.xml tel quel (XML brut) — pour les deux contrôles qui inspectent la
// structure produite directement, plutôt que par un des deux lecteurs de production.
const LIRE_DOCUMENT_XML = 'import sys, zipfile\n'
  + 'z = zipfile.ZipFile(sys.argv[1])\n'
  + 'sys.stdout.write(z.read("word/document.xml").decode("utf-8"))\n';

function lireDocumentXml(chemin) {
  return cp.execFileSync(PYTHON, ['-c', LIRE_DOCUMENT_XML, chemin],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
}

// ---------------------------------------------------------------------------------
// pandoc sous la WSL (§5.4 du contrat) — la mesure qui tranche pour les listes : le writer
// Markdown de pandoc peut embellir, l'AST natif ne ment pas. Même distro que gardes.js
// (SZH-Publishing) et que pipeline/manuscrit_typo.py — voir son en-tête pour le piège des
// antislashs (wsl.exe les avale dans un argument de tableau : on convertit AVANT l'appel).
const WSL_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
const DISTRO_WSL = 'SZH-Publishing';

function pandocNatifSurWsl(cheminWindows) {
  const wsl = cp.spawnSync(WSL_EXE, ['-d', DISTRO_WSL, '--', 'wslpath', '-a',
    cheminWindows.replace(/\\/g, '/')], { encoding: 'utf8' });
  assert.strictEqual(wsl.status, 0, 'wslpath a échoué sur ' + cheminWindows + ' : ' + wsl.stderr);
  const cible = wsl.stdout.trim();
  const r = cp.spawnSync(WSL_EXE, ['-d', DISTRO_WSL, '--', 'pandoc', '-f', 'docx', '-t', 'native',
    cible], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual(r.status, 0, 'pandoc a échoué sur ' + cheminWindows + ' : ' + r.stderr);
  return r.stdout;
}

// Un paragraphe de liste — `liste` : [numId, ilvl, format] comme le rend désormais
// manuscrit_docx.py (§5.4) ; le numId choisi ici (7, 8...) est délibérément arbitraire et ne
// doit JAMAIS se retrouver dans la sortie (contrôle n°4).
function paragrapheListe(texte, numid, ilvl, format) {
  return paragraphe([fragment(texte)], { liste: [numid, ilvl, format] });
}

// ---------------------------------------------------------------------------------
// Fabrication de specs Document minimales (schéma document_depuis_json(), voir l'en-tête de
// manuscrit_modele.py) — un petit constructeur par type de bloc, pour ne pas répéter les
// champs par défaut dans chaque test.

function fragment(texte, forme, extra) {
  return Object.assign({ texte, forme: forme || {}, lien: null }, extra || {});
}

function paragraphe(fragments, extra) {
  return Object.assign({ type: 'paragraphe', style: '', niveau_declare: 0, niveau_retenu: 0,
    fragments, liste: null, alignement: '', retrait: 0 }, extra || {});
}

function image(nom, octetsB64, extra) {
  return Object.assign({ nom, octets_base64: octetsB64, surface: 1000 * 2000, alt: '',
    flottante: false }, extra || {});
}

function cellule(texte) {
  return { colspan: 1, rowspan: 1, entete: false,
    blocs: [paragraphe([fragment(texte)])] };
}

function tableau(rangees, extra) {
  return Object.assign({ type: 'tableau', page: null, rangees }, extra || {});
}

function specDocument(blocs) {
  return { styles: [], langue: 'fr', revisions: 0, commentaires: 0, notes: [], blocs };
}

// ---------------------------------------------------------------------------------
// Contrôle n°1 — aller-retour complet (image + tableau + légende déjà écrite dans le
// manuscrit) : la sortie relue par pronto-lire.py (le lecteur de PRODUCTION, pas un lecteur
// maison) rend les champs attendus.
//
// Sabotage minimal : dans _rangee_meta_xml(), remplacer le libellé 'Légende' par 'Legende'
// (retirer l'accent) — pronto_modele._premiere_etiquette_szh_cle()/n_blocs_meta() comparent
// via aplatir() (accents et casse indifférents), donc CE sabotage précis reste inoffensif :
// preuve qu'il fallait le vérifier pour de vrai plutôt que de le supposer. Le sabotage qui
// tombe réellement (mesuré ci-dessous, §11 « vérifie d'abord que ton sabotage atterrit ») est
// de renommer l'étiquette en 'Description' — un mot hors du lexique LABELS_FIGURE de
// pronto_modele.py, qui ne peut alors plus reconnaître le bloc du tout.

test('manuscrit_gabarit.ecrire : aller-retour complet (image + tableau + légende), relu par pronto-lire.py',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const octetsImage = Buffer.from('OCTETS-DE-TEST-IMAGE-POUR-ALLER-RETOUR-0123456789');
      const spec = specDocument([
        paragraphe([fragment('Un titre')], { niveau_declare: 1, niveau_retenu: 1 }),
        paragraphe([fragment('Figure 1. Une légende déjà écrite dans le manuscrit.')]),
        paragraphe([fragment('', {}, { image: image('photo.png', octetsImage.toString('base64'),
          { alt: 'texte alternatif du manuscrit' }) })]),
        tableau([[cellule('A1'), cellule('B1')], [cellule('A2'), cellule('B2')]]),
      ]);
      const resultat = ecrireDepuisSpec(spec, sortie);
      assert.strictEqual(resultat.stats.blocs_figure, 1);
      assert.strictEqual(resultat.stats.blocs_tableau, 1);

      const dossierPronto = path.join(base, 'article');
      fs.mkdirSync(dossierPronto);
      const stats = prontoLire(sortie, 'essai', dossierPronto);
      assert.strictEqual(stats.blocs.length, 2, 'les deux blocs (figure, tableau) doivent être reconnus');
      const blocImage = stats.blocs.find((b) => b.nature === 'image');
      const blocTableau = stats.blocs.find((b) => b.nature === 'table');
      assert.ok(blocImage, 'le bloc figure doit être reconnu (nature=image)');
      assert.ok(blocTableau, 'le bloc tableau doit être reconnu (nature=table)');
      assert.strictEqual(blocImage.consommee, true);
      assert.strictEqual(blocTableau.consommee, true);
      assert.strictEqual(blocImage.legende, 'Figure 1. Une légende déjà écrite dans le manuscrit.',
        'la légende déjà présente dans le manuscrit doit être reprise dans le bloc figure');
      assert.strictEqual(blocTableau.tbl_interne, true,
        'le tableau du manuscrit doit être retrouvé comme tableau imbriqué du bloc');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°2 — aucun signe perdu : le texte du corps en sortie, relu par manuscrit_docx.py
// (LA référence de vérité, §5.3), est caractère pour caractère celui d'entrée. Compté, pas
// jugé à l'œil (§11).
//
// Sabotage minimal : dans _run_xml(), tronquer `fragment.texte` d'un caractère
// (`fragment.texte[:-1]`) avant de l'écrire — un caractère manque en sortie, la comparaison de
// longueur ET de contenu rougissent.

test('manuscrit_gabarit.ecrire : le texte du corps ne perd ni ne gagne aucun caractère',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const texteOrigine = 'Un paragraphe avec des caractères accentués : é è ê ç à, de la '
        + 'ponctuation ; : ! ? et un tiret - final.';
      const spec = specDocument([
        paragraphe([fragment(texteOrigine)]),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const { document } = diagnostiquerManuscritDocx('--diagnostic', sortie);
      const corps = document.blocs.find((b) => b.type !== 'tableau'
        && b.fragments.some((f) => f.texte));
      const texteRelu = corps.fragments.map((f) => f.texte).join('');
      assert.strictEqual(texteRelu.length, texteOrigine.length,
        'le nombre de caractères doit être identique (rien perdu, rien ajouté)');
      assert.strictEqual(texteRelu, texteOrigine);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°3 — chaque image est dans un bloc figure, et ses OCTETS sont identiques à
// l'entrée (sha256, jamais la seule taille — §11 : « une suggestion » n'a jamais suffi ici).
//
// Sabotage minimal : dans _Registre.enregistrer_image(), écrire `image.nom.encode()` au lieu
// de `image.octets` — le fichier écrit dans word/media/ existe toujours (même longueur de
// nom fortuite possible), mais son sha256 diffère de celui de l'image d'origine.

test('manuscrit_gabarit.ecrire : chaque image est dans un bloc figure, octets identiques (sha256)',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const octets = crypto.randomBytes(256);
      const spec = specDocument([
        paragraphe([fragment('', {}, { image: image('capture.png', octets.toString('base64')) })]),
      ]);
      const resultat = ecrireDepuisSpec(spec, sortie);
      assert.strictEqual(resultat.stats.blocs_figure, 1);

      const images = diagnostiquerManuscritDocx('--images', sortie);
      assert.strictEqual(images.length, 1, 'une seule image attendue dans la sortie');
      assert.strictEqual(images[0].sha256, crypto.createHash('sha256').update(octets).digest('hex'),
        'les octets de l\'image en sortie doivent être EXACTEMENT ceux de l\'entrée');
      assert.strictEqual(images[0].longueur, octets.length);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°4 — chaque bloc porte sa rangée de métadonnées fusionnée sur TOUTE la largeur
// déclarée du bloc (§5.3), quel que soit le nombre de colonnes du tableau qu'il enveloppe (ici
// 3, pour distinguer cette fusion de celle, différente, du tableau imbriqué lui-même).
//
// Sabotage minimal : dans _rangee_meta_xml(), remplacer LARGEUR_BLOC_DXA par
// LARGEUR_BLOC_DXA // 2 dans le w:tcW de la rangée de métadonnées — la cellule ne couvre plus
// que la moitié de la largeur déclarée du tableau qui l'enveloppe.

test('manuscrit_gabarit.ecrire : la rangée de métadonnées d\'un bloc est une seule cellule, fusionnée sur toute sa largeur',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        tableau([[cellule('A1'), cellule('B1'), cellule('C1')],
                 [cellule('A2'), cellule('B2'), cellule('C2')]]),
      ]);
      ecrireDepuisSpec(spec, sortie);

      const xml = lireDocumentXml(sortie);

      // Isole la rangée de métadonnées du bloc : après les deux tableaux fixes du gabarit
      // (métadonnées de l'article, autrices et auteurs), le premier <w:tbl> suivant est le
      // bloc que ce test a produit, et sa PREMIÈRE <w:tr> est la rangée de métadonnées — elle
      // ne peut jamais contenir de <w:tbl> imbriqué (les libellés SZH Cle n'en portent pas),
      // un `indexOf('</w:tr>')` simple depuis là suffit donc à la borner correctement.
      const finTable1 = xml.indexOf('</w:tbl>') + '</w:tbl>'.length;
      const finTable2 = xml.indexOf('</w:tbl>', finTable1) + '</w:tbl>'.length;
      const debutBloc = xml.indexOf('<w:tbl', finTable2);
      assert.ok(debutBloc > 0, 'le bloc tableau doit suivre les deux tableaux fixes du gabarit');
      const debutRangeeMeta = xml.indexOf('<w:tr>', debutBloc);
      const finRangeeMeta = xml.indexOf('</w:tr>', debutRangeeMeta) + '</w:tr>'.length;
      const rangeeMeta = xml.slice(debutRangeeMeta, finRangeeMeta);

      const nbCellules = (rangeeMeta.match(/<w:tc>/g) || []).length;
      assert.strictEqual(nbCellules, 1,
        'la rangée de métadonnées doit être UNE seule cellule, jamais une par colonne du '
        + 'tableau imbriqué (3 colonnes ici)');
      const largeur = rangeeMeta.match(/<w:tcW w:w="(\d+)"/);
      assert.ok(largeur, 'la cellule de métadonnées doit déclarer sa largeur');
      assert.strictEqual(Number(largeur[1]), 8220,
        'la cellule de métadonnées doit couvrir la largeur ENTIÈRE déclarée du bloc (8220 dxa, '
        + 'mesurée sur le gabarit livré), jamais une fraction');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°5 — un paragraphe vide sépare toujours deux blocs qui se touchent (§10 : sans
// lui, LibreOffice fond deux tableaux voisins en un seul — mesuré sur le gabarit réel, 4
// tableaux côté .docx contre 3 côté .odt). Deux images consécutives, sans texte entre elles,
// produisent donc deux blocs figure consécutifs : ce test vérifie qu'ils ne se touchent
// JAMAIS dans le XML brut.
//
// Sabotage minimal : dans _separateur_requis(), remplacer
// `return est_bloc_courant or est_bloc_precedent` par `return False` — les deux blocs figure
// se retrouvent collés, `</w:tbl><w:tbl` apparaît dans le document.xml produit.

test('manuscrit_gabarit.ecrire : un paragraphe vide sépare toujours deux blocs qui se touchent',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const octets1 = Buffer.from('IMAGE-UN-0123456789');
      const octets2 = Buffer.from('IMAGE-DEUX-0123456789');
      const spec = specDocument([
        paragraphe([fragment('', {}, { image: image('un.png', octets1.toString('base64')) })]),
        paragraphe([fragment('', {}, { image: image('deux.png', octets2.toString('base64')) })]),
      ]);
      ecrireDepuisSpec(spec, sortie);

      const xml = lireDocumentXml(sortie);

      assert.ok(!/<\/w:tbl>\s*<w:tbl\b/.test(xml),
        'deux blocs (deux tableaux) ne doivent JAMAIS se toucher directement dans le XML — '
        + 'sans paragraphe entre eux, LibreOffice les fond en un seul (§10)');
      // Contrôle positif : il y a bien deux blocs distincts à séparer (sinon le test ne
      // prouverait rien — deux images consécutives doivent produire deux <w:tbl> distincts).
      const nbTbl = (xml.match(/<w:tbl\b/g) || []).length;
      assert.ok(nbTbl >= 4, 'au moins 4 tableaux attendus (2 fixes du gabarit + 2 blocs figure)');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°6 — l'italique survit au passage dans l'écrivain (§5.2 : « un italique porte du
// sens... et le tuer est une perte qu'aucune relecture ne rattrape »).
//
// Sabotage minimal : dans _rpr_xml(), retirer la clause `if forme.get('italique')` (ou son
// corps `parties.append('<w:i/>')`) — le run italique revient sans w:i, forme.italique vaut
// null (jamais déclaré) au lieu de true après relecture.

test('manuscrit_gabarit.ecrire : l\'italique survit',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragraphe([
          fragment('texte normal, '),
          fragment('texte en italique', { italique: true }),
          fragment('.'),
        ]),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const { document } = diagnostiquerManuscritDocx('--diagnostic', sortie);
      // Le gabarit livré pose ses DEUX tableaux fixes (métadonnées, autrices et auteurs) et
      // les paragraphes vides qui les séparent AVANT le corps du manuscrit (voir la décision
      // n°1 de l'en-tête de manuscrit_gabarit.py) : chercher le premier paragraphe non-table
      // trouverait l'un de CES paragraphes de remplissage, vides, jamais le nôtre — il faut
      // filtrer sur un texte non vide, comme le fait déjà le contrôle n°2 ci-dessus.
      const p = document.blocs.find((b) => b.type !== 'tableau'
        && b.fragments.some((f) => f.texte));
      const fragItalique = p.fragments.find((f) => f.texte.includes('italique'));
      assert.ok(fragItalique, 'le fragment en italique doit être retrouvé');
      assert.strictEqual(fragItalique.forme.italique, true,
        'l\'italique doit survivre au passage dans l\'écrivain');
      const fragNormal = p.fragments.find((f) => f.texte.includes('normal'));
      assert.notStrictEqual(fragNormal.forme.italique, true,
        'un fragment qui n\'était pas en italique ne doit pas le devenir');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle ajouté après revue adverse (18.09.2026) — le corps porte bien le STYLE « Corps de
// texte » du gabarit, jamais « Normal » ni l'absence de w:pStyle, et un titre de niveau 1/2/3
// porte bien Titre1/Titre2/Titre3. Défaut trouvé : un sabotage de STYLE_CORPS ('Corpsdetexte'
// -> 'Normal') laissait les huit premiers contrôles VERTS — aucun d'eux n'inspectait le STYLE
// réellement écrit dans le XML, seulement le TEXTE relu. Un « Normal » écrit à la place de
// « Corps de texte » ne casse aucune reconstruction de texte ni de forme ; il casse la
// composition en aval (la maquette est accrochée au style, pas au contenu) — exactement le
// genre de défaut qu'un contrôle qui ne regarde que le texte ne peut jamais voir.
//
// Le style effectivement écrit se lit sur `Paragraphe.style` du JSON --diagnostic de
// manuscrit_docx.py : ce champ est le nom humain RÉSOLU par resoudre_style() depuis le
// styles.xml du GABARIT lui-même (Corpsdetexte -> « body text », Titre1/2/3 -> « heading
// 1/2/3 », Normal -> « normal », AUCUN w:pStyle -> '') — trois valeurs bien distinctes, ce
// contrôle ne peut donc pas se tromper de style par coïncidence de nommage.
//
// Sabotages minimaux, dans les deux sens (§11 : « quelque chose doit rougir ») :
//   - STYLE_CORPS = 'Corpsdetexte' -> 'Normal' : les paragraphes de corps ressortent avec le
//     style 'normal' au lieu de 'body text' — ce contrôle-ci rougit (et lui seul : aucun des
//     sept autres n'inspecte le style écrit, comme le pointe la revue).
//   - STYLE_TITRE = {1: 'Titre1', ...} -> {1: 'Titre2', ...} (niveau 1 mappé sur Titre2) :
//     le titre de niveau 1 ressort avec le style 'heading 2' au lieu de 'heading 1' — ce
//     contrôle-ci rougit (assertion sur le titre de niveau 1).

test('manuscrit_gabarit.ecrire : le corps porte le style « Corps de texte », les titres Titre1/2/3, jamais Normal ni l\'absence de style',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragraphe([fragment('Titre de premier niveau')], { niveau_declare: 1, niveau_retenu: 1 }),
        paragraphe([fragment('Titre de second niveau')], { niveau_declare: 2, niveau_retenu: 2 }),
        paragraphe([fragment('Titre de troisième niveau')], { niveau_declare: 3, niveau_retenu: 3 }),
        paragraphe([fragment('Premier paragraphe de corps.')]),
        paragraphe([fragment('Second paragraphe de corps.')]),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const { document } = diagnostiquerManuscritDocx('--diagnostic', sortie);

      function styleDuTexte(texte) {
        const p = document.blocs.find((b) => b.type !== 'tableau'
          && b.fragments.some((f) => f.texte === texte));
        assert.ok(p, 'paragraphe attendu introuvable en sortie : ' + texte);
        return p.style;
      }

      assert.strictEqual(styleDuTexte('Titre de premier niveau'), 'heading 1');
      assert.strictEqual(styleDuTexte('Titre de second niveau'), 'heading 2');
      assert.strictEqual(styleDuTexte('Titre de troisième niveau'), 'heading 3');

      for (const texte of ['Premier paragraphe de corps.', 'Second paragraphe de corps.']) {
        const style = styleDuTexte(texte);
        assert.strictEqual(style, 'body text',
          'un paragraphe de corps doit porter le style « Corps de texte » (résolu « body '
          + 'text » depuis le gabarit) — obtenu : ' + JSON.stringify(style));
        assert.notStrictEqual(style, 'normal',
          'un paragraphe de corps ne doit JAMAIS ressortir avec le style Normal du gabarit');
        assert.notStrictEqual(style, '',
          'un paragraphe de corps ne doit JAMAIS ressortir sans aucun w:pStyle');
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°7 — un document SANS aucune image ni tableau produit un .docx valide et
// relisible : le cas le plus courant (§11 : « le plus facile à casser en soignant les cas
// rares »). Vérifié par les DEUX lecteurs de production, et par la conservation du niveau de
// titre (pas seulement « ça ne plante pas »).
//
// Sabotage minimal : dans STYLE_TITRE, retirer l'entrée `1: 'Titre1'` — un titre de niveau 1
// est alors rendu avec le style de corps (repli de _style_pour_paragraphe sur STYLE_CORPS),
// et niveau_declare revient à 0 après relecture au lieu de 1.

test('manuscrit_gabarit.ecrire : un document sans image ni tableau produit un .docx valide et relisible',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragraphe([fragment('Titre de niveau 1')], { niveau_declare: 1, niveau_retenu: 1 }),
        paragraphe([fragment('Un paragraphe de corps ordinaire.')]),
        paragraphe([fragment('Un second paragraphe de corps.')]),
      ]);
      const resultat = ecrireDepuisSpec(spec, sortie);
      assert.strictEqual(resultat.stats.blocs_figure, 0);
      assert.strictEqual(resultat.stats.blocs_tableau, 0);

      // Lecteur n°1 : manuscrit_docx.py, la référence de vérité du contrat.
      const { document } = diagnostiquerManuscritDocx('--diagnostic', sortie);
      const titre = document.blocs.find((b) => b.type !== 'tableau' && b.niveau_declare > 0);
      assert.ok(titre, 'le titre doit être retrouvé à la relecture');
      assert.strictEqual(titre.niveau_declare, 1,
        'un titre de niveau 1 doit rester de niveau 1 après le passage dans l\'écrivain');
      assert.strictEqual(titre.fragments.map((f) => f.texte).join(''), 'Titre de niveau 1');

      // Lecteur n°2 : pronto-lire.py, le lecteur de PRODUCTION — ne doit ni planter ni
      // signaler de bloc mal formé sur un document qui n'en a aucun.
      const dossierPronto = path.join(base, 'article');
      fs.mkdirSync(dossierPronto);
      const stats = prontoLire(sortie, 'essai', dossierPronto);
      assert.deepStrictEqual(stats.blocs, []);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Le contrôle le moins cher et le plus utile (§11, note finale) : les onze manuscrits réels
// s'écrivent au gabarit sans exception et se relisent tous par pronto-lire.py. tmp/ est hors
// git et peut être effacé sans prévenir : sauté proprement, sous un motif nommé, quand il est
// absent — jamais en silence.

test('manuscrit_gabarit.ecrire : les onze manuscrits réels de lot-A s\'écrivent au gabarit et se relisent tous',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      t.skip('corpus tmp/corpus-relecture/lot-A absent (tmp/ est hors git, effacé sans prévenir)');
      return;
    }
    const fichiers = fs.readdirSync(CORPUS_LOT_A).filter((n) => n.toLowerCase().endsWith('.docx'));
    assert.ok(fichiers.length > 0, 'aucun .docx trouvé dans lot-A alors que le dossier existe');
    const base = dossierJetable();
    try {
      const echecsEcriture = [];
      const echecsRelecture = [];
      for (const nom of fichiers) {
        const entree = path.join(CORPUS_LOT_A, nom);
        const sortie = path.join(base, nom.replace(/\.docx$/i, '') + '-gabarit.docx');
        const r = python(['-c', ECRIRE_DEPUIS_DOCX, PIPELINE, entree, GABARIT_LIVRE, sortie]);
        if (r.status !== 0) {
          echecsEcriture.push(nom + ' : ' + r.stderr);
          continue;
        }
        const dossierPronto = path.join(base, nom.replace(/\.docx$/i, '') + '-article');
        fs.mkdirSync(dossierPronto, { recursive: true });
        const rl = python([PRONTO_LIRE, sortie, 'essai', dossierPronto]);
        if (rl.status !== 0) { echecsRelecture.push(nom + ' : ' + rl.stderr); }
      }
      assert.deepStrictEqual(echecsEcriture, [], 'ces manuscrits ont levé une exception à l\'écriture');
      assert.deepStrictEqual(echecsRelecture, [], 'ces sorties n\'ont pas pu être relues par pronto-lire.py');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ===================================================================================
// §5.4 du contrat (ajouté le 18.09.2026, décidé avec Robin après mesure) — les listes SONT
// reportées, mais PAR CORRESPONDANCE : puce du manuscrit -> définition à puces de la sortie,
// numérotée -> définition numérotée, `ilvl` conservé, le `numId` d'origine ne traverse
// JAMAIS. La mesure qui tranche : le writer Markdown de pandoc peut embellir sa sortie textuelle,
// l'AST natif (`pandoc -f docx -t native`) ne ment pas — c'est lui que ces contrôles lisent,
// jamais un texte reformaté.

// ---------------------------------------------------------------------------------
// Contrôle n°1 — une liste à puces de trois éléments ressort en liste dans le .docx produit,
// ET pandoc -f docx -t native en rend un BulletList de trois éléments.
//
// Sabotage minimal : dans _RegistreListes.numid_pour(), échanger les deux `constructeur`
// (poser _niveau_numero_xml pour 'puce' et _niveau_puce_xml pour 'numero') — une liste à
// puces reçoit alors la définition numérotée : pandoc rend OrderedList au lieu de BulletList.

test('manuscrit_gabarit.ecrire : une liste à puces de trois éléments ressort en BulletList (pandoc natif)',
  { skip: sansPython }, (t) => {
    if (sansPandocWsl) { t.skip(sansPandocWsl); return; }
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragrapheListe('Premier élément', 7, 0, 'puce'),
        paragrapheListe('Second élément', 7, 0, 'puce'),
        paragrapheListe('Troisième élément', 7, 0, 'puce'),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const natif = pandocNatifSurWsl(sortie);
      const iBullet = natif.indexOf('BulletList');
      assert.ok(iBullet !== -1, 'aucun BulletList trouvé dans l\'AST natif : ' + natif.slice(0, 500));
      // Ce document synthétique ne porte RIEN après la liste (voir specDocument ci-dessus) :
      // compter chaque élément « [ Para » du BulletList jusqu'à la fin du flux est donc sûr,
      // sans avoir à faire correspondre les crochets de fermeture imbriqués de pandoc.
      const nItems = (natif.slice(iBullet).match(/\[ Para/g) || []).length;
      assert.strictEqual(nItems, 3, 'le BulletList doit porter exactement 3 éléments');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°2 — une liste numérotée ressort en OrderedList.
//
// Même sabotage que le contrôle n°1 (l'échange est symétrique) : une liste numérotée reçoit
// alors la définition à puces, pandoc rend BulletList au lieu d'OrderedList.

test('manuscrit_gabarit.ecrire : une liste numérotée ressort en OrderedList (pandoc natif)',
  { skip: sansPython }, (t) => {
    if (sansPandocWsl) { t.skip(sansPandocWsl); return; }
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragrapheListe('Premier point', 9, 0, 'numero'),
        paragrapheListe('Second point', 9, 0, 'numero'),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const natif = pandocNatifSurWsl(sortie);
      assert.ok(/OrderedList/.test(natif),
        'aucun OrderedList trouvé dans l\'AST natif : ' + natif.slice(0, 500));
      assert.ok(!/BulletList/.test(natif),
        'une liste numérotée ne doit produire aucun BulletList');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°3 — le niveau ilvl d'une liste imbriquée est conservé : un second élément d'une
// liste numérotée qui porte lui-même un sous-élément à puces (ilvl=1) doit ressortir avec ce
// sous-élément NESTÉ dans l'AST — jamais à plat au même niveau que la liste parente.
//
// Sabotage minimal : dans _numpr_xml(), forcer `ilvl = 0` inconditionnellement — le sous-
// élément perd son niveau 1, il ressort à plat comme un troisième élément numéroté au lieu
// d'un BulletList imbriqué dans le second.

test('manuscrit_gabarit.ecrire : le niveau ilvl d\'une liste imbriquée est conservé (pandoc natif)',
  { skip: sansPython }, (t) => {
    if (sansPandocWsl) { t.skip(sansPandocWsl); return; }
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragrapheListe('Point principal un', 9, 0, 'numero'),
        paragrapheListe('Point principal deux', 9, 0, 'numero'),
        paragrapheListe('Sous-point imbriqué', 7, 1, 'puce'),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const natif = pandocNatifSurWsl(sortie);
      const iOrdered = natif.indexOf('OrderedList');
      const iBullet = natif.indexOf('BulletList');
      assert.ok(iOrdered !== -1 && iBullet !== -1, 'OrderedList et BulletList attendus tous deux');
      assert.ok(iBullet > iOrdered, 'le BulletList doit apparaître APRÈS le début de l\'OrderedList');
      // Le sous-point imbriqué doit se trouver DANS le bloc de l'OrderedList (nesté dans son
      // second élément), jamais après sa fermeture au même niveau que la liste parente — trouvé
      // par comptage de profondeur des crochets, PAS par un indexOf('\n]') naïf : un premier
      // jet de ce test (18.09.2026) cherchait le premier « \n] » après OrderedList, qui tombe
      // en réalité sur la fermeture d'un Str imbriqué bien AVANT la vraie fin de la liste — ce
      // qui rendait le contrôle vert même avec le sabotage (ilvl forcé à 0) qui aplatit
      // complètement la liste. Mesuré par sabotage réel, pas supposé.
      const debutTableau = natif.indexOf('[', iOrdered);
      let profondeur = 0;
      let finOrdered = -1;
      for (let i = debutTableau; i < natif.length; i++) {
        if (natif[i] === '[') { profondeur++; }
        else if (natif[i] === ']') {
          profondeur--;
          if (profondeur === 0) { finOrdered = i; break; }
        }
      }
      assert.ok(finOrdered !== -1, 'fermeture du tableau de l\'OrderedList introuvable');
      assert.ok(iBullet < finOrdered,
        'le BulletList doit être imbriqué DANS l\'OrderedList, pas un troisième élément à plat '
        + '(trouvé à ' + iBullet + ', fermeture de l\'OrderedList à ' + finOrdered + ')');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°4 — le numId du manuscrit ne se retrouve NULLE PART dans la sortie (§5.4,
// garde-fou explicite : « ne se recopie JAMAIS »). C'est le contrôle qui garde la règle la
// plus facile à enfreindre par commodité (recopier serait plus simple que corresponder).
//
// Sabotage minimal : dans _numpr_xml(), utiliser `liste[0]` (le numId d'origine) au lieu de
// `registre.listes.numid_pour(...)` — le numId du manuscrit (ici 424242, choisi improbable)
// apparaît alors littéralement dans w:numId du document produit.

test('manuscrit_gabarit.ecrire : le numId du manuscrit ne se retrouve nulle part dans la sortie',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragrapheListe('Un élément', 424242, 0, 'puce'),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const xml = lireDocumentXml(sortie);
      assert.ok(!/w:numId\s+w:val="424242"/.test(xml),
        'le numId d\'origine (424242) ne doit JAMAIS apparaître dans le document produit');
      assert.ok(/<w:numPr>/.test(xml), 'un w:numPr doit malgré tout avoir été posé (avec un '
        + 'AUTRE numId, résolu par correspondance)');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°5 — écrire à partir du gabarit livré (qui ne définit AUCUNE liste de corps —
// mesuré : son seul num sert la numérotation de Titre1/2/3) produit quand même une liste
// valide, et la TRACE dit que la définition a été injectée — jamais en silence.
//
// Sabotage minimal : dans _RegistreListes.numid_pour(), forcer `self.trace.append(...)` à
// toujours écrire `'voie': 'gabarit'` — même quand la définition a bien été injectée, la
// trace prétendrait le contraire.

test('manuscrit_gabarit.ecrire : un gabarit sans définition de liste produit une liste valide, et la trace dit l\'injection',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragrapheListe('Un élément à puces', 7, 0, 'puce'),
      ]);
      const resultat = ecrireDepuisSpec(spec, sortie);
      const ligne = resultat.trace.find((l) => l.decision === 'liste_numerotation' && l.type === 'puce');
      assert.ok(ligne, 'une ligne de trace liste_numerotation (puce) est attendue');
      assert.strictEqual(ligne.voie, 'injectee',
        'le gabarit livré ne définit aucune liste de corps : la trace doit dire "injectee"');

      const xml = lireDocumentXml(sortie);
      assert.ok(/<w:numPr>/.test(xml), 'un w:numPr doit avoir été posé sur le paragraphe');
      const zipListe = cp.execFileSync(PYTHON, ['-c',
        'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); '
        + 'sys.stdout.write("oui" if "word/numbering.xml" in z.namelist() else "non")', sortie],
        { encoding: 'utf8', env: ENV_UTF8 });
      assert.strictEqual(zipListe, 'oui', 'word/numbering.xml doit exister dans la sortie');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°6 — les trois manuscrits réels qui portent des listes (3_, 3bis_, 4_) traversent
// la chaîne : ils s'écrivent sans exception, et leurs 20 paragraphes de liste (mesure figée
// aussi côté lecture, voir manuscrit-docx.test.js) ressortent tous en liste_reportee, avec un
// format DÉTERMINÉ par le lecteur (jamais le repli par défaut de l'écrivain — ces 20
// paragraphes n'en ont pas besoin, leur numbering.xml résout tout).
//
// Sabotage minimal : dans _convertir_niveau_racine(), remplacer
// `if format_lu in ('puce', 'numero'):` par `if False:` — les 20 paragraphes basculent tous
// en « format NON DÉTERMINÉ », alors que le lecteur les avait bel et bien résolus.

test('manuscrit_gabarit.ecrire : les trois manuscrits réels à listes (3_, 3bis_, 4_) traversent la chaîne, 20 paragraphes reportés, format toujours déterminé',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      t.skip('corpus tmp/corpus-relecture/lot-A absent (tmp/ est hors git, effacé sans prévenir)');
      return;
    }
    const nom4 = fs.readdirSync(CORPUS_LOT_A).find((n) => n.startsWith('4_'));
    assert.ok(nom4, 'le manuscrit "4_..." attendu dans lot-A est introuvable');
    const fichiers = ['3_VF_Chanier-Delorme_Article CSPS_290626.docx',
      '3bis_CSPS_Revue3_2026_FLOW_Piloting_OFP.docx', nom4];

    const base = dossierJetable();
    try {
      let total = 0;
      for (const nom of fichiers) {
        const entree = path.join(CORPUS_LOT_A, nom);
        const sortie = path.join(base, nom.replace(/\.docx$/i, '') + '-gabarit.docx');
        const r = python(['-c', ECRIRE_DEPUIS_DOCX, PIPELINE, entree, GABARIT_LIVRE, sortie]);
        assert.strictEqual(r.status, 0, 'écriture échouée sur ' + nom + ' : ' + r.stderr);
        const resultat = JSON.parse(r.stdout);
        const lignesListe = resultat.trace.filter((l) => l.decision === 'liste_reportee');
        assert.ok(lignesListe.length > 0, nom + ' devrait porter au moins une liste');
        for (const l of lignesListe) {
          assert.strictEqual(l.format_determine, true,
            nom + ' : une liste réelle de ce corpus doit avoir un format déterminé par le '
            + 'lecteur, jamais le repli par défaut — ligne : ' + JSON.stringify(l));
        }
        total += lignesListe.length;
      }
      assert.strictEqual(total, 20,
        'mesure figée le 18.09.2026 : 20 paragraphes de liste au total sur ces trois manuscrits');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
