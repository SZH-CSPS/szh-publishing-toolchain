// szh_commun.requete_http : l'unique requête HTTP du nettoyeur, que manuscrit_biblio._requete
// et manuscrit_identifiants._requete délèguent chacune avec leur User-Agent. Un faux serveur
// local (127.0.0.1, http.server dans un thread) répond : aucun réseau réel.
//
//   node --test test/js/requete-http.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pythonGroupe, sansPython, cheminPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = cheminPython(path.join(RACINE, 'pipeline'));

// Le serveur : /ok rend du JSON et l'écho des en-têtes, /lent dort 2 s, /absent répond 404,
// /texte rend du texte qui n'est pas du JSON.
const PROGRAMME = [
  'import json, sys, threading, time, urllib.error',
  'from http.server import BaseHTTPRequestHandler, HTTPServer',
  'sys.path.insert(0, sys.argv[1])',
  'import szh_commun, manuscrit_biblio, manuscrit_identifiants',
  'class H(BaseHTTPRequestHandler):',
  '    def log_message(self, *a): pass',
  '    def do_GET(self):',
  '        if self.path == "/lent":',
  '            time.sleep(2)',
  '        if self.path == "/absent":',
  '            self.send_response(404); self.end_headers(); return',
  '        corps = (b"ceci n\'est pas du JSON" if self.path == "/texte" else json.dumps({',
  '            "ua": self.headers.get("User-Agent"), "accept": self.headers.get("Accept"),',
  '            "accent": "\u00e9t\u00e9"}).encode("utf-8"))',
  '        self.send_response(200); self.end_headers(); self.wfile.write(corps)',
  'serveur = HTTPServer(("127.0.0.1", 0), H)',
  'threading.Thread(target=serveur.serve_forever, daemon=True).start()',
  'base = "http://127.0.0.1:%d" % serveur.server_port',
  'def essayer(f):',
  '    try:',
  '        return ["ok", f()]',
  '    except urllib.error.HTTPError as e:',
  '        return ["http", e.code]',
  '    except Exception as e:',
  '        return ["exception", type(e).__name__]',
  'r = {}',
  'r["ok"] = essayer(lambda: szh_commun.requete_http(base + "/ok", 5, "UA-essai").decode("utf-8"))',
  'r["delai"] = essayer(lambda: szh_commun.requete_http(base + "/lent", 0.5, "UA-essai"))',
  'r["absent"] = essayer(lambda: szh_commun.requete_http(base + "/absent", 5, "UA-essai"))',
  'r["texte"] = essayer(lambda: szh_commun.requete_http(base + "/texte", 5, "UA-essai").decode("utf-8"))',
  'r["refuse"] = essayer(lambda: szh_commun.requete_http("http://127.0.0.1:1/x", 2, "UA-essai"))',
  'r["biblio"] = essayer(lambda: manuscrit_biblio._requete(base + "/ok", 5).decode("utf-8"))',
  'r["identifiants"] = essayer(lambda: manuscrit_identifiants._requete(base + "/ok", 5).decode("utf-8"))',
  'r["ua_biblio"] = manuscrit_biblio.USER_AGENT',
  'r["ua_identifiants"] = manuscrit_identifiants.USER_AGENT',
  'sys.stdout.buffer.write(json.dumps(r).encode("utf-8"))',
].join('\n');

function lancer() {
  const r = pythonGroupe(['-c', PROGRAMME, PIPELINE], { encoding: 'utf8', timeout: 60000,
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
  assert.strictEqual(r.status, 0, 'python a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

test('requete_http : réussite, en-têtes envoyés, octets rendus tels quels',
  { skip: sansPython }, () => {
    const r = lancer();
    assert.strictEqual(r.ok[0], 'ok');
    const rep = JSON.parse(r.ok[1]);
    assert.strictEqual(rep.ua, 'UA-essai');
    assert.strictEqual(rep.accept, 'application/json');
    assert.strictEqual(rep.accent, 'été');
  });

test('requete_http : délai dépassé, code HTTP et connexion refusée lèvent, rien n\'est avalé',
  { skip: sansPython }, () => {
    const r = lancer();
    assert.strictEqual(r.delai[0], 'exception', 'un délai dépassé doit lever : ' + JSON.stringify(r.delai));
    assert.deepStrictEqual(r.absent, ['http', 404]);
    assert.strictEqual(r.refuse[0], 'exception');
  });

test('requete_http : une réponse qui n\'est pas du JSON est rendue brute, l\'analyse reste à l\'appelant',
  { skip: sansPython }, () => {
    const r = lancer();
    assert.deepStrictEqual(r.texte, ['ok', 'ceci n\'est pas du JSON']);
  });

test('les deux modules délèguent à requete_http avec chacun son User-Agent',
  { skip: sansPython }, () => {
    const r = lancer();
    assert.strictEqual(r.biblio[0], 'ok');
    assert.strictEqual(r.identifiants[0], 'ok');
    assert.strictEqual(JSON.parse(r.biblio[1]).ua, r.ua_biblio);
    assert.strictEqual(JSON.parse(r.identifiants[1]).ua, r.ua_identifiants);
    assert.notStrictEqual(r.ua_biblio, r.ua_identifiants);
  });
