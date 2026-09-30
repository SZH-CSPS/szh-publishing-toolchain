// pipeline/manuscrit_identifiants.py — ROR et ORCID des autrices et auteurs (contrat §5.5
// sexies), et leur écriture « à vérifier » par manuscrit_gabarit. Module pur, appelé depuis le
// Python de Windows (PYTHON de gardes.js).
//
//   node --test test/js/manuscrit-identifiants.test.js
//
// Le réseau n'est JAMAIS appelé ici : chaque programme Python remplace
// manuscrit_identifiants._requete par une fonction qui répond depuis un petit annuaire
// (FAUX) et compte ses appels. Les réponses imitent ce qui a été mesuré sur api.ror.org et
// pub.orcid.org (item `chosen`, expanded-result, institution-name).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');
const GABARIT_FR = path.join(RACINE, 'revue-template', "Pronto - modele d'article_FR.docx");
const GABARIT_DE = path.join(RACINE, 'revue-template', "Pronto - modele d'article_DE.docx");
const PRONTO_LIRE = path.join(PIPELINE, 'pronto-lire.py');
const ENV_UTF8 = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });

function python(programme, args) {
  return cp.spawnSync(PYTHON, ['-c', programme].concat(args || []), {
    encoding: 'utf8', env: ENV_UTF8, maxBuffer: 1024 * 1024 * 16,
  });
}

// L'annuaire : ROR par texte d'affiliation, ORCID par nom de famille, /person par identifiant.
// `REQUETES` garde chaque url demandée ; MODE_PANNE='urlerror' simule un réseau coupé.
const PREAMBULE = `
import sys, os, json, urllib.error, urllib.parse
sys.path.insert(0, ${JSON.stringify(PIPELINE)})
import manuscrit_identifiants as mi

def org(ident, *noms):
    return {'id': ident, 'names': [{'value': n, 'types': ['ror_display', 'label'] if i == 0 else ['label']}
                                   for i, n in enumerate(noms)]}

GENEVE = org('https://ror.org/01swzsf04', 'University of Geneva', 'Université de Genève')
HFH = org('https://ror.org/05dqxp497', 'Interkantonale Hochschule für Heilpädagogik',
          'University of Teacher Education in Special Needs')

ROR = {
    'Université de Genève': [{'chosen': True, 'organization': GENEVE}],
    'Haute école fantôme': [{'chosen': False, 'organization': org('https://ror.org/0aaaaaa11', 'Autre école')}],
    'Interkantonale Hochschule für Heilpädagogik': [{'chosen': True, 'organization': HFH}],
    'HfH Zürich': [{'chosen': False, 'organization': org('https://ror.org/0bbbbbb22', 'PH Zürich')}],
}

def res(orcid, prenoms, famille, *insts):
    return {'orcid-id': orcid, 'given-names': prenoms, 'family-names': famille,
            'institution-name': list(insts)}

ORCID = {
    'Lanfranchi': [
        res('0000-0002-1825-0097', 'Andrea', 'Lanfranchi', 'University of Zurich'),
        res('0000-0002-1694-233X', 'Andrea', 'Lanfranchi', 'University of Teacher Education in Special Needs'),
        res('0000-0001-5109-3700', 'Andrea', 'Lanfranchi'),
    ],
    'Egger': [res('0000-0002-1825-0097', 'Barbara', 'Egger', 'Agroscope')],
    'Dupont': [res('0000-0002-1825-0097', 'Jean-Pierre', 'Dupont', 'Université de Genève'),
               res('0000-0002-1694-233X', 'Jean', 'Dupond', 'Université de Genève')],
    'Inclus': [res('0000-0002-1825-0097', 'Luc', 'Inclus', 'Haute école pédagogique')],
    'Ratio': [res('0000-0002-1825-0097', 'Luc', 'Ratio', 'Pädagogische Hochschule Zürich')],
    'Court': [res('0000-0002-1825-0097', 'Luc', 'Court', 'HfH')],
    'Jumeaux': [res('0000-0002-1825-0097', 'Ana', 'Jumeaux', 'Université de Genève'),
                res('0000-0002-1694-233X', 'Ana', 'Jumeaux', 'Universite de Geneve')],
}

PERSON = {'0000-0002-1825-0097': ('Josiah', 'Carberry'), '0000-0002-1694-233X': ('Andrea', 'Lanfranchi')}

REQUETES = []
MODE_PANNE = None

def faux(url, delai):
    REQUETES.append(url)
    if MODE_PANNE == 'urlerror':
        raise urllib.error.URLError('hors ligne')
    if url.startswith(mi.ROR_BASE):
        q = urllib.parse.unquote(url.split('affiliation=')[1])
        return json.dumps({'items': ROR.get(q, [])}).encode()
    if '/expanded-search/' in url:
        q = urllib.parse.unquote(url.split('?q=')[1])
        famille = q.split('family-name:"')[1].split('"')[0]
        r = ORCID.get(famille, [])
        return json.dumps({'num-found': len(r), 'expanded-result': r}).encode()
    if url.endswith('/person'):
        ident = url.split('/')[-2]
        if ident == '0000-0003-0000-0003':
            raise urllib.error.HTTPError(url, 404, 'nf', {}, None)
        if ident not in PERSON:
            return json.dumps({'name': None}).encode()
        p, f = PERSON[ident]
        return json.dumps({'name': {'given-names': {'value': p}, 'family-name': {'value': f}}}).encode()
    raise AssertionError('url inattendue ' + url)

mi._requete = faux

def auteur(**kw):
    a = {'prenom': '', 'nom': '', 'fonction': '', 'institution': '', 'email': '', 'orcid': '',
         'texte_source': '', 'ror': '', 'a_verifier': []}
    a.update(kw)
    return a
`;

function executer(corps) {
  const r = python(PREAMBULE + '\n' + corps, []);
  assert.strictEqual(r.status, 0, 'le script Python a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------------------------
// Clé ORCID — sans réseau.

test('orcid_cle_valide : ISO 7064 mod 11-2, X compris, faute de frappe refusée', { skip: sansPython }, () => {
  const r = executer(`
print(json.dumps([mi.orcid_cle_valide(x) for x in (
    '0000-0002-1825-0097', '0000-0002-1694-233X', '0000-0002-1825-0098', '0000-0002-1694-2330',
    '0000-0002-1825', 'abcd-0002-1825-0097')]))`);
  assert.deepStrictEqual(r, [true, true, false, false, false, false]);
});

test('ORCID du manuscrit à clé fausse : alerte OrcidInvalide (warning), valeur jamais touchée, même sans réseau',
  { skip: sansPython }, () => {
    const r = executer(`
a = auteur(prenom='Jean', nom='Dupont', orcid='0000-0002-1825-0098', institution='Université de Genève')
alertes, stats = mi.enrichir_auteurs([a], 'fr', reseau=False)
print(json.dumps({'a': a, 'alertes': alertes, 'stats': stats, 'requetes': REQUETES}))`);
    assert.strictEqual(r.a.orcid, '0000-0002-1825-0098');
    assert.strictEqual(r.alertes.length, 1);
    assert.strictEqual(r.alertes[0].rule, 'Identifiants.OrcidInvalide');
    assert.strictEqual(r.alertes[0].severity, 'warning');
    assert.deepStrictEqual(r.requetes, []);
    assert.strictEqual(r.stats.orcid_invalides, 1);
  });

// ---------------------------------------------------------------------------------
// ROR.

test('ROR : seul l\'item chosen est retenu, forme URL, marqué à vérifier, alerte RorPropose à huit champs',
  { skip: sansPython }, () => {
    const r = executer(`
a = auteur(prenom='Jean', nom='Zzz', institution='Université de Genève')
alertes, stats = mi.enrichir_auteurs([a], 'fr')
print(json.dumps({'a': a, 'alertes': alertes, 'stats': stats}))`);
    assert.strictEqual(r.a.ror, 'https://ror.org/01swzsf04');
    assert.deepStrictEqual(r.a.a_verifier, ['ror']);
    assert.strictEqual(r.stats.ror_trouves, 1);
    const al = r.alertes.find((x) => x.rule === 'Identifiants.RorPropose');
    assert.ok(al);
    assert.deepStrictEqual(Object.keys(al).sort(),
      ['action', 'found', 'message', 'para', 'rule', 'severity', 'span', 'suggested']);
    assert.strictEqual(al.severity, 'suggestion');
    assert.strictEqual(al.action, 'report');
    assert.strictEqual(al.para, null);
    assert.match(al.message, /https:\/\/ror\.org\/01swzsf04/);
    assert.match(al.message, /University of Geneva/);
    assert.match(al.message, /à vérifier/);
  });

test('ROR : aucun item chosen -> rien, même si un item non choisi existe (HfH Zürich -> PH Zürich)',
  { skip: sansPython }, () => {
    const r = executer(`
a = auteur(prenom='Jean', nom='Zzz', institution='HfH Zürich')
b = auteur(prenom='Jean', nom='Zzz', institution='Haute école fantôme')
alertes, stats = mi.enrichir_auteurs([a, b], 'fr')
print(json.dumps({'a': a, 'b': b, 'alertes': alertes, 'stats': stats}))`);
    assert.strictEqual(r.a.ror, '');
    assert.strictEqual(r.b.ror, '');
    assert.deepStrictEqual(r.alertes.filter((x) => x.rule === 'Identifiants.RorPropose'), []);
    assert.strictEqual(r.stats.ror_trouves, 0);
  });

test('ROR : un ROR déjà connu ou sans institution ne déclenche aucune requête ROR ; cache par institution',
  { skip: sansPython }, () => {
    const r = executer(`
connu = auteur(prenom='A', nom='Zzz', institution='Université de Genève', ror='https://ror.org/0xxxxxx99')
vide = auteur(prenom='B', nom='Zzz')
x1 = auteur(prenom='C', nom='Zzz', institution='Université de Genève')
x2 = auteur(prenom='D', nom='Zzz', institution='Université de Genève')
mi.enrichir_auteurs([connu, vide, x1, x2], 'fr')
print(json.dumps({'connu': connu['ror'], 'x1': x1['ror'], 'x2': x2['ror'],
    'nb_ror': sum(1 for u in REQUETES if u.startswith(mi.ROR_BASE))}))`);
    assert.strictEqual(r.connu, 'https://ror.org/0xxxxxx99');
    assert.strictEqual(r.x1, 'https://ror.org/01swzsf04');
    assert.strictEqual(r.x2, 'https://ror.org/01swzsf04');
    assert.strictEqual(r.nb_ror, 1, 'une seule requête pour trois auteurs de la même institution');
  });

// ---------------------------------------------------------------------------------
// ORCID par nom.

test('ORCID : Lanfranchi, trois résultats dont un seul rattaché à la HfH (nom ROR) -> retenu, à vérifier',
  { skip: sansPython }, () => {
    const r = executer(`
a = auteur(prenom='Andrea', nom='Lanfranchi', institution='Interkantonale Hochschule für Heilpädagogik')
alertes, stats = mi.enrichir_auteurs([a], 'fr')
print(json.dumps({'a': a, 'alertes': alertes, 'stats': stats}))`);
    assert.strictEqual(r.a.orcid, '0000-0002-1694-233X');
    assert.deepStrictEqual(r.a.a_verifier.sort(), ['orcid', 'ror']);
    assert.strictEqual(r.stats.orcid_trouves, 1);
    assert.ok(r.alertes.some((x) => x.rule === 'Identifiants.OrcidPropose'));
  });

test('ORCID : concordance d\'institution par inclusion (>= 8 caractères) ou ratio >= 0,85, jamais par un sigle court',
  { skip: sansPython }, () => {
    const r = executer(`
inclus = auteur(prenom='Luc', nom='Inclus', institution='Haute école pédagogique du canton de Vaud')
ratio = auteur(prenom='Luc', nom='Ratio', institution='Paedagogische Hochschule Zuerich')
court = auteur(prenom='Luc', nom='Court', institution='HfH Zürich')
alertes, stats = mi.enrichir_auteurs([inclus, ratio, court], 'fr')
print(json.dumps({'inclus': inclus['orcid'], 'ratio': ratio['orcid'], 'court': court['orcid'],
                  'candidats': stats['orcid_candidats']}))`);
    assert.strictEqual(r.inclus, '0000-0002-1825-0097');
    assert.strictEqual(r.ratio, '0000-0002-1825-0097');
    assert.strictEqual(r.court, '', '« HfH » (3 caractères) ne vaut pas une inclusion');
    assert.strictEqual(r.candidats, 1, 'le cas court reste un candidat possible');
  });

test('ORCID : Egger, résultat unique mais rattaché à une autre institution -> NON rempli, alerte OrcidCandidat',
  { skip: sansPython }, () => {
    const r = executer(`
a = auteur(prenom='Barbara', nom='Egger', institution='Interkantonale Hochschule für Heilpädagogik')
alertes, stats = mi.enrichir_auteurs([a], 'fr')
print(json.dumps({'a': a, 'alertes': alertes, 'stats': stats}))`);
    assert.strictEqual(r.a.orcid, '');
    assert.ok(!r.a.a_verifier.includes('orcid'));
    const al = r.alertes.find((x) => x.rule === 'Identifiants.OrcidCandidat');
    assert.ok(al, 'un candidat possible doit être signalé');
    assert.match(al.message, /0000-0002-1825-0097/);
    assert.strictEqual(r.stats.orcid_candidats, 1);
    assert.strictEqual(r.stats.orcid_trouves, 0);
  });

test('ORCID : homonyme de nom différent ou de prénom différent écarté (Dupond/Dupont, Jean/Jean-Pierre)',
  { skip: sansPython }, () => {
    const r = executer(`
# Jean-Pierre Dupont : le candidat « Jean-Pierre » a le même premier prénom aplati ET la même
# institution ; « Jean Dupond » a un autre nom de famille et ne compte pas.
a = auteur(prenom='Jean-Pierre', nom='Dupont', institution='Université de Genève')
b = auteur(prenom='Jean', nom='Dupont', institution='Université de Genève')
mi.enrichir_auteurs([a, b], 'fr')
print(json.dumps({'a': a['orcid'], 'b': b['orcid']}))`);
    assert.strictEqual(r.a, '0000-0002-1825-0097');
    assert.strictEqual(r.b, '', 'premier prénom « Jean » != « Jeanpierre » : aucun candidat');
  });

test('ORCID : deux candidats qui passent nom + institution -> ambigu, rien n\'est rempli',
  { skip: sansPython }, () => {
    const r = executer(`
a = auteur(prenom='Ana', nom='Jumeaux', institution='Université de Genève')
alertes, stats = mi.enrichir_auteurs([a], 'fr')
print(json.dumps({'a': a, 'alertes': alertes}))`);
    assert.strictEqual(r.a.orcid, '');
    assert.deepStrictEqual(r.alertes.filter((x) => /Orcid/.test(x.rule)), []);
  });

test('ORCID du manuscrit : jamais remplacé, aucune recherche par nom ; nom divergent -> OrcidNomDivergent',
  { skip: sansPython }, () => {
    const r = executer(`
a = auteur(prenom='Andrea', nom='Lanfranchi', orcid='0000-0002-1825-0097')
alertes, stats = mi.enrichir_auteurs([a], 'fr')
print(json.dumps({'a': a, 'alertes': alertes, 'stats': stats,
    'recherches': [u for u in REQUETES if '/expanded-search/' in u]}))`);
    assert.strictEqual(r.a.orcid, '0000-0002-1825-0097');
    assert.deepStrictEqual(r.recherches, []);
    const al = r.alertes.find((x) => x.rule === 'Identifiants.OrcidNomDivergent');
    assert.ok(al);
    assert.strictEqual(al.severity, 'warning');
    assert.match(al.message, /Josiah Carberry/);
    assert.deepStrictEqual(r.a.a_verifier, [], 'une valeur lue dans le manuscrit n\'est pas « à vérifier »');
  });

test('ORCID du manuscrit : le nom de famille seul ou le prénom seul qui diverge suffit à avertir',
  { skip: sansPython }, () => {
    const r = executer(`
famille = auteur(prenom='Andrea', nom='Meier', orcid='0000-0002-1694-233X')
prenom = auteur(prenom='Anna', nom='Lanfranchi', orcid='0000-0002-1694-233X')
a1, _ = mi.enrichir_auteurs([famille], 'fr')
a2, _ = mi.enrichir_auteurs([prenom], 'fr')
print(json.dumps({'famille': a1, 'prenom': a2}))`);
    assert.deepStrictEqual(r.famille.map((x) => x.rule), ['Identifiants.OrcidNomDivergent']);
    assert.deepStrictEqual(r.prenom.map((x) => x.rule), ['Identifiants.OrcidNomDivergent']);
  });

test('ORCID du manuscrit dont le nom concorde : aucune alerte ; identifiant inconnu d\'ORCID (404) -> OrcidInvalide',
  { skip: sansPython }, () => {
    const r = executer(`
ok = auteur(prenom='Andrea', nom='Lanfranchi', orcid='0000-0002-1694-233X')
al_ok, _ = mi.enrichir_auteurs([ok], 'fr')
absent = auteur(prenom='X', nom='Y', orcid='0000-0003-0000-0003')
al_abs, st = mi.enrichir_auteurs([absent], 'fr')
print(json.dumps({'ok': al_ok, 'absent': al_abs, 'cle': mi.orcid_cle_valide('0000-0003-0000-0003'),
                  'orcid': absent['orcid']}))`);
    assert.deepStrictEqual(r.ok, []);
    assert.strictEqual(r.cle, true, 'le 404 doit venir du réseau, pas de la clé');
    assert.strictEqual(r.absent.length, 1);
    assert.strictEqual(r.absent[0].rule, 'Identifiants.OrcidInvalide');
    assert.strictEqual(r.orcid, '0000-0003-0000-0003', 'valeur donnée par l\'auteur jamais retirée');
  });

// ---------------------------------------------------------------------------------
// Réseau facultatif.

test('--sans-reseau (reseau=False) : aucun appel, rien de rempli', { skip: sansPython }, () => {
  const r = executer(`
a = auteur(prenom='Andrea', nom='Lanfranchi', institution='Interkantonale Hochschule für Heilpädagogik')
alertes, stats = mi.enrichir_auteurs([a], 'fr', reseau=False)
print(json.dumps({'a': a, 'alertes': alertes, 'stats': stats, 'requetes': REQUETES}))`);
  assert.deepStrictEqual(r.requetes, []);
  assert.strictEqual(r.a.ror, '');
  assert.strictEqual(r.a.orcid, '');
  assert.deepStrictEqual(r.alertes, []);
  assert.strictEqual(r.stats.reseau, false);
});

test('panne réseau : aucune exception, rien de rempli, indisponible compté, un service en panne n\'est plus sollicité',
  { skip: sansPython }, () => {
    const r = executer(`
MODE_PANNE = 'urlerror'
auteurs = [auteur(prenom='Andrea', nom='Lanfranchi', institution='Interkantonale Hochschule für Heilpädagogik'),
           auteur(prenom='Barbara', nom='Egger', institution='Université de Genève')]
alertes, stats = mi.enrichir_auteurs(auteurs, 'fr')
print(json.dumps({'auteurs': auteurs, 'alertes': alertes, 'stats': stats, 'requetes': len(REQUETES)}))`);
    for (const a of r.auteurs) {
      assert.strictEqual(a.ror, '');
      assert.strictEqual(a.orcid, '');
      assert.deepStrictEqual(a.a_verifier, []);
    }
    assert.deepStrictEqual(r.alertes, []);
    assert.strictEqual(r.stats.indisponible, 2, 'une panne par service (ROR, ORCID), puis plus rien');
    assert.strictEqual(r.requetes, 2);
  });

test('une réponse illisible vaut une panne, pas une exception', { skip: sansPython }, () => {
  const r = executer(`
mi._requete = lambda url, delai: b'<html>pas du json</html>'
a = auteur(prenom='Andrea', nom='Lanfranchi', institution='Université de Genève')
alertes, stats = mi.enrichir_auteurs([a], 'fr')
print(json.dumps({'a': a, 'stats': stats}))`);
  assert.strictEqual(r.a.ror, '');
  assert.ok(r.stats.indisponible >= 1);
});

test('un champ déjà rempli n\'est jamais écrasé (ror donné, orcid donné)', { skip: sansPython }, () => {
  const r = executer(`
a = auteur(prenom='Andrea', nom='Lanfranchi', institution='Interkantonale Hochschule für Heilpädagogik',
           ror='https://ror.org/0donne11', orcid='0000-0002-1694-233X')
mi.enrichir_auteurs([a], 'fr')
print(json.dumps(a))`);
  assert.strictEqual(r.ror, 'https://ror.org/0donne11');
  assert.strictEqual(r.orcid, '0000-0002-1694-233X');
  assert.deepStrictEqual(r.a_verifier, []);
});

test('alertes en allemand côté Zeitschrift', { skip: sansPython }, () => {
  const r = executer(`
a = auteur(prenom='Andrea', nom='Lanfranchi', institution='Interkantonale Hochschule für Heilpädagogik')
b = auteur(prenom='Barbara', nom='Egger', institution='Interkantonale Hochschule für Heilpädagogik')
alertes, _ = mi.enrichir_auteurs([a, b], 'de')
print(json.dumps(alertes))`);
  const regles = r.map((x) => x.rule).sort();
  assert.deepStrictEqual(regles, ['Identifiants.OrcidCandidat', 'Identifiants.OrcidPropose',
    'Identifiants.RorPropose', 'Identifiants.RorPropose']);
  for (const al of r) { assert.match(al.message, /bitte prüfen|Vorschlag|Möglicher/); }
});

// ---------------------------------------------------------------------------------
// Écriture « à vérifier » par manuscrit_gabarit : révision suivie, ids, XML, import réel.

const ECRIRE = `
import sys, json, zipfile
sys.path.insert(0, ${JSON.stringify(PIPELINE)})
import manuscrit_modele as mm, manuscrit_entete as me, manuscrit_gabarit as mg
gabarit, sortie, langue = sys.argv[1], sys.argv[2], sys.argv[3]
a = me._nouvel_auteur('Andrea', 'Lanfranchi', 'x')
a.update({'institution': 'Interkantonale Hochschule für Heilpädagogik', 'email': 'a@hfh.ch',
          'orcid': '0000-0002-1694-233X', 'ror': 'https://ror.org/05dqxp497',
          'a_verifier': ['ror', 'orcid']})
b = me._nouvel_auteur('Marie', 'Curie', 'y')
b.update({'orcid': '0000-0002-1825-0097'})
entete = me.EnTete(titre='T', auteurs=[a, b], langue_produit=langue)
doc = mm.document_depuis_json({'blocs': [{'fragments': [{'texte': 'Corps.'}]}]})
mg.ecrire(doc, gabarit, sortie, decisions=None, entete=entete, langue=langue)
`;

function ecrireFiche(gabarit, langue) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-identifiants-'));
  const sortie = path.join(base, 'sortie.docx');
  const r = python(ECRIRE, [gabarit, sortie, langue]);
  assert.strictEqual(r.status, 0, 'ecrire() a échoué : ' + r.stderr);
  const lire = python('import sys, zipfile\nsys.stdout.write(zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode("utf-8"))',
    [sortie]);
  return { base, sortie, xml: lire.stdout };
}

test('gabarit : ROR et ORCID trouvés écrits en w:ins (auteur FR), le reste en run simple, ids uniques, XML bien formé',
  { skip: sansPython }, () => {
    const { base, sortie, xml } = ecrireFiche(GABARIT_FR, 'fr');
    try {
      const ins = [...xml.matchAll(/<w:ins w:id="(\d+)" w:author="([^"]+)" w:date="[^"]+">(.*?)<\/w:ins>/g)];
      assert.strictEqual(ins.length, 2, 'un w:ins pour le ROR, un pour l\'ORCID (le second auteur n\'en a pas)');
      assert.ok(ins.every((m) => m[2] === 'Recherche ROR/ORCID — à vérifier'));
      assert.match(ins[0][3], /https:\/\/ror\.org\/05dqxp497/);
      assert.match(ins[1][3], /0000-0002-1694-233X/);
      // l'e-mail (lu dans le manuscrit) et l'ORCID de Marie Curie restent des runs simples
      assert.match(xml, /<w:r><w:t xml:space="preserve">a@hfh\.ch<\/w:t><\/w:r>/);
      assert.match(xml, /<w:r><w:t xml:space="preserve">0000-0002-1825-0097<\/w:t><\/w:r>/);
      assert.ok(!xml.includes('SZH-ID-A-RENUMEROTER'), 'aucun id provisoire ne doit survivre');
      const ids = [...xml.matchAll(/\bw:id="(\d+)"/g)].map((m) => m[1]);
      assert.strictEqual(new Set(ids).size, ids.length, 'w:id uniques dans document.xml');

      const verif = python('import sys, zipfile, xml.dom.minidom\nz = zipfile.ZipFile(sys.argv[1])\n'
        + 'for n in z.namelist():\n  if n.endswith(".xml") or n.endswith(".rels"): xml.dom.minidom.parseString(z.read(n))\nprint("ok")',
        [sortie]);
      assert.strictEqual(verif.status, 0, verif.stderr);

      // L'import Word relit le texte inséré (texte_paragraphe itère sur tous les w:r).
      const dossierPronto = path.join(base, 'pronto');
      fs.mkdirSync(dossierPronto);
      const lu = cp.spawnSync(PYTHON, [PRONTO_LIRE, sortie, 'essai', dossierPronto],
        { encoding: 'utf8', env: Object.assign({}, ENV_UTF8, { SZH_PRODUIT: 'revue' }) });
      assert.strictEqual(lu.status, 0, lu.stderr);
      const meta = fs.readFileSync(path.join(dossierPronto, 'essai.meta.yaml'), 'utf8');
      assert.match(meta, /ror: "https:\/\/ror\.org\/05dqxp497"/);
      assert.match(meta, /orcid: "0000-0002-1694-233X"/);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('gabarit : auteur de révision allemand côté Zeitschrift', { skip: sansPython }, () => {
  const { base, xml } = ecrireFiche(GABARIT_DE, 'de');
  try {
    const auteurs = [...xml.matchAll(/<w:ins w:id="\d+" w:author="([^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(auteurs.length, 2);
    assert.ok(auteurs.every((a) => a === 'ROR/ORCID-Suche — bitte prüfen'));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('gabarit : les w:id des révisions d\'identifiants ne collent pas avec ceux que manuscrit_annoter pose ensuite',
  { skip: sansPython }, () => {
    const { base, sortie } = ecrireFiche(GABARIT_FR, 'fr');
    try {
      const r = python(`
import sys, zipfile, re
sys.path.insert(0, ${JSON.stringify(PIPELINE)})
import manuscrit_annoter as ma
xml = zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode('utf-8')
existants = [int(m) for m in re.findall(r'\\bw:id="(\\d+)"', xml)]
print(ma._proximo_contador(xml, None, None) - max(existants))`, [sortie]);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(r.stdout.trim(), '1', 'le premier id libre suit le plus grand id écrit');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
