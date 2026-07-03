# Extensions VSCodium épinglées (`vsix.lock`)

On ne tire **jamais** « latest » au runtime (auto-update désactivé sur les postes) —
mitigation directe des campagnes type GlassWorm sur Open VSX (D11, PLANIFICATION.md).

Le fichier [`vsix.lock`](vsix.lock) est la source de vérité : pour chaque extension,
`id` + `version` + `sha256` + `source` (URL Open VSX). La CI (`release.yml`) télécharge
chaque VSIX, **vérifie l'empreinte**, et le publie en asset de release ; `update.ps1`
l'installe ensuite sur les postes via `codium --install-extension`.

## Extensions retenues

| Extension | ID | Rôle |
|---|---|---|
| Aperçu PDF | `tomoki1207.pdf` | volet PDF dans l'éditeur |
| Build à la sauvegarde | `Gruntfuggly.triggertaskonsave` | Ctrl+S → make pdf |
| Correcteur orthographique | `streetsidesoftware.code-spell-checker` | base cSpell |
| Dictionnaire FR | `streetsidesoftware.code-spell-checker-french` | |
| Dictionnaire DE (Suisse) | `streetsidesoftware.code-spell-checker-swiss-german` | |

Optionnel (langue d'interface FR figée — voir README) : `MS-CEINTL.vscode-language-pack-fr`.

## Bumper une extension (décision explicite, jamais automatique)

1. Vérifier la page Open VSX (éditeur, âge de la version, absence de typosquat).
2. Calculer la nouvelle empreinte :
   ```powershell
   $v = 'X.Y.Z' ; $e = 'namespace/nom'
   $f = "$env:TEMP\ext.vsix"
   Invoke-WebRequest "https://open-vsx.org/api/$e/$v/file/$($e -replace '/','.')-$v.vsix" -OutFile $f
   (Get-FileHash $f -Algorithm SHA256).Hash.ToLower()
   ```
3. Mettre à jour `version`, `sha256` (et `source`) dans `vsix.lock`.
4. Tagger une release : la CI refuse de publier si l'empreinte ne correspond pas.
