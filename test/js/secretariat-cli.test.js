// outils/secretariat-cli.js : entrée en ligne de commande des quatre exports du
// secrétariat. lib/secretariat.js (la logique) est couverte à 97,6 % ; la couche CLI
// elle-même — argv, JSON Lines sur stdout, code de sortie, encodage du CSV — n'était
// éprouvée par rien (ni require, ni spawnSync sur elle dans aucun test).
//
// « edudoc » est la seule des quatre commandes exécutable ici sans réseau : ses numéros et
// son thésaurus 690 viennent d'un cache local (--cache) ; « numeros-ojs » et « caracteres »
// moissonnent l'OAI-PMH/HTTP pour de vrai depuis la CLI (opts.recuperer, qui permet de
// l'éviter, n'est accessible qu'en bibliothèque — secretariat-cli.js ne l'expose pas). Le
// cas « commande inconnue » et le cas « --cache manquant » couvrent en plus le code de
// sortie 1 et le message d'erreur, sans dépendre d'aucun outil externe.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const CLI = path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'outils', 'secretariat-cli.js');
const secretariat = require(path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'secretariat.js'));

function dossierJetable(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
}

// Même fabrique que test/js/secretariat.test.js (enveloppeOai/recordOaiDc) : repasser par
// secretariat.decoderRecordOai() plutôt que construire l'objet article à la main garantit la
// même forme qu'un vrai moissonnage produirait, sans dupliquer sa connaissance ici.
function enveloppeOai(corps) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">\n' +
    '\t<responseDate>2026-09-14T12:00:00Z</responseDate>\n\t<ListRecords>\n' + corps + '\n\t</ListRecords>\n</OAI-PMH>\n';
}

function recordOaiDc(o) {
  const dc = [];
  if (o.titreFr) { dc.push('<dc:title xml:lang="fr">' + o.titreFr + '</dc:title>'); }
  for (const c of (o.creators || [])) { dc.push('<dc:creator>' + c + '</dc:creator>'); }
  if (o.doi) { dc.push('<dc:identifier>' + o.doi + '</dc:identifier>'); }
  const forme = 'Revue suisse de pédagogie spécialisée; Vol. ' + o.volume + ' No ' + o.numero +
    ' (' + o.annee + '): ' + o.titreNumero + (o.pages ? '; ' + o.pages : '');
  dc.push('<dc:source>' + forme + '</dc:source>');
  dc.push('<dc:source>' + (o.issn || '2813-4915') + '</dc:source>');
  if (o.pdf) { dc.push('<dc:relation>' + o.pdf + '</dc:relation>'); dc.push('<dc:format>application/pdf</dc:format>'); }
  return '\t\t<record>\n\t\t\t<header>\n\t\t\t\t<identifier>oai:ojs.szh.ch:article/' + o.id + '</identifier>\n' +
    '\t\t\t\t<datestamp>2026-09-01T00:00:00Z</datestamp>\n\t\t\t\t<setSpec>' + o.setSpec + '</setSpec>\n\t\t\t</header>\n' +
    '\t\t\t<metadata><oai_dc:dc xmlns:dc="http://purl.org/dc/elements/1.1/">\n' + dc.join('\n') + '\n</oai_dc:dc></metadata>\n\t\t</record>';
}

function cacheEssai(cheminCache) {
  const art = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '1', setSpec: 'revue:VA', titreFr: 'Un article du banc CLI',
    creators: ['Dentz, Amélie', 'Frank Baud, Bianca'], doi: '10.57161/r2026-03-01',
    volume: '16', numero: '03', annee: '2026', titreNumero: 'Numéro', pages: '27-32'
  })))[0], 'revue');
  const cache = {
    version: 1, dateRecolte: null,
    numeros: { '2026-03': [{ cle: '2026-03', revue: 'revue', locale: 'fr', annee: '2026',
      numero: '03', volume: '16', titre: 'Numéro', issn: '2813-4915', articles: [art] }] }
  };
  secretariat.ecrireCacheNumeros(cheminCache, cache);
}

// Les champs quotés d'une ligne CSV suisse : `"a";"b, c";"d ""e"""` -> 3 entrées. Chaque
// colonne de ce gabarit est toujours entre guillemets (filtre |csv, lib/gabarits.js), donc
// compter les groupes entre guillemets donne le compte exact de colonnes.
function colonnes(ligne) { return ligne.match(/"(?:[^"]|"")*"/g) || []; }

test('secretariat-cli.js edudoc : code 0, JSON Lines sur stdout, CSV BOM+CRLF, colonnes exactes',
  () => {
    const dossier = dossierJetable('szh-cli-edu-');
    const cheminCache = path.join(dossier, 'cache.json');
    cacheEssai(cheminCache);
    const dossierSortie = path.join(dossier, 'sortie');

    const r = cp.spawnSync(process.execPath, [CLI, 'edudoc',
      '--cache', cheminCache, '--numeros', '2026-03', '--sortie', dossierSortie],
      { encoding: 'utf8' });

    assert.strictEqual(r.status, 0, 'code de sortie inattendu : ' + r.status + ' -- ' + r.stderr);
    const lignes = String(r.stdout).trim().split(/\r?\n/).map((l) => JSON.parse(l));
    assert.ok(lignes.length >= 2, 'au moins une étape puis le bilan attendus : ' + r.stdout);
    const fin = lignes[lignes.length - 1];
    assert.strictEqual(fin.t, 'fin', 'la dernière ligne n’est pas le bilan');
    assert.strictEqual(fin.ok, true, 'le bilan dit l’échec : ' + fin.texte);
    const fichier = lignes.find((l) => l.t === 'fichier');
    assert.ok(fichier, 'aucune ligne « fichier » émise');
    assert.strictEqual(fichier.nom, 'edudoc.csv');

    const csv = fs.readFileSync(path.join(dossierSortie, 'edudoc.csv'), 'utf8');
    assert.strictEqual(csv.charAt(0), '﻿', 'le CSV ne porte pas son BOM UTF-8');
    const lignesCsv = csv.replace(/^﻿/, '').split('\r\n').filter((l) => l !== '');
    assert.strictEqual(lignesCsv.length, 2, 'en-tête + une ligne d’article attendues : ' + lignesCsv.length);

    // 20 colonnes fixes (export-templates/edudoc.twig) + une par auteur·e connu dans
    // l'export (2 ici) ; aucune colonne 690, --numero (racines locales) n'étant pas fourni.
    const enTete = colonnes(lignesCsv[0]);
    const corps = colonnes(lignesCsv[1]);
    assert.strictEqual(enTete.length, 22, 'nombre de colonnes d’en-tête inattendu : ' + lignesCsv[0]);
    assert.strictEqual(corps.length, 22, 'nombre de colonnes de corps inattendu : ' + lignesCsv[1]);
    assert.ok(enTete.indexOf('"7001_a-1"') !== -1 && enTete.indexOf('"7001_a-2"') !== -1,
      'les deux colonnes d’auteur·e·s manquent : ' + lignesCsv[0]);
    assert.ok(corps.indexOf('"Un article du banc CLI"') !== -1, 'le titre n’est pas sorti : ' + lignesCsv[1]);
    fs.rmSync(dossier, { recursive: true, force: true });
  });

test('secretariat-cli.js : commande inconnue -> code de sortie 1, message JSON explicite', () => {
  const r = cp.spawnSync(process.execPath, [CLI, 'inconnue'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  const derniere = String(r.stdout).trim().split(/\r?\n/).pop();
  const obj = JSON.parse(derniere);
  assert.strictEqual(obj.t, 'fin');
  assert.strictEqual(obj.ok, false);
  assert.ok(obj.texte.indexOf('commande inconnue') !== -1,
    'le message ne nomme pas la commande inconnue : ' + obj.texte);
});

test('secretariat-cli.js edudoc : --cache manquant -> code de sortie 1, message explicite', () => {
  const r = cp.spawnSync(process.execPath, [CLI, 'edudoc', '--numeros', '2026-03'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  const derniere = String(r.stdout).trim().split(/\r?\n/).pop();
  const obj = JSON.parse(derniere);
  assert.strictEqual(obj.ok, false);
  assert.ok(obj.texte.indexOf('--cache') !== -1, 'le message ne nomme pas --cache : ' + obj.texte);
});
