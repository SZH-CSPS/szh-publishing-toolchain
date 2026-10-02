// L'aperçu de la date imprimée d'une fiche de Documentation : le formateur de la chaîne
// (szh-commun.lua), lancé par pandoc lua dans le moteur. La saisie part sur stdin, jamais
// dans la ligne de commande, que wsl.exe confie au shell de la distro.
'use strict';

const moteur = require('./moteur');

const SAISIES = new Set(['date', 'date_partielle', 'plage']);
const MAX_EN_VOL = 4;
let enVol = 0;

// former({ saisie, lang, valeurs }, { delaiMs }) -> Promise<{ ok, forme, erreur? } |
// { indisponible: true }>. Ne rejette jamais.
function former(demande, options) {
  const delaiMs = (options && options.delaiMs) || 3000;
  const d = demande || {};
  const saisie = String(d.saisie || '');
  if (!SAISIES.has(saisie) || enVol >= MAX_EN_VOL) { return Promise.resolve({ indisponible: true }); }
  const corps = JSON.stringify({
    saisie: saisie, lang: String(d.lang || 'fr'),
    valeurs: (Array.isArray(d.valeurs) ? d.valeurs : []).map((v) => String(v === undefined || v === null ? '' : v))
  });
  return new Promise((resolve) => {
    let proc;
    try {
      proc = moteur.executer(['pandoc', 'lua', moteur.toolkitMoteur('pipeline', 'filters', 'szh-date-apercu.lua')],
        { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) {
      resolve({ indisponible: true });
      return;
    }
    enVol++;
    const morceaux = [];
    let fini = false;
    const finir = (r) => {
      if (fini) { return; }
      fini = true;
      enVol--;
      clearTimeout(minuteur);
      resolve(r);
    };
    const minuteur = setTimeout(() => {
      try { proc.kill(); } catch (e) { /* déjà mort */ }
      finir({ indisponible: true });
    }, delaiMs);
    proc.on('error', () => finir({ indisponible: true }));
    if (proc.stdout) { proc.stdout.on('data', (b) => morceaux.push(Buffer.from(b))); }
    proc.on('close', (code) => {
      if (code !== 0) { finir({ indisponible: true }); return; }
      let r;
      try { r = JSON.parse(Buffer.concat(morceaux).toString('utf8')); } catch (e) { r = null; }
      if (!r || typeof r.forme !== 'string') { finir({ indisponible: true }); return; }
      const sortie = { ok: true, forme: r.forme };
      if (r.erreur) { sortie.erreur = String(r.erreur); }
      finir(sortie);
    });
    try {
      if (proc.stdin.on) { proc.stdin.on('error', () => finir({ indisponible: true })); }
      proc.stdin.end(corps);
    } catch (e) {
      finir({ indisponible: true });
    }
  });
}

module.exports = { former };
