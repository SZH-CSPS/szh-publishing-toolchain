// Tests de pipeline/manuscrit_gabarit.py, l'écrivain du nettoyeur de manuscrit (voir
// docs/ARCHITECTURE-nettoyeur-manuscrit.md). Contrôles principaux :
//   1. aller-retour : un document (corps, titres, une image, un tableau) écrit puis relu par
//      pronto-lire.py rend les champs attendus (légende, blocs reconnus) ;
//   2. aucun signe perdu : le texte du corps relu par manuscrit_docx.py est celui d'entrée,
//      caractère pour caractère ;
//   3. chaque image est dans un bloc figure, avec les mêmes octets qu'en entrée (sha256) ;
//   4. les métadonnées d'un bloc ne dépendent pas du nombre de colonnes du tableau ;
//   5. un paragraphe vide sépare toujours deux blocs qui se touchent (LibreOffice fond deux
//      <w:tbl> voisins) ;
//   6. l'italique survit à l'écriture ;
//   7. un document sans image ni tableau, le cas courant, produit un .docx valide et relisible.
// S'y ajoute le corpus tmp/corpus-relecture/lot-A/ : les onze manuscrits s'écrivent au gabarit
// et se relisent par pronto-lire.py (sauté sous un motif nommé si tmp/ est absent).
//
// manuscrit_gabarit.py est une bibliothèque sans CLI (ecrire(document, chemin_gabarit,
// chemin_sortie, decisions)) : un programme Python écrit à la volée l'importe et appelle
// ecrire(). Le résultat est relu par les deux lecteurs de production : manuscrit_docx.py et
// pipeline/pronto-lire.py.
//
// Les commentaires « Sabotage » indiquent la modification du module qui doit faire rougir
// le test.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
// Plusieurs centaines d'appels Python : un seul processus WSL pour tout le fichier.
const { pythonGroupe: python, pythonGroupeSortie: pythonSortie, sansPython, sansPandocWsl, sauter } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');
const MANUSCRIT_DOCX = path.join(PIPELINE, 'manuscrit_docx.py');
const PRONTO_LIRE = path.join(PIPELINE, 'pronto-lire.py');
// Deux gabarits, FR et DE. Leurs styleId sont allemands des deux côtés (berschrift1/2/3/4,
// Textkrper, Zitat : enregistrés par un Word allemand) ; les w:name restent 'heading N',
// 'Body Text', 'Quote'. GABARIT_LIVRE est le gabarit FR.
const GABARIT_LIVRE = path.join(RACINE, "revue-template", "Pronto - modele d'article_FR.docx");
const GABARIT_DE = path.join(RACINE, "revue-template", "Pronto - modele d'article_DE.docx");
const CORPUS_LOT_A = path.join(RACINE, 'tmp', 'corpus-relecture', 'lot-A');

// PYTHONIOENCODING=utf-8 : sans elle, Python écrit son stdout dans l'encodage de la console
// Windows (cp1252), alors que pronto-lire.py écrit du JSON en UTF-8 littéral
// (ensure_ascii=False). Un accent donne alors du mojibake ou un UnicodeEncodeError.
const ENV_UTF8 = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-manuscritgabarit-'));
}

// ---------------------------------------------------------------------------------
// Pilote manuscrit_gabarit.ecrire() depuis Node : construit un Document par
// manuscrit_modele.document_depuis_json() (schéma du mode --diagnostic) et appelle ecrire().
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
  const r = python(['-c', ECRIRE_DEPUIS_JSON, PIPELINE, cheminGabarit || GABARIT_LIVRE, cheminSortie, JSON.stringify(spec)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
  assert.strictEqual(r.status, 0, 'ecrire() a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

// Variante depuis un vrai .docx, pour le corpus lot-A : lit le manuscrit par
// manuscrit_docx.lire() puis l'écrit au gabarit.
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
  const r = python([MANUSCRIT_DOCX, mode, chemin], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
  assert.strictEqual(r.status, 0, mode + ' a échoué sur ' + chemin + ' : ' + r.stderr);
  return JSON.parse(r.stdout);
}

// `produit` pose $SZH_PRODUIT ('revue' ou 'zeitschrift'), qui décide la langue lue
// (pronto_modele.langue_du_produit()). Omis : produit inconnu, repli 'fr' avec l'avertissement
// 'langue-deduite'.
function prontoLire(chemin, slug, dossier, produit) {
  const env = produit ? Object.assign({}, ENV_UTF8, { SZH_PRODUIT: produit }) : ENV_UTF8;
  const r = python( [PRONTO_LIRE, chemin, slug, dossier],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  assert.strictEqual(r.status, 0, 'pronto-lire.py a échoué sur ' + chemin + ' : ' + r.stderr);
  return JSON.parse(r.stdout);
}

// Lit word/document.xml brut, pour les contrôles qui inspectent directement la structure.
const LIRE_DOCUMENT_XML = 'import sys, zipfile\n'
  + 'z = zipfile.ZipFile(sys.argv[1])\n'
  + 'sys.stdout.write(z.read("word/document.xml").decode("utf-8"))\n';

function lireDocumentXml(chemin) {
  return pythonSortie( ['-c', LIRE_DOCUMENT_XML, chemin],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
}

// ---------------------------------------------------------------------------------
// pandoc dans la WSL, pour les listes : le writer Markdown de pandoc peut embellir, l'AST
// natif est fidèle. Même distribution que gardes.js (SZH-Publishing). wsl.exe avale les
// barres inverses d'un argument de tableau : les chemins sont convertis avant l'appel (voir
// l'en-tête de pipeline/manuscrit_typo.py).
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

// Un paragraphe de liste. `liste` : [numId, ilvl, format], comme le rend manuscrit_docx.py.
// Le numId choisi ici (7, 8...) est arbitraire et ne doit pas se retrouver dans la sortie
// (contrôle n°4 des listes).
function paragrapheListe(texte, numid, ilvl, format) {
  return paragraphe([fragment(texte)], { liste: [numid, ilvl, format] });
}

// ---------------------------------------------------------------------------------
// Constructeurs de specs Document minimales (schéma document_depuis_json(), voir l'en-tête de
// manuscrit_modele.py), un par type de bloc.

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

function cellule(texte, extra) {
  return Object.assign({ colspan: 1, rowspan: 1, entete: false,
    blocs: [paragraphe([fragment(texte)])] }, extra || {});
}

function tableau(rangees, extra) {
  return Object.assign({ type: 'tableau', page: null, rangees }, extra || {});
}

function specDocument(blocs, notes) {
  return { styles: [], langue: 'fr', revisions: 0, commentaires: 0, notes: notes || {}, blocs };
}

// ---------------------------------------------------------------------------------
// Lit les enfants directs du corps (<w:p>, <w:tbl>, <w:sectPr>), dans l'ordre, en comptant la
// profondeur des balises : un bloc contient lui-même un <w:tbl> imbriqué, et un
// indexOf('</w:tbl>') s'arrêterait sur le mauvais. Sert à la table de correspondance et au
// contrôle « au plus un paragraphe vide entre deux blocs ».
const ENFANTS_CORPS_PY = [
  'import sys, zipfile, re, json',
  'z = zipfile.ZipFile(sys.argv[1])',
  'doc = z.read("word/document.xml").decode("utf-8")',
  'i_body = doc.index("<w:body>")',
  'i_fin = doc.rindex("</w:body>")',
  'interieur = doc[i_body + len("<w:body>"):i_fin]',
  'def enfants(xml):',
  '    i, n = 0, len(xml)',
  '    resultat = []',
  '    depart_tag = re.compile(r"<(w:p|w:tbl|w:sectPr)\\b")',
  '    while i < n:',
  '        m = depart_tag.search(xml, i)',
  '        if not m:',
  '            break',
  '        tag, debut = m.group(1), m.start()',
  '        fin_ouvrante = xml.index(">", debut)',
  '        if xml[fin_ouvrante - 1] == "/":',
  '            resultat.append((tag, xml[debut:fin_ouvrante + 1]))',
  '            i = fin_ouvrante + 1',
  '            continue',
  '        profondeur = 1',
  '        j = fin_ouvrante + 1',
  '        motif = re.compile(r"<" + tag + r"\\b[^>]*?(/?)>|</" + tag + ">")',
  '        while profondeur > 0:',
  '            mm = motif.search(xml, j)',
  '            if not mm:',
  '                raise ValueError("balise non fermee : " + tag)',
  '            if mm.group(0).startswith("</"):',
  '                profondeur -= 1',
  '            elif mm.group(1) != "/":',
  '                profondeur += 1',
  '            j = mm.end()',
  '        resultat.append((tag, xml[debut:j]))',
  '        i = j',
  '    return resultat',
  'def deseChapper(t):',
  '    return (t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")',
  '            .replace("&quot;", chr(34)).replace("&apos;", chr(39)))',
  'def style_de(xml):',
  '    m = re.search(r"<w:pStyle\\s+w:val=\\"([^\\"]*)\\"", xml)',
  '    return m.group(1) if m else None',
  'sortie = []',
  'for tag, xml in enfants(interieur):',
  '    texte = (deseChapper("".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", xml, re.S)))',
  '             if tag == "w:p" else None)',
  '    sortie.append({"tag": tag, "texte": texte,',
  '                    "style": style_de(xml) if tag == "w:p" else None})',
  'print(json.dumps(sortie, ensure_ascii=False))',
].join('\n');

function enfantsCorps(chemin) {
  const r = python(['-c', ENFANTS_CORPS_PY, chemin], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
  assert.strictEqual(r.status, 0, 'lecture des enfants du corps a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

function textesWp(enfants) {
  return enfants.filter((e) => e.tag === 'w:p').map((e) => e.texte);
}

function stylesWp(enfants) {
  return enfants.filter((e) => e.tag === 'w:p').map((e) => e.style);
}

// Sépare les entrées `correspondance` normales des entrées `bloc` (ancrage de
// A11y.TexteAlternatif.* sur la clé « Texte alternatif : » d'un bloc). Les tests texte à
// texte ne portent que sur les premières : le paragraphe-clé ne porte pas le texte de `source`.
function separerCorrespondance(correspondance) {
  const normales = correspondance.filter((c) => !c.bloc);
  const blocs = correspondance.filter((c) => c.bloc);
  return { normales, blocs };
}

// ---------------------------------------------------------------------------------
// Validation XML : chaque partie .xml/.rels de l'archive doit être bien formée
// (ET.fromstring ; pronto-lire.py rend 0 même sur un XML illisible), plus quelques contrôles
// structurels ciblés.
const VALIDER_PARTIES_XML_PY = [
  'import sys, zipfile, json',
  'import xml.etree.ElementTree as ET',
  'z = zipfile.ZipFile(sys.argv[1])',
  'erreurs = []',
  'for nom in z.namelist():',
  '    if nom.endswith(".xml") or nom.endswith(".rels"):',
  '        try:',
  '            ET.fromstring(z.read(nom))',
  '        except Exception as e:',
  '            erreurs.append(nom + " : " + str(e))',
  'print(json.dumps(erreurs))',
].join('\n');

function validerPartiesXml(chemin) {
  const r = python(['-c', VALIDER_PARTIES_XML_PY, chemin], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
  assert.strictEqual(r.status, 0, 'validation XML a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

const VALIDER_STRUCTURE_PY = [
  'import sys, zipfile, json, re',
  'chemin = sys.argv[1]',
  'z = zipfile.ZipFile(chemin)',
  'noms = z.namelist()',
  'erreurs = []',
  'doc = z.read("word/document.xml").decode("utf-8")',
  'if not re.search(r"<w:sectPr\\b[^>]*>.*?</w:sectPr>\\s*</w:body>", doc, re.S) '
  + 'and not re.search(r"<w:sectPr\\b[^>]*/>\\s*</w:body>", doc):',
  '    erreurs.append("sectPr absent ou pas en tout dernier enfant du corps")',
  'def rels_ids(nom):',
  '    if nom not in noms:',
  '        return set()',
  '    return set(re.findall(r\'<Relationship\\s+Id="([^"]+)"\', z.read(nom).decode("utf-8")))',
  'def rels_externes_sans_targetmode(nom):',
  '    if nom not in noms:',
  '        return []',
  '    xml = z.read(nom).decode("utf-8")',
  '    return [m.group(0) for m in re.finditer(r\'<Relationship\\b[^>]*Type="[^"]*hyperlink"[^>]*/>\', xml)'
  + ' if \'TargetMode="External"\' not in m.group(0)]',
  'rid_doc = rels_ids("word/_rels/document.xml.rels")',
  'rid_notes = rels_ids("word/_rels/footnotes.xml.rels")',
  'for nom_partie, rids in (("word/document.xml", rid_doc), ("word/footnotes.xml", rid_notes)):',
  '    if nom_partie not in noms:',
  '        continue',
  '    xml = z.read(nom_partie).decode("utf-8")',
  '    for m in re.finditer(r\'r:(?:embed|id)="([^"]+)"\', xml):',
  '        if m.group(1) not in rids:',
  '            erreurs.append(nom_partie + " : r:id/r:embed " + m.group(1) + " non résolu")',
  'erreurs += ["hyperlien externe (document) sans TargetMode : " + m'
  + ' for m in rels_externes_sans_targetmode("word/_rels/document.xml.rels")]',
  'erreurs += ["hyperlien externe (note) sans TargetMode : " + m'
  + ' for m in rels_externes_sans_targetmode("word/_rels/footnotes.xml.rels")]',
  'ct = z.read("[Content_Types].xml").decode("utf-8")',
  'extensions_ct = {e.lower() for e in re.findall(r\'Extension="([^"]+)"\', ct)}',
  'for nom in noms:',
  '    if nom.startswith("word/media/"):',
  '        ext = nom.rsplit(".", 1)[-1].lower()',
  '        if ext not in extensions_ct:',
  '            erreurs.append("media " + nom + " : extension " + ext + " non déclarée")',
  'print(json.dumps(erreurs, ensure_ascii=False))',
].join('\n');

function validerStructure(chemin) {
  const r = python(['-c', VALIDER_STRUCTURE_PY, chemin], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
  assert.strictEqual(r.status, 0, 'validation de structure a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

function paragraphesTextuels(document) {
  const textes = [];
  function creuser(blocs) {
    for (const b of blocs || []) {
      if (b.type === 'tableau') {
        for (const rangee of b.rangees) { for (const c of rangee) { creuser(c.blocs); } }
      } else {
        const t = (b.fragments || []).map((f) => f.texte).join('').trim();
        if (t) { textes.push(t); }
      }
    }
  }
  creuser(document.blocs);
  for (const id of Object.keys(document.notes || {})) { creuser(document.notes[id]); }
  return textes;
}

function normaliserEspaces(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------
// Contrôle n°1 : aller-retour complet (image, tableau, légende déjà écrite dans le
// manuscrit), relu par pronto-lire.py.
//
// Sabotage : dans _rangee_meta_xml(), renommer l'étiquette 'Légende' en 'Description', un mot
// hors du lexique LABELS_FIGURE de pronto_modele.py. Retirer seulement l'accent ne suffit
// pas : la comparaison passe par aplatir(), insensible aux accents et à la casse.

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
// Contrôle n°2 : le texte du corps, relu par manuscrit_docx.py, est caractère pour caractère
// celui d'entrée.
//
// Sabotage : dans _run_xml(), écrire `fragment.texte[:-1]`.

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
// Contrôle n°3 : chaque image est dans un bloc figure, avec les mêmes octets (sha256).
//
// Sabotage : dans _Registre.enregistrer_image(), écrire `image.nom.encode()` au lieu de
// `image.octets` ; le fichier existe mais son sha256 diffère.

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
// Contrôle n°4 : les métadonnées d'un bloc sont exactement cinq paragraphes SZH Cle Abb/Tab,
// non répétés par colonne du tableau de contenu (ici 3 colonnes), et ils précèdent
// directement ce tableau, sans <w:tbl> enveloppe.
//
// Sabotage : dans _meta_paragraphes_xml(), répéter la boucle `for cle, label in CHAMPS_BLOC`
// pour chaque rangée du tableau de contenu ; cinq paragraphes deviennent dix.

test('manuscrit_gabarit.ecrire : les métadonnées d\'un bloc sont cinq paragraphes SZH Cle Abb/Tab, jamais un par colonne ni par rangée',
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

      // Après les deux tableaux fixes du gabarit (métadonnées de l'article, autrices et
      // auteurs), les cinq paragraphes de clé du bloc suivent directement.
      const finTable1 = xml.indexOf('</w:tbl>') + '</w:tbl>'.length;
      const finTable2 = xml.indexOf('</w:tbl>', finTable1) + '</w:tbl>'.length;
      const reste = xml.slice(finTable2);

      const nbCles = (reste.match(/<w:pStyle w:val="SZHCleAbbTab"\/>/g) || []).length;
      assert.strictEqual(nbCles, 5,
        'un bloc doit toujours porter EXACTEMENT cinq paragraphes de clé, jamais un par '
        + 'colonne ou par rangée du tableau de contenu (obtenu : ' + nbCles + ')');

      // Le tableau de contenu (3 colonnes, selon son tblGrid) suit directement les paragraphes
      // de clé, sans <w:tbl> enveloppe.
      const debutContenu = reste.indexOf('<w:tbl');
      assert.ok(debutContenu > 0, 'le tableau de contenu doit suivre les paragraphes de clé');
      const finContenu = reste.indexOf('</w:tbl>', debutContenu) + '</w:tbl>'.length;
      const tableauContenu = reste.slice(debutContenu, finContenu);
      const nbColonnes = (tableauContenu.match(/<w:gridCol\b/g) || []).length;
      assert.strictEqual(nbColonnes, 3,
        'le tableau de contenu doit garder ses 3 colonnes, non touché par les métadonnées');
      assert.strictEqual((tableauContenu.match(/SZHCleAbbTab/g) || []).length, 0,
        'aucun paragraphe de clé ne doit se retrouver DANS le tableau de contenu lui-même');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°5 : un paragraphe vide sépare deux blocs qui se touchent, pour qu'ils restent
// visiblement séparés. Un bloc figure n'écrit que des <w:p>, mais la règle vaut pour tous.
//
// Sabotage : dans _separateur_requis(), remplacer
// `return est_bloc_courant or est_bloc_precedent` par `return False`.

// Deux paragraphes d'images à la suite forment un seul groupe d'images (voir le test « deux
// paragraphes d'images à la suite ») : les deux blocs qui se touchent sont ici une figure
// puis un tableau.
test('manuscrit_gabarit.ecrire : un paragraphe vide sépare deux blocs qui se touchent (figure puis tableau)',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const octets1 = Buffer.from('IMAGE-UN-0123456789');
      const spec = specDocument([
        paragraphe([fragment('', {}, { image: image('un.png', octets1.toString('base64')) })]),
        tableau([[cellule('A1'), cellule('B1')]]),
      ]);
      ecrireDepuisSpec(spec, sortie);

      const textes = textesWp(enfantsCorps(sortie));
      const indicesLegende = [];
      textes.forEach((t, i) => { if (t === 'Légende : ') { indicesLegende.push(i); } });
      assert.strictEqual(indicesLegende.length, 2,
        'deux blocs (deux groupes de cinq clés) attendus : ' + JSON.stringify(textes));
      const [i1, i2] = indicesLegende;
      // Entre les deux « Légende : » : les quatre autres clés du premier bloc, son image, puis
      // le séparateur, soit 7 <w:p>. Un écart de 6 trahirait un séparateur manquant.
      assert.strictEqual(i2 - i1, 7,
        'il doit y avoir exactement un paragraphe vide entre l\'image du premier bloc et les '
        + 'clés du second (7 <w:p> d\'écart attendus, obtenu ' + (i2 - i1) + ') : '
        + JSON.stringify(textes.slice(i1, i2 + 1)));
      assert.strictEqual(textes[i2 - 1], '',
        'le <w:p> juste avant le second bloc doit être le séparateur vide');
      assert.strictEqual(textes[i2 - 2], '',
        'le <w:p> juste avant le séparateur doit être l\'image du premier bloc (texte vide)');

      // Un seul <w:tbl> de plus que les deux tableaux fixes : celui du bloc tableau. Le bloc
      // figure n'en écrit pas.
      const xml = lireDocumentXml(sortie);
      assert.strictEqual((xml.match(/<w:tbl\b/g) || []).length, 3,
        'les deux tableaux FIXES du gabarit et le tableau du bloc, rien d\'autre : un '
        + 'bloc figure n\'écrit plus de <w:tbl>');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Même règle pour deux blocs tableau, où deux <w:tbl> pourraient se toucher : un paragraphe
// vide sépare deux tableaux de contenu consécutifs.
test('manuscrit_gabarit.ecrire : un paragraphe vide sépare deux blocs tableau qui se touchent, et leurs deux <w:tbl> de contenu ne se touchent jamais',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        tableau([[cellule('A1')]]),
        tableau([[cellule('B1')]]),
      ]);
      ecrireDepuisSpec(spec, sortie);

      const xml = lireDocumentXml(sortie);
      assert.ok(!/<\/w:tbl>\s*<w:tbl\b/.test(xml),
        'deux tableaux de contenu ne doivent jamais se toucher directement dans le XML — sans '
        + 'paragraphe entre eux, LibreOffice les fond en un seul (§10)');

      const textes = textesWp(enfantsCorps(sortie));
      const indicesLegende = [];
      textes.forEach((t, i) => { if (t === 'Légende : ') { indicesLegende.push(i); } });
      assert.strictEqual(indicesLegende.length, 2);
      const [i1, i2] = indicesLegende;
      // Entre les deux « Légende : » : les quatre autres clés puis le séparateur. Le tableau de
      // contenu n'est pas un <w:p>, d'où un écart de 6.
      assert.strictEqual(i2 - i1, 6,
        'écart inattendu entre les deux groupes de clés (6 <w:p> d\'écart attendus — 4 autres '
        + 'clés puis le séparateur) : ' + JSON.stringify(textes.slice(i1, i2 + 1)));
      assert.strictEqual(textes[i2 - 1], '',
        'le <w:p> juste avant le second bloc doit être le paragraphe séparateur vide');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°6 : l'italique survit à l'écriture (il porte du sens).
//
// Sabotage : dans _rpr_xml(), retirer la clause `if forme.get('italique')` ; forme.italique
// vaut null au lieu de true après relecture.

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
      // Le gabarit pose ses deux tableaux fixes et des paragraphes vides avant le corps (voir
      // l'en-tête de manuscrit_gabarit.py) : on cherche le premier paragraphe au texte non
      // vide, comme au contrôle n°2.
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
// Le corps porte le style « Corps de texte » du gabarit (pas « Normal » ni l'absence de
// w:pStyle), et un titre de niveau 1/2/3 le style correspondant. Les autres contrôles relisent
// le texte, pas le style ; or la maquette est accrochée au style.
//
// Le style se lit dans `Paragraphe.style` du JSON --diagnostic de manuscrit_docx.py : le nom
// humain résolu depuis le styles.xml du gabarit (« body text », « heading 1/2/3 », « normal »,
// '' sans w:pStyle). Ces noms ne dépendent pas du styleId réel (Textkrper…) : le contrôle vaut
// pour tout gabarit.
//
// Sabotages :
//   - dans _StylesResolus, résoudre le corps sur le repli 'Normal' : le corps ressort en
//     'normal' au lieu de 'body text' ;
//   - dans _StylesResolus.__init__, décaler `self.titre` d'un cran : le titre de niveau 1
//     ressort en 'heading 2'.

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

// Une citation du manuscrit sort en citation (style « Quote » du gabarit, que pandoc relit en
// bloc de citation), dans les deux gabarits, quel que soit le nom qu'elle portait.
test('manuscrit_gabarit.ecrire : une citation (Quote, Citation, Zitat) sort en citation, FR et DE',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      for (const gabarit of [GABARIT_LIVRE, GABARIT_DE]) {
        const sortie = path.join(base, 'sortie.docx');
        const spec = specDocument([
          paragraphe([fragment('Une citation anglaise.')], { style: 'Quote' }),
          paragraphe([fragment('Une citation française.')], { style: 'Citation' }),
          paragraphe([fragment('Ein Zitat.')], { style: 'Zitat' }),
          paragraphe([fragment('Du corps.')]),
        ]);
        ecrireDepuisSpec(spec, sortie, gabarit);
        const { document } = diagnostiquerManuscritDocx('--diagnostic', sortie);
        const style = (texte) => document.blocs.find((b) => b.type !== 'tableau'
          && b.fragments.some((f) => f.texte === texte)).style;
        for (const texte of ['Une citation anglaise.', 'Une citation française.', 'Ein Zitat.']) {
          assert.strictEqual(style(texte), 'quote', texte + ' (' + path.basename(gabarit) + ')');
        }
        assert.strictEqual(style('Du corps.'), 'body text');
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°7 : un document sans image ni tableau produit un .docx valide et relisible par
// les deux lecteurs de production, avec ses niveaux de titre.
//
// Sabotage : retirer l'entrée `1: 'Titre1'` de STYLE_TITRE ; le titre sort en corps et
// niveau_declare vaut 0 après relecture.

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

      // Lecteur n°1 : manuscrit_docx.py.
      const { document } = diagnostiquerManuscritDocx('--diagnostic', sortie);
      const titre = document.blocs.find((b) => b.type !== 'tableau' && b.niveau_declare > 0);
      assert.ok(titre, 'le titre doit être retrouvé à la relecture');
      assert.strictEqual(titre.niveau_declare, 1,
        'un titre de niveau 1 doit rester de niveau 1 après le passage dans l\'écrivain');
      assert.strictEqual(titre.fragments.map((f) => f.texte).join(''), 'Titre de niveau 1');

      // Lecteur n°2 : pronto-lire.py, le lecteur de production. Il ne plante pas et ne
      // signale aucun bloc mal formé.
      const dossierPronto = path.join(base, 'article');
      fs.mkdirSync(dossierPronto);
      const stats = prontoLire(sortie, 'essai', dossierPronto);
      assert.deepStrictEqual(stats.blocs, []);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Les onze manuscrits du corpus s'écrivent au gabarit et se relisent par pronto-lire.py.
// tmp/ est hors git et peut être effacé : le test est alors sauté sous un motif nommé.

test('manuscrit_gabarit.ecrire : les onze manuscrits réels de lot-A s\'écrivent au gabarit et se relisent tous',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
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
        const r = python(['-c', ECRIRE_DEPUIS_DOCX, PIPELINE, entree, GABARIT_LIVRE, sortie], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
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
// Listes. Elles sont reportées par correspondance : puce du manuscrit -> définition à puces
// de la sortie, numérotée -> définition numérotée, `ilvl` conservé, `numId` d'origine jamais
// recopié. Les contrôles lisent l'AST natif de pandoc (`pandoc -f docx -t native`), fidèle,
// plutôt que sa sortie Markdown, qui peut embellir.

// ---------------------------------------------------------------------------------
// Contrôle n°1 : une liste à puces de trois éléments donne un BulletList de trois éléments.
//
// Sabotage : dans _RegistreListes.numid_pour(), échanger les deux `constructeur` ; pandoc
// rend OrderedList au lieu de BulletList.

test('manuscrit_gabarit.ecrire : une liste à puces de trois éléments ressort en BulletList (pandoc natif)',
  { skip: sansPython }, (t) => {
    if (sansPandocWsl) { sauter.wsl(t); return; }
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
      // Rien ne suit la liste dans ce document : compter les « [ Para » jusqu'à la fin du flux
      // suffit, sans apparier les crochets imbriqués de pandoc.
      const nItems = (natif.slice(iBullet).match(/\[ Para/g) || []).length;
      assert.strictEqual(nItems, 3, 'le BulletList doit porter exactement 3 éléments');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°2 : une liste numérotée donne un OrderedList. Même sabotage que le n°1.

test('manuscrit_gabarit.ecrire : une liste numérotée ressort en OrderedList (pandoc natif)',
  { skip: sansPython }, (t) => {
    if (sansPandocWsl) { sauter.wsl(t); return; }
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
// Contrôle n°3 : le niveau ilvl est conservé. Le second élément d'une liste numérotée porte un
// sous-élément à puces (ilvl=1), qui doit ressortir imbriqué dans l'AST.
//
// Sabotage : dans _numpr_xml(), forcer `ilvl = 0` ; le sous-élément sort à plat.

test('manuscrit_gabarit.ecrire : le niveau ilvl d\'une liste imbriquée est conservé (pandoc natif)',
  { skip: sansPython }, (t) => {
    if (sansPandocWsl) { sauter.wsl(t); return; }
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
      // Le sous-point doit se trouver dans le bloc de l'OrderedList. La fin de ce bloc se
      // trouve en comptant la profondeur des crochets : le premier « \n] » après OrderedList
      // ferme un Str imbriqué, bien avant la fin de la liste.
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
// Contrôle n°4 : le numId du manuscrit ne se retrouve pas dans la sortie.
//
// Sabotage : dans _numpr_xml(), utiliser `liste[0]` au lieu de
// `registre.listes.numid_pour(...)` ; 424242 apparaît dans w:numId.

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
// Contrôle n°5 : le gabarit livré ne définit aucune liste de corps (son seul num sert la
// numérotation de Titre1/2/3). L'écriture produit quand même une liste valide, et la trace
// dit que la définition a été injectée.
//
// Sabotage : dans _RegistreListes.numid_pour(), forcer `'voie': 'gabarit'` dans la trace.

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
      const zipListe = pythonSortie( ['-c',
        'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); '
        + 'sys.stdout.write("oui" if "word/numbering.xml" in z.namelist() else "non")', sortie],
        { encoding: 'utf8', env: ENV_UTF8 });
      assert.strictEqual(zipListe, 'oui', 'word/numbering.xml doit exister dans la sortie');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°6 : les trois manuscrits du corpus qui portent des listes (3_, 3bis_, 4_)
// s'écrivent sans exception, et leurs 20 paragraphes de liste (voir aussi
// manuscrit-docx.test.js) ressortent en liste_reportee, au format déterminé par le lecteur.
//
// Sabotage : dans _convertir_niveau_racine(), remplacer
// `if format_lu in ('puce', 'numero'):` par `if False:`.

test('manuscrit_gabarit.ecrire : les trois manuscrits réels à listes (3_, 3bis_, 4_) traversent la chaîne, 20 paragraphes reportés, format toujours déterminé',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
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
        const r = python(['-c', ECRIRE_DEPUIS_DOCX, PIPELINE, entree, GABARIT_LIVRE, sortie], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
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

// ===================================================================================
// Un contrôle par défaut d'écriture, chacun avec son sabotage.

// ---------------------------------------------------------------------------------
// Attributs XML : `descr="%s"` (texte alternatif) et `Target="%s"` (URL de lien) doivent
// échapper `"` et `&`, sinon Word refuse le fichier (alors que la sortie vaut 0). Chaque
// partie XML de la sortie doit être bien formée.
//
// Sabotage : dans _echapper_attribut, retirer `.replace('"', '&quot;')`.

test('manuscrit_gabarit.ecrire : un lien avec "&" et un texte alternatif avec des guillemets produisent un XML valide partout',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const octets = Buffer.from('IMAGE-AVEC-ALT-GUILLEMETS');
      const spec = specDocument([
        paragraphe([
          fragment('Voir la référence ', {}, { lien: 'https://doi.org/10.1000/x?q=a&r=b' }),
          fragment('ici', {}, { lien: 'https://doi.org/10.1000/x?q=a&r=b' }),
        ]),
        paragraphe([fragment('', {}, { image: image('capture.png', octets.toString('base64'),
          { alt: 'Schéma "A"' }) })]),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const erreurs = validerPartiesXml(sortie);
      assert.deepStrictEqual(erreurs, [], 'chaque partie XML doit être bien formée');

      const xml = lireDocumentXml(sortie);
      assert.ok(xml.includes('descr="Schéma &quot;A&quot;"'),
        'le guillemet du texte alternatif doit être échappé dans l\'attribut descr');
      const rels = pythonSortie( ['-c',
        'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); '
        + 'sys.stdout.write(z.read("word/_rels/document.xml.rels").decode("utf-8"))', sortie],
        { encoding: 'utf8', env: ENV_UTF8 });
      assert.ok(rels.includes('q=a&amp;r=b'),
        'le "&" du lien doit être échappé (&amp;) dans word/_rels/document.xml.rels');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Une puce en police Symbol s'écrit U+F0B7, comme Word le fait : Symbol n'a pas de glyphe
// pour U+2022.
//
// Sabotage : dans _niveau_puce_xml, remplacer `&#xF0B7;` par `•` (U+2022).

test('manuscrit_gabarit.ecrire : une définition de puce injectée porte le glyphe U+F0B7 (jamais U+2022) en police Symbol',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([paragrapheListe('Un élément à puces', 7, 0, 'puce')]);
      ecrireDepuisSpec(spec, sortie);
      const numbering = pythonSortie( ['-c',
        'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); '
        + 'sys.stdout.write(z.read("word/numbering.xml").decode("utf-8"))', sortie],
        { encoding: 'utf8', env: ENV_UTF8 });
      assert.ok(numbering.includes('w:lvlText w:val="&#xF0B7;"') || numbering.includes(''),
        'le glyphe de puce doit être U+F0B7 (celui que Symbol affiche), pas "•" (U+2022)');
      assert.ok(!numbering.includes('•'),
        'U+2022 ("•") ne doit jamais apparaître : Symbol ne l\'affiche pas (case vide)');
      assert.ok(/w:ascii="Symbol"/.test(numbering), 'la police Symbol doit être posée sur ce niveau');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Le rapport largeur/hauteur d'une image (cx/cy) est conservé.
//
// Sabotage : dans _extent_depuis_surface, retirer la clause `if image.cx and image.cy:` ;
// une image 6:1 ressort en 4:3.

test('manuscrit_gabarit.ecrire : le rapport largeur/hauteur d\'une image (cx/cy) est conservé, pas écrasé en 4:3',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const octets = Buffer.from('IMAGE-PANORAMIQUE');
      const spec = specDocument([
        paragraphe([fragment('', {}, { image: image('pano.png', octets.toString('base64'),
          { cx: 3000000, cy: 500000, surface: 1500000000000 }) })]),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const xml = lireDocumentXml(sortie);
      const m = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/);
      assert.ok(m, 'wp:extent introuvable');
      const ratio = Number(m[1]) / Number(m[2]);
      assert.ok(Math.abs(ratio - 6) < 0.05,
        'le ratio cx/cy (6:1) doit être conservé, obtenu ' + ratio + ' (4:3 = 1.33 serait le défaut)');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_gabarit.ecrire : à défaut de cx/cy, le rapport largeur_px/hauteur_px du fichier est utilisé',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const octets = Buffer.from('IMAGE-HAUTE');
      const spec = specDocument([
        paragraphe([fragment('', {}, { image: image('haute.png', octets.toString('base64'),
          { cx: 0, cy: 0, surface: 0, largeur_px: 200, hauteur_px: 800 }) })]),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const xml = lireDocumentXml(sortie);
      const m = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/);
      const ratio = Number(m[1]) / Number(m[2]);
      assert.ok(Math.abs(ratio - 0.25) < 0.02,
        'le ratio pixels (200/800 = 0.25) doit décider faute de cx/cy, obtenu ' + ratio);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_gabarit.ecrire : une image plus large que la page est plafonnée à la largeur utile du gabarit',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const octets = Buffer.from('IMAGE-ENORME');
      const spec = specDocument([
        paragraphe([fragment('', {}, { image: image('enorme.png', octets.toString('base64'),
          { cx: 50000000, cy: 10000000 }) })]),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const xml = lireDocumentXml(sortie);
      const m = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/);
      const cx = Number(m[1]);
      // Largeur A4 (~11906 dxa) moins les marges reste bien sous 50 000 000 EMU : seul le
      // plafond compte ici.
      assert.ok(cx < 50000000, 'l\'image ne doit plus dépasser la largeur utile de la page, obtenu cx=' + cx);
      const ratio = cx / Number(m[2]);
      assert.ok(Math.abs(ratio - 5) < 0.1, 'le rapport (5:1) doit survivre au plafonnage, obtenu ' + ratio);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Une rangée plus large que la première ne perd aucune cellule.
//
// Sabotage : dans _grille_ecriture, remplacer le calcul du max par
// `ncols = sum(c.colspan for c in rangees[0]) or 1`.

test('manuscrit_gabarit.ecrire : une rangée plus large que la première ne perd aucune cellule',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        tableau([
          [cellule('A1'), cellule('B1')],
          [cellule('A2'), cellule('B2'), cellule('C2')],
        ]),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const { document } = diagnostiquerManuscritDocx('--diagnostic', sortie);
      // Les deux premiers <w:tbl> du corps sont les tableaux fixes du gabarit, que
      // document.blocs porte aussi. Le tableau du bloc est le premier <w:tbl> de premier
      // niveau qui suit les paragraphes de clé (« Légende : », etc.).
      const idxLegende = document.blocs.findIndex((b) => b.type !== 'tableau' && b.fragments
        && b.fragments.some((f) => f.texte === 'Légende : '));
      assert.ok(idxLegende >= 0, 'les quatre paragraphes de clé du bloc doivent être retrouvés');
      const tbl = document.blocs.slice(idxLegende).find((b) => b.type === 'tableau');
      assert.ok(tbl, 'le tableau du manuscrit (directement au premier niveau) doit être relu');
      assert.strictEqual(tbl.rangees[1].length, 3,
        'la seconde rangée (3 cellules) ne doit perdre aucune cellule');
      const c2Textes = tbl.rangees[1].map((c) => c.blocs.map((b) => b.fragments.map((f) => f.texte).join('')).join(''));
      assert.deepStrictEqual(c2Textes, ['A2', 'B2', 'C2']);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Fusion verticale et horizontale à la fois : une rangée de continuation porte un seul <w:tc>
// large de `colspan`, sinon le tblGrid est désynchronisé.
//
// Sabotage : dans _ligne_xml, cas 'continue', retirer `gridspan` du <w:tc> ; avec
// rowspan=2/colspan=2, la continuation compte 2 <w:tc> au lieu d'1.

const RANGEES_TABLEAU_IMBRIQUE_PY = [
  'import sys, zipfile, json, re',
  'def enfants_directs(xml, tags):',
  '    depart_tag = re.compile("<(" + "|".join(tags) + r")\\b")',
  '    i, n = 0, len(xml)',
  '    resultat = []',
  '    while i < n:',
  '        m = depart_tag.search(xml, i)',
  '        if not m:',
  '            break',
  '        tag, debut = m.group(1), m.start()',
  '        fin_ouvrante = xml.index(">", debut)',
  '        if xml[fin_ouvrante - 1] == "/":',
  '            resultat.append((tag, xml[debut:fin_ouvrante + 1]))',
  '            i = fin_ouvrante + 1',
  '            continue',
  '        profondeur = 1',
  '        j = fin_ouvrante + 1',
  '        motif = re.compile("<" + tag + r"\\b[^>]*?(/?)>|</" + tag + ">")',
  '        while profondeur > 0:',
  '            mm = motif.search(xml, j)',
  '            if not mm:',
  '                raise ValueError("balise non fermee : " + tag)',
  '            if mm.group(0).startswith("</"):',
  '                profondeur -= 1',
  '            elif mm.group(1) != "/":',
  '                profondeur += 1',
  '            j = mm.end()',
  '        resultat.append((tag, xml[debut:j]))',
  '        i = j',
  '    return resultat',
  'z = zipfile.ZipFile(sys.argv[1])',
  'doc = z.read("word/document.xml").decode("utf-8")',
  'interieur = doc[doc.index("<w:body>") + len("<w:body>"):doc.rindex("</w:body>")]',
  'tbls = [xml for tag, xml in enfants_directs(interieur, ["w:p", "w:tbl", "w:sectPr"]) if tag == "w:tbl"]',
  '# le DERNIER <w:tbl> de premier niveau est le tableau du MANUSCRIT lui-même — depuis le',
  '# 21.09.2026 (plus de tableau enveloppe), il n\'est plus imbriqué : les deux premiers <w:tbl>',
  '# sont les tableaux fixes du gabarit, le troisième est directement celui de ce test.',
  'tbl_manuscrit = tbls[-1]',
  'interieur_tbl = tbl_manuscrit[tbl_manuscrit.index(">") + 1:tbl_manuscrit.rindex("</w:tbl>")]',
  'lignes = [xml for tag, xml in enfants_directs(interieur_tbl, ["w:tr"])]',
  'print(json.dumps(lignes))',
].join('\n');

function rangeesTableauImbrique(chemin) {
  const r = python(['-c', RANGEES_TABLEAU_IMBRIQUE_PY, chemin], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
  assert.strictEqual(r.status, 0, 'lecture des rangées du tableau imbriqué a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

test('manuscrit_gabarit.ecrire : une fusion verticale ET horizontale à la fois garde son gridSpan sur la ligne de continuation',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        tableau([
          [cellule('Fusion', { colspan: 2, rowspan: 2 }), cellule('C1')],
          [cellule('C2')],
        ]),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const lignes = rangeesTableauImbrique(sortie);
      assert.strictEqual(lignes.length, 2, 'deux rangées attendues dans le tableau du manuscrit');
      const nCellulesContinuation = (lignes[1].match(/<w:tc>/g) || []).length;
      assert.strictEqual(nCellulesContinuation, 2,
        'la ligne de continuation doit porter DEUX <w:tc> (une continuation de largeur 2, '
        + 'plus C2), jamais trois');
      const continuation = lignes[1].match(/<w:tc>[\s\S]*?<w:vMerge\/>[\s\S]*?<\/w:tc>/);
      assert.ok(continuation, 'la cellule de continuation (vMerge sans "restart") doit exister');
      assert.ok(/<w:gridSpan w:val="2"\/>/.test(continuation[0]),
        'la cellule de continuation doit porter gridSpan=2, comme la cellule de départ');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Chaque wp:docPr a un id unique : Word répare en silence les doublons à l'ouverture.
//
// Sabotage : dans _Registre.nouveau_docpr_id, remplacer
// `self._docpr_id += 1; return self._docpr_id` par `return 0`.

test('manuscrit_gabarit.ecrire : chaque wp:docPr porte un identifiant unique',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragraphe([fragment('', {}, { image: image('un.png', Buffer.from('UN').toString('base64')) })]),
        paragraphe([fragment('', {}, { image: image('deux.png', Buffer.from('DEUX').toString('base64')) })]),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const xml = lireDocumentXml(sortie);
      const ids = [...xml.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]);
      assert.strictEqual(ids.length, 2, 'deux wp:docPr attendus');
      assert.notStrictEqual(ids[0], ids[1], 'les deux wp:docPr doivent avoir des identifiants DIFFÉRENTS');
      assert.ok(ids.every((id) => id !== '0'), 'aucun wp:docPr ne doit rester à "0"');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Une légende déjà écrite dans le manuscrit garde sa mise en forme (exposant) dans le champ
// « Légende : ».
//
// Sabotage : dans _rangee_meta_xml, remplacer la branche `isinstance(valeur, list)` par
// `''.join(f.texte for f in valeur)`.

test('manuscrit_gabarit.ecrire : une légende déjà écrite dans le manuscrit garde son exposant',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const octets = Buffer.from('IMAGE-AVEC-LEGENDE-EXPOSANT');
      const spec = specDocument([
        paragraphe([fragment('', {}, { image: image('fig.png', octets.toString('base64')) })]),
        paragraphe([fragment('Figure 1. Résultat au m'), fragment('2', { exposant: true }),
          fragment(' du test.')]),
      ]);
      const resultat = ecrireDepuisSpec(spec, sortie);
      assert.strictEqual(resultat.stats.blocs_figure, 1);
      const xml = lireDocumentXml(sortie);
      assert.ok(/<w:vertAlign w:val="superscript"\/>/.test(xml),
        'un vertAlign superscript doit survivre quelque part dans le document');
      // La légende n'est pas dupliquée en paragraphe de corps ordinaire, et son exposant est
      // retrouvé dans le bloc figure. Le champ « Légende : » est lui-même un paragraphe de
      // premier niveau (style SZH Cle Abb/Tab) qui porte ce texte : seul un paragraphe d'un
      // autre style serait une duplication.
      const { document } = diagnostiquerManuscritDocx('--diagnostic', sortie);
      const corpsOrdinaire = document.blocs.filter((b) => b.type !== 'tableau'
        && b.style !== 'szh cle abb/tab'
        && b.fragments.some((f) => f.texte.includes('Résultat au m')));
      assert.strictEqual(corpsOrdinaire.length, 0,
        'la légende ne doit pas rester EN PLUS comme paragraphe de corps ORDINAIRE');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Légende de tableau sur deux paragraphes (« Tableau 1 » en gras seul, puis le texte, puis le
// tableau) : les deux sont retirés du corps et la légende est associée au tableau.
//
// Sabotage : dans _cherche_legende, retirer le bloc « cas à deux paragraphes » ; aucun des
// deux paragraphes ne correspond seul à RE_LEGENDE.

test('manuscrit_gabarit.ecrire : une légende de tableau répartie sur deux paragraphes (titre gras + texte) est retrouvée',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragraphe([fragment('Un paragraphe de corps avant.')]),
        paragraphe([fragment('Tableau 1', { gras: true })]),
        paragraphe([fragment('Comparaison des résultats obtenus sur les deux groupes.')]),
        tableau([[cellule('A1'), cellule('B1')]]),
      ]);
      const resultat = ecrireDepuisSpec(spec, sortie);
      assert.strictEqual(resultat.stats.blocs_tableau, 1);

      const dossierPronto = path.join(base, 'article');
      fs.mkdirSync(dossierPronto);
      const stats = prontoLire(sortie, 'essai', dossierPronto);
      const blocTableau = stats.blocs.find((b) => b.nature === 'table');
      assert.ok(blocTableau, 'le bloc tableau doit être reconnu');
      assert.ok(blocTableau.legende && blocTableau.legende.includes('Tableau 1')
        && blocTableau.legende.includes('Comparaison des résultats'),
        'la légende doit réunir le titre ET le texte : obtenu ' + JSON.stringify(blocTableau.legende));

      // Le paragraphe « Légende : » du bloc (SZH Cle Abb/Tab) porte ce texte ; seul un
      // paragraphe de corps qui le répéterait serait une duplication.
      const { document } = diagnostiquerManuscritDocx('--diagnostic', sortie);
      const resteTitre = document.blocs.some((b) => b.type !== 'tableau'
        && b.style !== 'szh cle abb/tab' && b.fragments.some((f) => f.texte === 'Tableau 1'));
      const resteTexte = document.blocs.some((b) => b.type !== 'tableau'
        && b.style !== 'szh cle abb/tab'
        && b.fragments.some((f) => f.texte.includes('Comparaison des résultats')));
      assert.strictEqual(resteTitre, false, 'le titre « Tableau 1 » ne doit plus rester dans le corps');
      assert.strictEqual(resteTexte, false, 'le texte de la légende ne doit plus rester dans le corps');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Légende allemande séparée de son image par un paragraphe vide (« Abbildung 1:
// Schatzkarte… », ¶ vide, image). Avec deux figures légendées au-dessus, sauter les vides
// rend « Abbildung 2 » atteignable depuis la première image aussi : c'est la convention du
// document qui tranche, et chaque légende revient à sa figure.

test('manuscrit_gabarit.ecrire : légende séparée de son image par un paragraphe vide, convention « au-dessus »',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const b64 = Buffer.from('IMAGE-LEGENDE-VIDE').toString('base64');
      const spec = specDocument([
        paragraphe([fragment('Ein Absatz davor.')]),
        paragraphe([fragment('Abbildung 1: Schatzkarte der Entwicklungskapazitäten', { italique: true })]),
        paragraphe([fragment('')]),
        paragraphe([fragment('', {}, { image: image('fig1.png', b64) })]),
        paragraphe([fragment('')]),
        paragraphe([fragment('Abbildung 2: Zweite Karte', { italique: true })]),
        paragraphe([fragment('')]),
        paragraphe([fragment('', {}, { image: image('fig2.png', b64) })]),
        paragraphe([fragment('Konkrete Anwendung in der Praxis')]),
      ]);
      const resultat = ecrireDepuisSpec(spec, sortie);
      assert.strictEqual(resultat.stats.blocs_figure, 2);

      const dossierPronto = path.join(base, 'article');
      fs.mkdirSync(dossierPronto);
      const stats = prontoLire(sortie, 'essai', dossierPronto);
      const figures = stats.blocs.filter((b) => b.nature !== 'table');
      assert.strictEqual(figures.length, 2, JSON.stringify(stats.blocs));
      assert.ok((figures[0].legende || '').includes('Schatzkarte'),
        'figure 1 : ' + JSON.stringify(figures[0].legende));
      assert.ok((figures[1].legende || '').includes('Zweite Karte'),
        'figure 2 : ' + JSON.stringify(figures[1].legende));

      const { document } = diagnostiquerManuscritDocx('--diagnostic', sortie);
      const reste = document.blocs.some((b) => b.type !== 'tableau'
        && b.style !== 'szh cle abb/tab'
        && b.fragments.some((f) => f.texte.includes('Abbildung')));
      assert.strictEqual(reste, false, 'aucune légende ne doit rester dans le corps');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Plusieurs paragraphes vides du manuscrit collés à un bloc se fondent dans le séparateur
// injecté au lieu de s'y ajouter.
//
// Sabotage : dans _convertir_niveau_racine, ne pas fondre les segments vides consécutifs
// (retirer le bloc `segments_reduits`, réassigner `segments_reduits = segments`).

// Un bloc tableau écrit ses paragraphes de clé avant son <w:tbl> de contenu. Après le <w:tbl>
// du premier bloc viennent donc le séparateur (un seul <w:p> vide) puis la première clé du
// second bloc, sans second <w:p> vide.

test('manuscrit_gabarit.ecrire : au plus un paragraphe vide sépare deux blocs, même si le manuscrit en portait plusieurs',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        tableau([[cellule('A1')]]),
        paragraphe([]), paragraphe([]), paragraphe([]),
        tableau([[cellule('B1')]]),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const enfants = enfantsCorps(sortie);
      const indicesTbl = enfants.map((e, i) => (e.tag === 'w:tbl' ? i : -1)).filter((i) => i >= 0);
      assert.ok(indicesTbl.length >= 4, 'au moins 4 tableaux attendus (2 fixes + 2 du test)');
      const [, , iTbl3] = indicesTbl;
      assert.strictEqual(enfants[iTbl3 + 1].tag, 'w:p');
      assert.strictEqual(enfants[iTbl3 + 1].texte, '',
        'le tout premier élément après le tableau du premier bloc doit être LE séparateur vide');
      assert.strictEqual(enfants[iTbl3 + 2].tag, 'w:p');
      assert.strictEqual(enfants[iTbl3 + 2].texte, 'Légende : ',
        'la première clé du second bloc doit suivre IMMÉDIATEMENT le séparateur — un second '
        + 'paragraphe vide signalerait que les trois vides du manuscrit n\'ont pas été '
        + 'repliés : obtenu ' + JSON.stringify(enfants[iTbl3 + 2]));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_gabarit.ecrire : deux tableaux directement adjacents (rien entre eux) reçoivent quand même exactement un séparateur',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        tableau([[cellule('A1')]]),
        tableau([[cellule('B1')]]),
      ]);
      ecrireDepuisSpec(spec, sortie);
      const enfants = enfantsCorps(sortie);
      const indicesTbl = enfants.map((e, i) => (e.tag === 'w:tbl' ? i : -1)).filter((i) => i >= 0);
      const [, , iTbl3] = indicesTbl;
      assert.strictEqual(enfants[iTbl3 + 1].tag, 'w:p');
      assert.strictEqual(enfants[iTbl3 + 1].texte, '', 'exactement un séparateur injecté');
      assert.strictEqual(enfants[iTbl3 + 2].texte, 'Légende : ',
        'la clé du second bloc doit suivre immédiatement le séparateur, jamais un second vide');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ===================================================================================
// Notes de bas de page. Fragment.note et Document.notes (dict[int, list[bloc]]) viennent de
// manuscrit_modele.py/manuscrit_docx.py : les contrôles passent par le JSON réel
// (document_depuis_json).

// ---------------------------------------------------------------------------------
// Contrôle n°1 : une note appelée par un fragment du corps est écrite dans footnotes.xml,
// renumérotée à partir de 1, et relue par le lecteur de production avec sa mise en forme.
//
// Sabotage : dans _RegistreNotes._resoudre, poser `self._xml_par_id[id_sortie] = ''` au lieu
// d'appeler `_contenu_note_xml` ; la note reste vide.

test('manuscrit_gabarit.ecrire : une note appelée est écrite dans footnotes.xml et relue avec sa mise en forme',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragraphe([
          fragment('Un appel de note'),
          fragment('', {}, { note: 5 }),
          fragment(' termine la phrase.'),
        ]),
      ], { 5: [paragraphe([
        fragment('Contenu de la note, '),
        fragment('en italique', { italique: true }),
        fragment('.'),
      ])] });
      const resultat = ecrireDepuisSpec(spec, sortie);
      assert.strictEqual(resultat.stats.notes_ecrites, 1);

      const xml = lireDocumentXml(sortie);
      assert.ok(/<w:footnoteReference w:id="1"\/>/.test(xml),
        'la note doit être renumérotée à 1 (le gabarit livré n\'a que ses deux notes '
        + 'techniques, id -1 et 0)');

      const { document } = diagnostiquerManuscritDocx('--diagnostic', sortie);
      const p = document.blocs.find((b) => b.type !== 'tableau'
        && b.fragments.some((f) => f.note));
      assert.ok(p, 'le paragraphe portant l\'appel de note doit être retrouvé');
      assert.strictEqual(p.fragments.find((f) => f.note).note, 1);

      assert.ok(document.notes && document.notes['1'], 'la note 1 doit être relisible');
      const fragItalique = document.notes['1'][0].fragments.find((f) => f.texte.includes('italique'));
      assert.ok(fragItalique, 'le fragment en italique de la note doit être retrouvé');
      assert.strictEqual(fragItalique.forme.italique, true, 'l\'italique DANS une note doit survivre');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°2 : une note de document.notes jamais appelée n'est pas écrite (elle n'aurait pas
// d'ancre), et c'est tracé. Le test vérifie le contenu de la trace, pas sa seule présence.
//
// Sabotage : dans ecrire(), retirer la condition `if orphelines:`.

test('manuscrit_gabarit.ecrire : une note jamais appelée n\'est pas écrite, et c\'est tracé',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragraphe([fragment('Un paragraphe sans aucun appel de note.')]),
      ], { 9: [paragraphe([fragment('Note jamais appelée.')])] });
      const resultat = ecrireDepuisSpec(spec, sortie);
      assert.strictEqual(resultat.stats.notes_ecrites, 0);
      const ligne = resultat.trace.find((l) => l.decision === 'notes_orphelines');
      assert.ok(ligne, 'une ligne de trace notes_orphelines est attendue');
      assert.ok(ligne.motif.includes('9'), 'la trace doit nommer l\'identifiant orphelin (9)');
      const xml = lireDocumentXml(sortie);
      assert.ok(!/<w:footnoteReference/.test(xml), 'aucun appel de note ne doit apparaître');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°3 : un appel de note sans contenu (cas anormal) reçoit un contenu vide plutôt
// qu'un document invalide, et c'est tracé comme anomalie.

test('manuscrit_gabarit.ecrire : un appel de note sans contenu correspondant écrit une note vide, tracée',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragraphe([fragment('Appel orphelin'), fragment('', {}, { note: 42 })]),
      ]); // pas de clé "42" dans notes
      const resultat = ecrireDepuisSpec(spec, sortie);
      assert.strictEqual(resultat.stats.notes_ecrites, 1);
      const ligne = resultat.trace.find((l) => l.decision === 'note_introuvable');
      assert.ok(ligne, 'une ligne de trace note_introuvable est attendue');
      const erreurs = validerPartiesXml(sortie);
      assert.deepStrictEqual(erreurs, [], 'le document reste un XML valide malgré la note manquante');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°4 : les gabarits FR et DE ne définissent ni style d'appel de note ni style de
// texte de note. Le renvoi se pose en exposant (vertAlign), le paragraphe de note dans le
// style de corps résolu du gabarit. Ce style a pour styleId Textkrper : la boucle FR/DE
// vérifie le styleId réel de chaque gabarit, pour qu'un 'Corpsdetexte' codé en dur se voie.

for (const { langue, gabarit, styleCorpsAttendu } of [
  { langue: 'fr', gabarit: GABARIT_LIVRE, styleCorpsAttendu: 'Textkrper' },
  { langue: 'de', gabarit: GABARIT_DE, styleCorpsAttendu: 'Textkrper' },
]) {
  test('manuscrit_gabarit.ecrire (' + langue + ') : sans style de note dans le gabarit, le '
    + 'renvoi est un simple exposant et la note porte le style de corps RÉSOLU',
    { skip: sansPython }, () => {
      const base = dossierJetable();
      try {
        const sortie = path.join(base, 'sortie.docx');
        const spec = specDocument([
          paragraphe([fragment('Texte'), fragment('', {}, { note: 1 })]),
        ], { 1: [paragraphe([fragment('Contenu.')])] });
        ecrireDepuisSpec(spec, sortie, gabarit);
        const xml = lireDocumentXml(sortie);
        assert.ok(/<w:footnoteReference w:id="1"\/>/.test(xml));
        const rIdxFootnoteRef = xml.indexOf('<w:footnoteReference');
        const runAvant = xml.lastIndexOf('<w:r>', rIdxFootnoteRef);
        assert.ok(xml.slice(runAvant, rIdxFootnoteRef).includes('vertAlign w:val="superscript"'),
          'le run d\'appel doit porter un exposant (aucun gabarit n\'a de style dédié)');

        const footnotes = pythonSortie( ['-c',
          'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); '
          + 'sys.stdout.write(z.read("word/footnotes.xml").decode("utf-8"))', sortie],
          { encoding: 'utf8', env: ENV_UTF8 });
        assert.ok(new RegExp('<w:footnote w:id="1">.*?' + styleCorpsAttendu, 's').test(footnotes),
          'le paragraphe de la note doit porter le style de corps résolu (' + styleCorpsAttendu
          + '), faute de style dédié — obtenu :\n' + footnotes);
        assert.ok(!/Corpsdetexte/.test(footnotes),
          'jamais le repli FR historique en dur : le gabarit ' + langue + ' ne définit pas ce '
          + 'styleId');
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });
}

// ---------------------------------------------------------------------------------
// Contrôle n°5, sur le corpus : 12 notes dans `2-fin-de-document` (12 w:footnoteReference).
// `1bis`, `2-dense`, `2-grappes` et `5bis` n'ont aucun appel de note : leur document.notes ne
// contenait qu'une note technique `continuationNotice`, orpheline, donc pas écrite. 0 est la
// valeur attendue.

test('manuscrit_gabarit.ecrire : les notes de bas de page du corpus réel sont écrites en nombre attendu',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
      return;
    }
    const attendu = {
      '2-fin-de-document_Article_RSPS.docx': 12,
      // 0 : voir le commentaire du test (note technique orpheline, jamais écrite).
      '1bis_Booms Article.docx': 0,
      '2-dense_20250404_Quelle inclusion pour les personnes en situation de handicap.docx': 0,
      '2-grappes_En Route pour Apprendre.docx': 0,
      '5bis_20250208_Vers un enseignement superieur inclusif_identifier et repondre aux defis des etudiantes et etudiants BEP.docx': 0,
    };
    const base = dossierJetable();
    try {
      const ecarts = [];
      for (const [nom, n] of Object.entries(attendu)) {
        const entree = path.join(CORPUS_LOT_A, nom);
        if (!fs.existsSync(entree)) { ecarts.push(nom + ' : fichier introuvable dans lot-A'); continue; }
        const sortie = path.join(base, nom.replace(/\.docx$/i, '') + '-gabarit.docx');
        const r = python(['-c', ECRIRE_DEPUIS_DOCX, PIPELINE, entree, GABARIT_LIVRE, sortie], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
        assert.strictEqual(r.status, 0, nom + ' : ' + r.stderr);
        const resultat = JSON.parse(r.stdout);
        if (resultat.stats.notes_ecrites !== n) {
          ecarts.push(nom + ' : attendu ' + n + ', obtenu ' + resultat.stats.notes_ecrites);
        }
      }
      assert.deepStrictEqual(ecarts, []);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ===================================================================================
// Table de correspondance : ecrire() rend `correspondance`, une entrée par paragraphe de corps
// écrit comme <w:p> de premier niveau. Les paragraphes qu'un bloc écrit lui-même (clés,
// image) n'ont pas d'entrée normale mais comptent dans l'indice `sortie` des suivants. Un bloc
// reçoit en plus une entrée `bloc` (ancrage de A11y.TexteAlternatif.* sur sa clé « Texte
// alternatif : ») ; ce contrôle ne porte que sur les entrées normales.

test('manuscrit_gabarit.ecrire : la table de correspondance pointe, pour chaque paragraphe de corps, le bon <w:p> de la sortie',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragraphe([fragment('Premier paragraphe.')], { source: 0 }),
        paragraphe([fragment('Second paragraphe.')], { source: 1 }),
        tableau([[cellule('A1')]], { source: 2 }),
        paragraphe([fragment('Troisième paragraphe.')], { source: 3 }),
      ]);
      const resultat = ecrireDepuisSpec(spec, sortie);
      const { normales, blocs } = separerCorrespondance(resultat.correspondance);
      assert.strictEqual(normales.length, 3,
        'un tableau ne doit jamais recevoir d\'entrée de correspondance NORMALE (3 paragraphes, 1 tableau)');
      assert.strictEqual(blocs.length, 1, 'le tableau doit recevoir une entrée `bloc`');
      assert.strictEqual(blocs[0].source, 2, 'la source de l\'entrée `bloc` doit être celle du tableau');
      assert.strictEqual(blocs[0].bloc, 'tableau');

      const attendus = { 0: 'Premier paragraphe.', 1: 'Second paragraphe.',
                          3: 'Troisième paragraphe.' };
      const textes = textesWp(enfantsCorps(sortie));
      for (const c of normales) {
        assert.strictEqual(textes[c.sortie], attendus[c.source],
          'source ' + c.source + ' -> sortie ' + c.sortie + ' : texte attendu '
          + JSON.stringify(attendus[c.source]) + ', obtenu ' + JSON.stringify(textes[c.sortie]));
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Avec deux blocs figure et un bloc tableau, la correspondance des paragraphes de corps qui
// les entourent reste exacte : un bloc écrit 4 ou 5 <w:p> (ses clés, plus l'image d'une
// figure) et compte d'autant dans `n_wp`.
//
// Sabotage : dans `_convertir_niveau_racine`, remplacer `compteur_wp += n_wp` par
// `compteur_wp += (0 if est_bloc else n_wp)`.

test('manuscrit_gabarit.ecrire : la correspondance reste exacte de part et d\'autre de deux blocs figure et un bloc tableau',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragraphe([fragment('Avant tout.')], { source: 0 }),
        paragraphe([fragment('', {}, { image: image('un.png', Buffer.from('UN').toString('base64')) })],
          { source: 1 }),
        paragraphe([fragment('Entre les deux figures.')], { source: 2 }),
        paragraphe([fragment('', {}, { image: image('deux.png', Buffer.from('DEUX').toString('base64')) })],
          { source: 3 }),
        paragraphe([fragment('Avant le tableau.')], { source: 4 }),
        tableau([[cellule('A1')]], { source: 5 }),
        paragraphe([fragment('Après tout.')], { source: 6 }),
      ]);
      const resultat = ecrireDepuisSpec(spec, sortie);
      // Quatre paragraphes de corps (0, 2, 4, 6). Les deux images et le tableau n'ont pas
      // d'entrée normale, mais une entrée `bloc` chacun.
      const { normales, blocs } = separerCorrespondance(resultat.correspondance);
      assert.strictEqual(normales.length, 4,
        'quatre paragraphes de corps attendus dans la correspondance normale, obtenu '
        + JSON.stringify(normales));
      assert.strictEqual(blocs.length, 3, 'un bloc par image (2) et par tableau (1)');
      assert.deepStrictEqual(blocs.map((b) => b.source).sort((a, b) => a - b), [1, 3, 5],
        'les entrées `bloc` doivent porter la source des DEUX images et du tableau');
      assert.deepStrictEqual(blocs.map((b) => b.bloc).sort(), ['figure', 'figure', 'tableau']);

      const attendus = { 0: 'Avant tout.', 2: 'Entre les deux figures.',
                          4: 'Avant le tableau.', 6: 'Après tout.' };
      const enfants = enfantsCorps(sortie);
      const textes = textesWp(enfants);
      const styles = stylesWp(enfants);
      for (const c of normales) {
        assert.strictEqual(textes[c.sortie], attendus[c.source],
          'source ' + c.source + ' -> sortie ' + c.sortie + ' : texte attendu '
          + JSON.stringify(attendus[c.source]) + ', obtenu ' + JSON.stringify(textes[c.sortie]));
      }
      // Chaque entrée `bloc` vise un <w:p> de style SZHCleAbbTab qui commence par « Texte
      // alternatif » (l'image ou le tableau n'a pas de texte `source`).
      for (const b of blocs) {
        assert.strictEqual(styles[b.sortie], 'SZHCleAbbTab',
          'bloc ' + JSON.stringify(b) + ' devrait viser un <w:p> SZHCleAbbTab');
        assert.ok((textes[b.sortie] || '').startsWith('Texte alternatif'),
          'bloc ' + JSON.stringify(b) + ' devrait viser la clé « Texte alternatif : », '
          + 'obtenu ' + JSON.stringify(textes[b.sortie]));
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// `correspondance.source` est le vrai `Paragraphe.source`, pas la position dans la liste
// `blocs` : la CLI retire les paragraphes d'en-tête avant d'appeler ecrire(), et la liste
// reçue a des trous. Ici les deux paragraphes portent `source` 5 et 9 aux positions 0 et 2.
test('manuscrit_gabarit.ecrire : correspondance.source est Paragraphe.source, pas une position de liste',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const spec = specDocument([
        paragraphe([fragment('Avant le tableau.')], { source: 5 }),
        tableau([[cellule('A1')]], { source: 6 }),
        paragraphe([fragment('Après le tableau.')], { source: 9 }),
      ]);
      const resultat = ecrireDepuisSpec(spec, sortie);
      const { normales, blocs } = separerCorrespondance(resultat.correspondance);
      const sources = normales.map((c) => c.source).sort((a, b) => a - b);
      assert.deepStrictEqual(sources, [5, 9],
        'correspondance.source doit porter les Paragraphe.source 5 et 9, jamais des positions '
        + 'de liste (0 et 2) : obtenu ' + JSON.stringify(sources));
      // Le tableau (source 6, position 1) reçoit son entrée `bloc`, elle aussi par source.
      assert.deepStrictEqual(blocs.map((b) => b.source), [6],
        'l\'entrée `bloc` du tableau doit porter Paragraphe.source (6), jamais une position '
        + 'de liste (1)');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_gabarit.ecrire : sur les onze manuscrits réels, 100% de la table de correspondance pointe un texte identique',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
      return;
    }
    const fichiers = fs.readdirSync(CORPUS_LOT_A).filter((n) => n.toLowerCase().endsWith('.docx'));
    const base = dossierJetable();
    try {
      let total = 0;
      const echecs = [];
      for (const nom of fichiers) {
        const entree = path.join(CORPUS_LOT_A, nom);
        const sortie = path.join(base, nom.replace(/\.docx$/i, '') + '-gabarit.docx');
        const r = python(['-c', ECRIRE_DEPUIS_DOCX, PIPELINE, entree, GABARIT_LIVRE, sortie], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
        assert.strictEqual(r.status, 0, nom + ' : ' + r.stderr);
        const resultat = JSON.parse(r.stdout);
        const docEntree = diagnostiquerManuscritDocx('--diagnostic', entree).document;
        const enfants = enfantsCorps(sortie);
        const textesSortie = textesWp(enfants);
        const stylesSortie = stylesWp(enfants);
        for (const c of resultat.correspondance) {
          total += 1;
          if (c.bloc) {
            // Entrée `bloc` : le paragraphe `sortie` ne porte pas le texte de `source` ; on
            // vérifie le style SZHCleAbbTab et le début « Texte alternatif ».
            const styleOk = stylesSortie[c.sortie] === 'SZHCleAbbTab';
            const texteOk = (textesSortie[c.sortie] || '').startsWith('Texte alternatif');
            if (!styleOk || !texteOk) {
              echecs.push(nom + ' : bloc (' + c.bloc + ') source ' + c.source + ' -> sortie '
                + c.sortie + ' : attendu style SZHCleAbbTab + texte « Texte alternatif… », '
                + 'obtenu style=' + JSON.stringify(stylesSortie[c.sortie]) + ' texte='
                + JSON.stringify(textesSortie[c.sortie]));
            }
            continue;
          }
          const blocSource = docEntree.blocs[c.source];
          if (!blocSource || blocSource.type === 'tableau') {
            echecs.push(nom + ' : source ' + c.source + ' n\'est pas un paragraphe'); continue;
          }
          const texteSource = blocSource.fragments.map((f) => f.texte).join('');
          if (textesSortie[c.sortie] !== texteSource) {
            echecs.push(nom + ' : source ' + c.source + ' -> sortie ' + c.sortie
              + ' : attendu ' + JSON.stringify(texteSource) + ', obtenu '
              + JSON.stringify(textesSortie[c.sortie]));
          }
        }
      }
      assert.ok(total > 0, 'au moins une correspondance attendue sur le corpus');
      assert.deepStrictEqual(echecs, [], (total - echecs.length) + '/' + total + ' correctes');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ===================================================================================
// Corpus : validité XML de chaque partie, structure (sectPr en dernier, Content_Types,
// relations résolues, TargetMode externe), et aucun texte perdu (corps et notes).

test('manuscrit_gabarit.ecrire : sur les onze manuscrits réels, chaque partie XML de la sortie est valide et la structure est cohérente',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
      return;
    }
    const fichiers = fs.readdirSync(CORPUS_LOT_A).filter((n) => n.toLowerCase().endsWith('.docx'));
    const base = dossierJetable();
    try {
      const echecs = [];
      for (const nom of fichiers) {
        const entree = path.join(CORPUS_LOT_A, nom);
        const sortie = path.join(base, nom.replace(/\.docx$/i, '') + '-gabarit.docx');
        const r = python(['-c', ECRIRE_DEPUIS_DOCX, PIPELINE, entree, GABARIT_LIVRE, sortie], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
        if (r.status !== 0) { echecs.push(nom + ' (écriture) : ' + r.stderr); continue; }
        for (const e of validerPartiesXml(sortie)) { echecs.push(nom + ' (XML) : ' + e); }
        for (const e of validerStructure(sortie)) { echecs.push(nom + ' (structure) : ' + e); }
      }
      assert.deepStrictEqual(echecs, []);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_gabarit.ecrire : sur les onze manuscrits réels, aucun texte (corps ou note) n\'est perdu par rapport à l\'entrée',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
      return;
    }
    const fichiers = fs.readdirSync(CORPUS_LOT_A).filter((n) => n.toLowerCase().endsWith('.docx'));
    const base = dossierJetable();
    try {
      const echecs = [];
      for (const nom of fichiers) {
        const entree = path.join(CORPUS_LOT_A, nom);
        const sortie = path.join(base, nom.replace(/\.docx$/i, '') + '-gabarit.docx');
        const r = python(['-c', ECRIRE_DEPUIS_DOCX, PIPELINE, entree, GABARIT_LIVRE, sortie], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
        assert.strictEqual(r.status, 0, nom + ' : ' + r.stderr);
        const docEntree = diagnostiquerManuscritDocx('--diagnostic', entree).document;
        const docSortie = diagnostiquerManuscritDocx('--diagnostic', sortie).document;
        const blobSortie = paragraphesTextuels(docSortie).map(normaliserEspaces).join('');
        for (const texte of paragraphesTextuels(docEntree)) {
          const t2 = normaliserEspaces(texte);
          if (!blobSortie.includes(t2)) {
            echecs.push(nom + ' : texte introuvable en sortie : ' + JSON.stringify(t2).slice(0, 140));
          }
        }
      }
      assert.deepStrictEqual(echecs, []);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ===================================================================================
// En-tête : ecrire() reçoit `entete` (l'EnTete reconnue par pipeline/manuscrit_entete.py) et
// remplit les deux tableaux fixes : titre, sous-titre, résumé, et une fiche par autrice ou
// auteur. L'EnTete est passée en JSON en cinquième argument et reconstruite par
// `manuscrit_entete.EnTete(**...)` (mêmes champs que entete_vers_json()). La sortie est relue
// par pronto-lire.py.

const ECRIRE_DEPUIS_JSON_AVEC_ENTETE = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import manuscrit_modele as mm',
  'import manuscrit_entete as me',
  'import manuscrit_gabarit as mg',
  'chemin_gabarit, chemin_sortie, json_doc, json_entete, langue = (sys.argv[2], sys.argv[3], '
  + 'sys.argv[4], sys.argv[5], sys.argv[6])',
  'document = mm.document_depuis_json(json.loads(json_doc))',
  'entete = me.EnTete(**json.loads(json_entete))',
  'resultat = mg.ecrire(document, chemin_gabarit, chemin_sortie, decisions=None, entete=entete, '
  + 'langue=langue)',
  'print(json.dumps(resultat, ensure_ascii=True))',
].join('\n');

// `langue` : 'fr' par défaut.
function ecrireAvecEntete(spec, entete, cheminSortie, cheminGabarit, langue) {
  const r = python(['-c', ECRIRE_DEPUIS_JSON_AVEC_ENTETE, PIPELINE, cheminGabarit || GABARIT_LIVRE,
    cheminSortie, JSON.stringify(spec), JSON.stringify(entete), langue || 'fr'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
  assert.strictEqual(r.status, 0, 'ecrire() avec entete a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

// Un EnTete minimal avec tous ses champs : EnTete.__init__ lève un TypeError sur un nom en
// trop, et donne '' / [] / {} à un champ manquant.
function entete(valeurs) {
  return Object.assign({
    titre: '', sous_titre: '', auteurs: [], resume: '', langue_resume: '',
    resumes_autres: {}, mots_cles: [], doi: '', ligne_revue: '', langue_produit: 'fr',
  }, valeurs);
}

function auteur(valeurs) {
  return Object.assign({ prenom: '', nom: '', fonction: '', institution: '', email: '',
    orcid: '', texte_source: '' }, valeurs);
}

const DOC_UN_PARAGRAPHE = { blocs: [{ fragments: [{ texte: 'Un corps de texte ordinaire.' }] }] };

test('manuscrit_gabarit.ecrire (entete) : Titre/Sous-titre/Résumé/Langue remplis, relus par pronto-lire.py',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      const e = entete({
        titre: 'Un titre reconnu', sous_titre: 'un sous-titre reconnu',
        resume: 'Un texte de résumé suffisamment explicite pour ce contrôle.',
        langue_resume: 'fr', mots_cles: ['pedagogie', 'inclusion'],
        auteurs: [auteur({ prenom: 'Jean', nom: 'Dupont', fonction: 'Professeur',
          institution: 'HEP Vaud', email: 'jean.dupont@hepvd.ch' })],
      });
      const resultat = ecrireAvecEntete(DOC_UN_PARAGRAPHE, e, sortie);
      assert.ok(resultat.stats, 'ecrire() doit rendre ses stats même avec un entete');

      const dossierPronto = path.join(base, 'pronto');
      fs.mkdirSync(dossierPronto);
      const stats = prontoLire(sortie, 'essai', dossierPronto);
      assert.strictEqual(stats.tableau1_consomme, true,
        'le tableau des métadonnées, une fois rempli, doit rester reconnu par le lecteur');
      assert.strictEqual(stats.tableau2_consomme, true,
        'le tableau des auteurs, une fois rempli, doit rester reconnu par le lecteur');
      assert.deepStrictEqual(stats.avertissements, [],
        'un tableau bien rempli ne doit lever aucun avertissement de lecture');

      const meta = fs.readFileSync(path.join(dossierPronto, 'essai.meta.yaml'), 'utf8');
      assert.match(meta, /title:\s*\n\s*fr: "Un titre reconnu"/);
      assert.match(meta, /subtitle:\s*\n\s*fr: "un sous-titre reconnu"/);
      assert.match(meta, /resume:\s*\n\s*fr: "Un texte de résumé suffisamment explicite pour ce contrôle\."/);
      assert.match(meta, /lang: fr/);
      assert.match(meta, /prenom: "Jean"/);
      assert.match(meta, /nom: "Dupont"/);
      assert.match(meta, /affiliation: "HEP Vaud"/);
      assert.match(meta, /email: "jean\.dupont@hepvd\.ch"/);

      // Les mots-clés n'ont pas de champ dans le gabarit : ils vont en premier paragraphe du
      // corps, en Corpsdetexte.
      const xml = lireDocumentXml(sortie);
      assert.match(xml, /Mots-clés : pedagogie, inclusion/);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_gabarit.ecrire (entete) : plus d\'auteurs que de fiches -> la dernière fiche est dupliquée, aucun auteur perdu',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      // Le gabarit livré porte 3 fiches : 4 auteurs en font dupliquer une.
      const e = entete({
        titre: 'Un titre', langue_produit: 'fr',
        auteurs: ['A', 'B', 'C', 'D'].map((lettre) => auteur({ prenom: lettre, nom: 'Nom' + lettre })),
      });
      ecrireAvecEntete(DOC_UN_PARAGRAPHE, e, sortie);
      const dossierPronto = path.join(base, 'pronto');
      fs.mkdirSync(dossierPronto);
      const stats = prontoLire(sortie, 'essai', dossierPronto);
      assert.strictEqual(stats.tableau2_consomme, true);
      const meta = fs.readFileSync(path.join(dossierPronto, 'essai.meta.yaml'), 'utf8');
      for (const lettre of ['A', 'B', 'C', 'D']) {
        assert.match(meta, new RegExp('prenom: "' + lettre + '"'),
          'auteur ' + lettre + ' doit être présent — aucun ne doit se perdre au-delà des '
          + 'trois fiches livrées par le gabarit');
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_gabarit.ecrire : sans entete (None), les deux tableaux fixes restent vides comme avant ce chantier',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie.docx');
      ecrireDepuisSpec(DOC_UN_PARAGRAPHE, sortie);
      const dossierPronto = path.join(base, 'pronto');
      fs.mkdirSync(dossierPronto);
      prontoLire(sortie, 'essai', dossierPronto);
      // meta.yaml existe toujours (lang/source y sont écrits), mais sans entete aucun des
      // deux tableaux fixes ne livre de valeur.
      const meta = fs.readFileSync(path.join(dossierPronto, 'essai.meta.yaml'), 'utf8');
      assert.ok(!/^title:/m.test(meta), 'aucun titre sans entete');
      assert.ok(!/^author:/m.test(meta), 'aucun auteur sans entete');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ===================================================================================
// Gabarits FR et DE : ecrire() écrit dans le gabarit de la Revue (`langue='fr'`) ou de la
// Zeitschrift (`langue='de'`). Les styleId (berschrift1…, Textkrper) sont résolus depuis
// word/styles.xml de chaque gabarit par leur w:name. Contrôles : résolution de style et son
// repli tracé, étiquettes des blocs et ligne mots-clés par langue, retrait du commentaire
// d'aide du gabarit, et un manuscrit du corpus écrit dans les deux gabarits puis relu par
// pronto-lire.py sans « cle-approximee » ni blocage.

// ---- Résolution de style : styleId réel du gabarit, pas le repli FR -------------------

const STYLEIDS_PY = [
  'import sys, zipfile, re, json',
  'z = zipfile.ZipFile(sys.argv[1])',
  'styles_xml = z.read("word/styles.xml").decode("utf-8")',
  'noms = {}',
  'for m in re.finditer(r\'<w:style\\b[^>]*w:styleId="([^"]*)"[^>]*>(.*?)</w:style>\', '
  + 'styles_xml, re.S):',
  '    sid, corps = m.group(1), m.group(2)',
  '    nm = re.search(r\'<w:name\\s+w:val="([^"]*)"\', corps)',
  '    if nm:',
  '        noms[nm.group(1).lower()] = sid',
  'print(json.dumps(noms))',
].join('\n');

function styleidsDuGabarit(chemin) {
  const r = python(['-c', STYLEIDS_PY, chemin], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
  assert.strictEqual(r.status, 0, 'lecture des styleId du gabarit a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

const PSTYLES_ECRITS_PY = [
  'import sys, zipfile, re, json',
  'z = zipfile.ZipFile(sys.argv[1])',
  'noms = z.namelist()',
  'ecrits = set()',
  'for nom in ("word/document.xml", "word/footnotes.xml"):',
  '    if nom in noms:',
  '        ecrits |= set(re.findall(r\'<w:pStyle w:val="([^"]+)"\', '
  + 'z.read(nom).decode("utf-8")))',
  'declares = set(re.findall(r\'w:styleId="([^"]+)"\', '
  + 'z.read("word/styles.xml").decode("utf-8")))',
  'print(json.dumps({"ecrits": sorted(ecrits), "manquants": sorted(ecrits - declares)}))',
].join('\n');

function pstylesEcrits(chemin) {
  const r = python(['-c', PSTYLES_ECRITS_PY, chemin], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
  assert.strictEqual(r.status, 0, 'lecture des pStyle écrits a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

for (const { langue, gabarit } of [{ langue: 'fr', gabarit: GABARIT_LIVRE },
                                    { langue: 'de', gabarit: GABARIT_DE }]) {
  test('manuscrit_gabarit.ecrire (' + langue + ') : les styleId RÉELS du gabarit '
    + '(berschrift1/Textkrper) sont écrits, jamais le repli FR historique (Titre1/'
    + 'Corpsdetexte)',
    { skip: sansPython }, () => {
      const base = dossierJetable();
      try {
        const attendus = styleidsDuGabarit(gabarit);
        assert.strictEqual(attendus['heading 1'], 'berschrift1',
          'ce contrôle suppose un gabarit V4 (styleId allemand) — mesure invalidée sinon');
        assert.strictEqual(attendus['body text'], 'Textkrper');

        const sortie = path.join(base, 'sortie.docx');
        const spec = specDocument([
          paragraphe([fragment('Titre de niveau 1')], { niveau_declare: 1, niveau_retenu: 1 }),
          paragraphe([fragment('Un paragraphe de corps.')]),
        ]);
        ecrireDepuisSpec(spec, sortie, gabarit);
        const xml = lireDocumentXml(sortie);
        assert.ok(xml.includes('<w:pStyle w:val="' + attendus['heading 1'] + '"/>'),
          'le titre de niveau 1 doit porter le VRAI styleId résolu par nom (berschrift1)');
        assert.ok(xml.includes('<w:pStyle w:val="' + attendus['body text'] + '"/>'),
          'le corps doit porter le VRAI styleId résolu par nom (Textkrper)');
        assert.ok(!xml.includes('w:val="Titre1"') && !xml.includes('w:val="Corpsdetexte"'),
          'le repli FR historique (Titre1/Corpsdetexte) ne doit jamais apparaître : ces '
          + 'styleId n\'existent pas dans les gabarits V4');
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });
}

// Sabotage : `_styleid_par_nom` qui rend toujours None force le repli ('Titre1',
// 'Corpsdetexte', 'SZHCle', 'SZHAide') et une trace 'style_introuvable' par résolution ; les
// deux contrôles ci-dessus rougissent.

// ---- Étiquettes des blocs figure/tableau et ligne mots-clés, par langue -----------------

for (const { langue, gabarit, labels, mots } of [
  { langue: 'fr', gabarit: GABARIT_LIVRE,
    labels: ['Légende : ', 'Texte alternatif : ', 'Copyright : ', 'Source : ', 'Note : '],
    mots: 'Mots-clés : un, deux' },
  { langue: 'de', gabarit: GABARIT_DE,
    labels: ['Beschriftung: ', 'Alternativtext: ', 'Copyright: ', 'Quelle: ', 'Notiz: '],
    mots: 'Schlüsselwörter: un, deux' },
]) {
  test('manuscrit_gabarit.ecrire (' + langue + ') : les étiquettes des blocs figure/tableau '
    + 'et la ligne mots-clés suivent `langue`, jamais celles de l\'autre langue',
    { skip: sansPython }, () => {
      const base = dossierJetable();
      try {
        const sortie = path.join(base, 'sortie.docx');
        const octets = Buffer.from('IMAGE-ESSAI-LABELS-0123456789');
        const spec = specDocument([
          paragraphe([fragment('', {}, { image: image('fig.png', octets.toString('base64')) })]),
        ]);
        const e = entete({ mots_cles: ['un', 'deux'] });
        ecrireAvecEntete(spec, e, sortie, gabarit, langue);
        const xml = lireDocumentXml(sortie);
        for (const label of labels) {
          assert.ok(xml.includes(label),
            'étiquette attendue absente (' + langue + ') : « ' + label + ' »');
        }
        const autresLabels = langue === 'fr'
          ? ['Beschriftung', 'Alternativtext', 'Quelle', 'Notiz']
          : ['Légende', 'Texte alternatif', 'Crédit', 'Source', 'Note'];
        for (const etrangere of autresLabels) {
          assert.ok(!xml.includes(etrangere),
            'étiquette de l\'AUTRE langue trouvée dans une sortie ' + langue + ' : « '
            + etrangere + ' »');
        }
        assert.ok(xml.includes(mots), 'ligne mots-clés attendue absente : « ' + mots + ' »');
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });
}

// Les étiquettes suivent le paramètre `langue`, pas un texte lu dans le gabarit : forcer
// `langue='fr'` sur le gabarit DE écrit les étiquettes FR.

// ---- Le commentaire d'aide du gabarit ne se retrouve pas, orphelin, en sortie ----------

for (const { langue, gabarit } of [{ langue: 'fr', gabarit: GABARIT_LIVRE },
                                    { langue: 'de', gabarit: GABARIT_DE }]) {
  test('manuscrit_gabarit.ecrire (' + langue + ') : le commentaire Word d\'aide du gabarit '
    + '(comments.xml et ses parties liées) ne se retrouve jamais, orphelin, dans le .docx '
    + 'produit',
    { skip: sansPython }, () => {
      const base = dossierJetable();
      try {
        const sortie = path.join(base, 'sortie.docx');
        ecrireDepuisSpec(DOC_UN_PARAGRAPHE, sortie, gabarit);
        const r = pythonSortie( ['-c',
          'import sys, zipfile, json; z = zipfile.ZipFile(sys.argv[1]); '
          + 'print(json.dumps(z.namelist()))', sortie], { encoding: 'utf8', env: ENV_UTF8 });
        const noms = JSON.parse(r);
        for (const partie of ['word/comments.xml', 'word/commentsExtended.xml',
          'word/commentsIds.xml', 'word/commentsExtensible.xml', 'word/people.xml']) {
          assert.ok(!noms.includes(partie), partie + ' ne doit pas survivre dans la sortie');
        }
        const rels = pythonSortie( ['-c',
          'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); '
          + 'sys.stdout.write(z.read("word/_rels/document.xml.rels").decode("utf-8"))', sortie],
          { encoding: 'utf8', env: ENV_UTF8 });
        assert.ok(!/comment/i.test(rels) && !/people\.xml/i.test(rels),
          'aucune relation vers une partie commentaire ne doit rester : ' + rels);
        const ct = pythonSortie( ['-c',
          'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); '
          + 'sys.stdout.write(z.read("[Content_Types].xml").decode("utf-8"))', sortie],
          { encoding: 'utf8', env: ENV_UTF8 });
        assert.ok(!/comment/i.test(ct) && !/people\.xml/i.test(ct),
          'aucun Override vers une partie commentaire ne doit rester : ' + ct);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });
}

// Sabotage : rendre `_retirer_relations`/`_retirer_overrides` sans effet ; les cinq parties
// commentaire réapparaissent dans la sortie.

// ---- De bout en bout : manuscrit du corpus, entete complet, FR et DE ------------------

const MANUSCRIT_REEL = path.join(RACINE, 'tmp', 'corpus-relecture',
  "Le coenseignement développemental_revue Suisse_10082026.docx");

const ECRIRE_DEPUIS_DOCX_AVEC_ENTETE = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import manuscrit_docx as md',
  'import manuscrit_entete as me',
  'import manuscrit_gabarit as mg',
  'chemin_manuscrit, chemin_gabarit, chemin_sortie, json_entete, langue = ('
  + 'sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6])',
  'document = md.lire(chemin_manuscrit)',
  'entete = me.EnTete(**json.loads(json_entete))',
  'resultat = mg.ecrire(document, chemin_gabarit, chemin_sortie, decisions=None, entete=entete, '
  + 'langue=langue)',
  'print(json.dumps(resultat, ensure_ascii=True))',
].join('\n');

function ecrireReelAvecEntete(chemin, gabarit, sortie, ent, langue) {
  const r = python(['-c', ECRIRE_DEPUIS_DOCX_AVEC_ENTETE, PIPELINE, chemin, gabarit, sortie,
    JSON.stringify(ent), langue], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
  assert.strictEqual(r.status, 0, 'ecrire() (manuscrit réel + entete) a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

for (const { langue, gabarit, produit } of [
  { langue: 'fr', gabarit: GABARIT_LIVRE, produit: 'revue' },
  { langue: 'de', gabarit: GABARIT_DE, produit: 'zeitschrift' },
]) {
  test('manuscrit_gabarit.ecrire (bout en bout, ' + langue + ') : manuscrit réel écrit avec '
    + 'un entete complet, relu par pronto-lire.py sans cle-approximee ni blocage',
    { skip: sansPython }, (t) => {
      if (!fs.existsSync(MANUSCRIT_REEL)) {
        sauter.corpus(t, MANUSCRIT_REEL);
        return;
      }
      const base = dossierJetable();
      try {
        const sortie = path.join(base, 'sortie.docx');
        const e = entete({
          titre: 'Titre bout en bout', sous_titre: 'Sous-titre bout en bout',
          resume: 'Un résumé suffisamment long pour ce contrôle de bout en bout.',
          langue_produit: langue, mots_cles: ['un', 'deux'],
          auteurs: [
            auteur({ prenom: 'Ana', nom: 'Muster', fonction: 'Chercheuse', institution: 'HfH',
              email: 'a@b.ch', orcid: '0000-0000-0000-0001' }),
            auteur({ prenom: 'Beat', nom: 'Meier', fonction: 'Chercheur', institution: 'HfH',
              email: 'b@b.ch' }),
          ],
        });
        const resultat = ecrireReelAvecEntete(MANUSCRIT_REEL, gabarit, sortie, e, langue);
        assert.ok(resultat.stats, 'ecrire() doit rendre ses stats');

        // Chaque partie XML de la sortie doit être bien formée...
        assert.deepStrictEqual(validerPartiesXml(sortie), []);
        // ...et chaque pStyle écrit existe dans styles.xml de ce gabarit.
        const { manquants } = pstylesEcrits(sortie);
        assert.deepStrictEqual(manquants, [],
          'pStyle écrit(s) introuvable(s) dans styles.xml du gabarit : ' + manquants);

        // Relu par pronto-lire.py ; $SZH_PRODUIT décide la langue lue.
        const dossierPronto = path.join(base, 'pronto');
        fs.mkdirSync(dossierPronto);
        const r = python( [PRONTO_LIRE, sortie, 'essai', dossierPronto],
          { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
            env: Object.assign({}, ENV_UTF8, { SZH_PRODUIT: produit }) });
        assert.strictEqual(r.status, 0, 'pronto-lire.py doit rendre 0 : ' + r.stderr);
        assert.ok(!/cle-approximee/.test(r.stderr),
          'aucune clé approximée attendue sur un tableau bien rempli :\n' + r.stderr);
        const stats = JSON.parse(r.stdout);
        assert.ok(!stats.bloquant, 'aucun code bloquant attendu : ' + JSON.stringify(stats));

        const meta = fs.readFileSync(path.join(dossierPronto, 'essai.meta.yaml'), 'utf8');
        assert.match(meta, new RegExp('lang: ' + langue));
        assert.match(meta, new RegExp('title:\\s*\\n\\s*' + langue
          + ': "Titre bout en bout"'));
        assert.match(meta, new RegExp('subtitle:\\s*\\n\\s*' + langue
          + ': "Sous-titre bout en bout"'));
        assert.match(meta, new RegExp('resume:\\s*\\n\\s*' + langue
          + ': "Un résumé suffisamment long pour ce contrôle de bout en bout\\."'));
        assert.match(meta, /prenom: "Ana"/);
        assert.match(meta, /prenom: "Beat"/);
        assert.match(meta, /affiliation: "HfH"/);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });
}
