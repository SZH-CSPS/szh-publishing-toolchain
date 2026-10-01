// Le PDF qu'on ne peut pas remplacer (ouvert dans Acrobat côté Windows) : chaque sortie
// paginée par WeasyPrint doit le dire par le constat `[pipeline-blocage] pdf-verrouille`, et
// son journal doit abréger le base64 des images incorporées. Les recettes de la revue et du
// livre passent par la même cascade (weasy_ua, pipeline/Makefile) : ce test le vérifie sur
// la sortie réelle de make, cible par cible.
//
// Ni pandoc ni WeasyPrint ne tournent : le HTML d'entrée est marqué « vieux » (make -o), un
// faux weasyprint écrit un PDF minimal et un avertissement chargé d'une data: URI, et un faux
// mv refuse de remplacer tout .pdf, comme Windows quand le fichier est ouvert.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { sauter, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { DISTRO, cheminWsl } = require(path.join(COCKPIT, 'lib', 'wsl.js'));

function versWsl(chemin) {
  const m = String(chemin).match(/^([A-Za-z]):[\\/](.*)$/);
  if (!m) { return String(chemin).replace(/\\/g, '/'); }
  return '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/');
}
const MAKEFILE = versWsl(path.join(RACINE, 'pipeline', 'Makefile'));

// Le banc : un livre « livre » d'un chapitre, et un numéro de revue d'un article. Tout vit
// dans un mktemp de la distro, effacé à la sortie.
const BANC = String.raw`
set -e
d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
mkdir -p "$d/bin" "$d/livre/chapitres/01-a" "$d/livre/out/chapitres/.seul" \
  "$d/livre/out/couverture" "$d/numero/articles/01-a" "$d/numero/out/01-a"
cat > "$d/bin/mv" <<'FIN'
#!/bin/sh
for a; do dest=$a; done
case "$dest" in *.pdf) echo "mv: impossible de remplacer $dest" >&2; exit 1;; esac
exec /bin/mv "$@"
FIN
cat > "$d/bin/faux-weasyprint" <<'FIN'
#!/bin/sh
for a; do dest=$a; done
echo "WARNING: Failed to load image at data:image/png;base64,$(printf 'A%.0s' $(seq 300)) : essai" >&2
printf '%%PDF-1.7\n' > "$dest"
FIN
chmod +x "$d/bin/mv" "$d/bin/faux-weasyprint"
printf 'title: "Essai"\nmaquette: normal\n' > "$d/livre/buch.yaml"
printf '# A\n' > "$d/livre/chapitres/01-a/01-a.md"
printf 'title: "Essai"\n' > "$d/numero/ausgabe.yaml"
printf 'title: "Essai"\n' > "$d/numero/articles/01-a/01-a.meta.yaml"
printf 'Un paragraphe.\n' > "$d/numero/articles/01-a/01-a.md"
cd "$d/$DOSSIER"
mkdir -p "$(dirname "$HTML")"; : > "$HTML"
set +e
PATH="$d/bin:$PATH" make --no-print-directory -f "$MAKEFILE" \
  WEASYPRINT="$d/bin/faux-weasyprint" -o "$HTML" "$PDF" $EXTRA 2>&1
echo "[code] $?"
ls -a "$(dirname "$PDF")"
`;

function lancer(dossier, html, pdf, extra) {
  const env = 'DOSSIER=' + dossier + ' HTML="' + html + '" PDF="' + pdf + '" EXTRA="'
    + (extra || '') + '" MAKEFILE="' + MAKEFILE + '"';
  const r = spawnSync(cheminWsl(), ['-d', DISTRO, '--', 'bash', '-c', env + ' bash -s'],
    { input: BANC, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert.ok(!r.error, 'wsl.exe : ' + (r.error && r.error.message));
  return String(r.stdout || '') + String(r.stderr || '');
}

const CIBLES = [
  ['revue, PDF d’un article', 'numero', 'out/01-a/01-a.html', 'out/01-a/01-a.pdf', ''],
  ['livre, PDF numérique', 'livre', 'out/livre.html', 'out/livre.pdf', ''],
  ['livre, PDF imprimeur', 'livre', 'out/livre-imprimeur.html', 'out/livre-imprimeur.pdf', ''],
  ['livre, couverture numérique', 'livre', 'out/couverture/livre-couverture.html',
    'out/livre-couverture.pdf', ''],
  ['livre, chapitre seul', 'livre', 'out/chapitres/.seul/01-a.html', 'out/chapitres/01-a.pdf',
    'CHAPITRE=01-a']
];

for (const [nom, dossier, html, pdf, extra] of CIBLES) {
  test('PDF verrouillé (' + nom + ') : constat pdf-verrouille et journal abrégé', (t) => {
    if (sansPandocWsl) { sauter.wsl(t); return; }
    const sortie = lancer(dossier, html, pdf, extra);
    t.diagnostic(sortie);
    assert.match(sortie, /^\[code\] [1-9]/m,
      'make a réussi alors que le PDF n’a pas pu être remplacé');
    assert.ok(sortie.includes('[pipeline-blocage] pdf-verrouille | fichier « ' + pdf + ' »'),
      'aucun constat pdf-verrouille pour ' + pdf + ' : le rédacteur ne lit qu’un échec de mv');
    assert.ok(sortie.includes('… (image incorporée)'),
      'le base64 de la data: URI n’est pas abrégé dans le journal');
    assert.doesNotMatch(sortie, /A{17}/,
      'le journal recopie le base64 entier de l’image incorporée');
    assert.doesNotMatch(sortie, /~\$/, 'le fichier temporaire est resté à côté du PDF');
  });
}
