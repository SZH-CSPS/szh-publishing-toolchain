// Créer un numéro ou un livre depuis le lanceur : les refus et la création restent ceux du
// socle PowerShell (Find-SzhNumeroVolume, Find-SzhLivreReference, new-revue.ps1, new-livre.ps1),
// appelés en un processus qui rend son verdict en une ligne JSON.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { toolkitPoste, cheminSysteme } = require('./poste');

const MARQUE = '@@SZH@@';
const GENRES = ['monographie', 'collectif'];
const MAQUETTES = ['normal', 'falc'];
const FORMATS = ['standard', 'a4'];

// Une chaîne PowerShell entre apostrophes : chaque apostrophe se double, la typographique
// comprise, que PowerShell lit aussi comme un délimiteur.
function litteral(v) {
  return "'" + String(v === undefined || v === null ? '' : v).replace(/['‘’‚‛]/g, '$&$&') + "'";
}
function entier(v) { const n = Number(v); return Number.isInteger(n) ? n : NaN; }

// L'en-tête commun : sortie en UTF-8, socle chargé, et une seule fonction pour rendre le verdict.
function entete(toolkit) {
  return [
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
    'function Out-SzhVerdict($o) { [Console]::Out.WriteLine(' + litteral(MARQUE) + ' + ($o | ConvertTo-Json -Compress -Depth 4)) }',
    '. ' + litteral(path.join(toolkit, 'windows', 'szh-common.ps1'))
  ];
}

// Le script qui crée ce que demande la page, ou null si la demande est mal formée.
function scriptCreation(demande, toolkit) {
  const d = demande || {};
  const jeton = String(d.produit || '');
  const annee = entier(d.annee);
  const windows = path.join(toolkit || toolkitPoste(), 'windows');
  const corps = [];
  if (jeton === 'revue' || jeton === 'zeitschrift') {
    const numero = entier(d.numero);
    const volume = d.volumeManuel ? entier(d.volume) : 0;
    if (!(annee > 0) || !(numero >= 1 && numero <= 99) || Number.isNaN(volume)) { return null; }
    corps.push(
      '$jeton = ' + litteral(jeton),
      '$racine = Get-SzhEmplacementRevue $jeton \'encours\'',
      '$nom = Get-SzhNomNumero ' + annee + ' ' + numero,
      '$cible = Join-Path $racine $nom',
      'if (Test-Path -LiteralPath $cible) { Out-SzhVerdict @{ ok = $false; refus = \'existe\'; nom = $nom }; return }',
      // Le volume se calcule ici quand la page ne l'a pas réglé à la main.
      '$volume = ' + volume,
      'if ($volume -le 0) { $volume = Get-SzhVolumePour $jeton ' + annee + ' }',
      '$deja = Find-SzhNumeroVolume $jeton $volume ' + numero,
      'if ($deja) { Out-SzhVerdict @{ ok = $false; refus = \'doublon\'; volume = $volume; numero = ' + numero +
        '; nom = $deja.nom; chemin = $deja.chemin; archive = [bool]$deja.archive }; return }',
      '& ' + litteral(path.join(windows, 'new-revue.ps1')) + ' -Dossier $cible -Produit $jeton -Annee ' + annee +
        ' -Numero ' + numero + ' -Volume $volume | Out-Null'
    );
  } else if (jeton === 'livre') {
    const reference = entier(d.reference);
    const titre = String(d.titre || '').trim();
    if (!(annee > 0) || !(reference >= 1) || !titre || GENRES.indexOf(d.genre) === -1
      || MAQUETTES.indexOf(d.maquette) === -1 || FORMATS.indexOf(d.format) === -1) { return null; }
    corps.push(
      '$racine = Get-SzhEmplacementRevue \'livre\' \'encours\'',
      '$nom = Get-SzhNomLivre ' + annee + ' ' + reference + ' ' + litteral(titre),
      '$cible = Join-Path $racine $nom',
      'if (Test-Path -LiteralPath $cible) { Out-SzhVerdict @{ ok = $false; refus = \'existe\'; nom = $nom }; return }',
      '$deja = Find-SzhLivreReference ' + reference,
      'if ($deja) { Out-SzhVerdict @{ ok = $false; refus = \'reference\'; reference = ' + reference +
        '; nom = $deja.nom; titre = $deja.titre; chemin = $deja.chemin; archive = [bool]$deja.archive }; return }',
      '& ' + litteral(path.join(windows, 'new-livre.ps1')) + ' -Dossier $cible -Titre ' + litteral(titre) +
        ' -Annee ' + annee + ' -Reference ' + reference + ' -Type ' + litteral(d.genre) +
        ' -Maquette ' + litteral(d.maquette) + ' -Format ' + litteral(d.format) + ' | Out-Null'
    );
  } else {
    return null;
  }
  corps.push('Out-SzhVerdict @{ ok = $true; chemin = (Resolve-Path -LiteralPath $cible).Path }');
  return ['try {'].concat(entete(toolkit || toolkitPoste()), corps,
    ['} catch { Out-SzhVerdict @{ ok = $false; refus = \'erreur\'; texte = $_.Exception.Message } }']).join('\n');
}

// L'année zéro du volume de chaque revue, telle que le socle la déclare.
function scriptAnnees(toolkit) {
  return entete(toolkit || toolkitPoste()).concat([
    'Out-SzhVerdict @{ revue = (Get-SzhPremiereAnnee \'revue\') - 1; zeitschrift = (Get-SzhPremiereAnnee \'zeitschrift\') - 1 }'
  ]).join('\n');
}

function cheminPowerShell() {
  const systeme = cheminSysteme('WindowsPowerShell', 'v1.0', 'powershell.exe');
  try { if (fs.existsSync(systeme)) { return systeme; } } catch (e) { /* PATH en repli */ }
  return 'powershell.exe';
}

// Lance le script et rend son verdict, ou { ok: false, refus: 'erreur', texte } : ne rejette
// jamais. -EncodedCommand évite tout échappement de guillemets sur la ligne de commande.
function executer(script, opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    let fini = false;
    let minuteur = null;
    const finir = (v) => { if (fini) { return; } fini = true; if (minuteur) { clearTimeout(minuteur); } resolve(v); };
    let proc;
    try {
      proc = spawn(o.powershell || cheminPowerShell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: o.env || process.env });
    } catch (e) { finir({ ok: false, refus: 'erreur', texte: String((e && e.message) || e) }); return; }
    const sortie = [];
    const erreurs = [];
    proc.stdout.on('data', (d) => sortie.push(d));
    proc.stderr.on('data', (d) => erreurs.push(d));
    proc.on('error', (e) => finir({ ok: false, refus: 'erreur', texte: String((e && e.message) || e) }));
    proc.on('close', () => {
      const texte = Buffer.concat(sortie).toString('utf8');
      const ligne = texte.split(/\r?\n/).filter((l) => l.indexOf(MARQUE) === 0).pop();
      if (ligne) {
        try { finir(JSON.parse(ligne.slice(MARQUE.length))); return; } catch (e) { /* illisible : ci-dessous */ }
      }
      finir({ ok: false, refus: 'erreur', texte: Buffer.concat(erreurs).toString('utf8').trim().split(/\r?\n/)[0] || '' });
    });
    minuteur = setTimeout(() => {
      try { proc.kill(); } catch (e) { /* déjà fini */ }
      finir({ ok: false, refus: 'delai' });
    }, o.delaiMs || 180000);
  });
}

module.exports = { scriptCreation, scriptAnnees, executer, MARQUE };
