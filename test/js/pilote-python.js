// Un seul processus WSL pour tous les appels Python d'un fichier de test : test/pilote-python.py
// tourne dans la distro et lance chaque commande comme un processus neuf. L'appel reste
// synchrone, comme spawnSync : un thread de travail parle au pilote, le thread principal
// l'attend par Atomics.wait (seule façon, en Node, d'attendre un processus qui reste ouvert
// sans rendre la main). Ne sert que sous Windows, où chaque wsl.exe coûte un lancement.
'use strict';

const path = require('path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');

const PILOTE = path.join(__dirname, '..', 'pilote-python.py');

const CODE_FIL = `
const { workerData, parentPort } = require('worker_threads');
const { spawn } = require('child_process');
const { signal, port, commande, args } = workerData;
let enfant;
let tampon = '';
let mort = null;
function repondre(rep) {
  port.postMessage(rep);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
}
try {
  enfant = spawn(commande, args, { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  enfant.stdout.setEncoding('utf8');
  enfant.stdout.on('data', (d) => {
    tampon += d;
    let i;
    while ((i = tampon.indexOf('\\n')) >= 0) {
      const ligne = tampon.slice(0, i);
      tampon = tampon.slice(i + 1);
      repondre(JSON.parse(ligne));
    }
  });
  enfant.on('error', (e) => { mort = e.message; repondre({ erreur: e.message, code: 'ENOENT', mort: true }); });
  enfant.on('exit', (code) => { mort = 'pilote sorti (' + code + ')'; repondre({ erreur: mort, code: 'EPIPE', mort: true }); });
} catch (e) {
  mort = e.message;
}
parentPort.on('message', (req) => {
  if (mort) { repondre({ erreur: mort, code: 'EPIPE', mort: true }); return; }
  enfant.stdin.write(JSON.stringify(req) + '\\n');
});
`;

let fil = null;

function demarrer(commande, args) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(CODE_FIL, {
    eval: true, workerData: { signal, port: port2, commande, args }, transferList: [port2]
  });
  worker.unref();
  fil = { signal, port: port1, worker };
}

function erreur(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// `c` : la commande que commandePython() a préparée (args et cwd déjà convertis), `env` : les
// seules variables à poser par-dessus l'environnement du pilote, `o` : les options d'appel.
// Rend la même forme que spawnSync.
function appeler(wslExe, distro, args, env, cwd, o) {
  if (!fil) { demarrer(wslExe, ['-d', distro, '-e', 'python3', require('./gardes').cheminVersWsl(PILOTE)]); }
  const entree = o.input === undefined ? '' : Buffer.from(o.input).toString('base64');
  const req = { args, env, cwd, input: entree, timeout: o.timeout ? o.timeout / 1000 : null };
  Atomics.store(fil.signal, 0, 0);
  fil.worker.postMessage(req);
  // Le pilote borne lui-même un appel qui porte un délai : la marge couvre le transport.
  const attente = Atomics.wait(fil.signal, 0, 0, o.timeout ? o.timeout + 30000 : undefined);
  const recu = attente === 'timed-out' ? null : receiveMessageOnPort(fil.port);
  const rep = recu ? recu.message : { erreur: 'pilote muet', code: 'ETIMEDOUT', mort: true };
  if (rep.mort) { fil.worker.terminate(); fil = null; }
  const encodage = o.encoding === undefined ? 'utf8' : o.encoding;
  const lire = (b64) => {
    const b = Buffer.from(b64 || '', 'base64');
    return (encodage && encodage !== 'buffer') ? b.toString(encodage) : b;
  };
  const stdout = lire(rep.stdout);
  const stderr = lire(rep.stderr);
  const r = { pid: 0, output: [null, stdout, stderr], stdout, stderr,
    status: rep.status === undefined ? null : rep.status, signal: rep.signal || null };
  if (rep.erreur) { r.error = erreur(rep.code, 'pilote Python : ' + rep.erreur); }
  return r;
}

module.exports = { appeler, PILOTE };
