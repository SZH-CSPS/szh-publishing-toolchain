#!/usr/bin/env python3
# Pilote de test/js/pilote-python.js : lit une requête JSON par ligne sur stdin, lance
# `python3 <args>` comme un processus neuf, et rend une réponse JSON par ligne sur stdout.
# Un seul wsl.exe pour tout un fichier de test, au lieu d'un par appel ; chaque appel garde
# son propre interprète, pour que rien ne fuie d'un test à l'autre.
#
# Requête : {"args": [...], "env": {...}, "cwd": "...", "input": "<base64>", "timeout": s}
# Réponse : {"status": n, "signal": null, "stdout": "<base64>", "stderr": "<base64>"}
#           ou {"erreur": "...", "code": "ETIMEDOUT" | "ENOENT" | ...}
import base64
import json
import os
import signal
import subprocess
import sys


def b64(octets):
    return base64.b64encode(octets or b'').decode('ascii')


def executer(req):
    env = dict(os.environ)
    env.update(req.get('env') or {})
    try:
        r = subprocess.run([sys.executable] + list(req['args']),
                           input=base64.b64decode(req.get('input') or ''),
                           capture_output=True, env=env, cwd=req.get('cwd') or None,
                           timeout=req.get('timeout'))
    except subprocess.TimeoutExpired as e:
        return {'erreur': 'délai dépassé', 'code': 'ETIMEDOUT', 'signal': 'SIGTERM',
                'stdout': b64(e.stdout), 'stderr': b64(e.stderr)}
    except OSError as e:
        return {'erreur': str(e), 'code': 'ENOENT' if isinstance(e, FileNotFoundError) else 'EIO'}
    if r.returncode < 0:
        return {'status': None, 'signal': signal.Signals(-r.returncode).name,
                'stdout': b64(r.stdout), 'stderr': b64(r.stderr)}
    return {'status': r.returncode, 'signal': None, 'stdout': b64(r.stdout), 'stderr': b64(r.stderr)}


def principal():
    for ligne in sys.stdin.buffer:
        if not ligne.strip():
            continue
        reponse = executer(json.loads(ligne))
        sys.stdout.buffer.write(json.dumps(reponse).encode('ascii') + b'\n')
        sys.stdout.buffer.flush()


if __name__ == '__main__':
    principal()
