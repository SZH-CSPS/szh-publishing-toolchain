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
| Tableaux markdown | `TakumiI.markdowntable` | navigation Tab, lignes/colonnes (D32) |
| Coller un tableau Excel/Word | `csholmq.excel-to-markdown-table` | Maj+Alt+V (D32) |
| Gestes Word | `yzhang.markdown-all-in-one` | Ctrl+B/I, continuation des listes (D32) |
| Interface DE | `MS-CEINTL.vscode-language-pack-de` | menus natifs en allemand (M4) |

Les deux extensions maison (`szh-csps.szh-apercu`, `szh-csps.szh-cockpit`) ne figurent
**pas** ici : la CI les construit depuis `vscodium-extension/` et les ajoute au manifest.

Optionnel (langue d'interface FR figée — voir README) : `MS-CEINTL.vscode-language-pack-fr`.

### Packs de langue : la version se choisit *sous* celle de l'éditeur

Un pack déclare `engines.vscode: ^1.<minor>.0` et n'est installable qu'à partir de cette
version. Le pack DE est donc pinné en **1.108.0** (compatible VSCodium 1.109 du poste de
référence *et* toutes les versions suivantes) et non en « dernière version » (1.131.0
serait refusée). Installer le pack ne suffit pas : `update.ps1` écrit aussi `"locale"`
dans `%APPDATA%\VSCodium\argv.json` quand la langue d'affichage de Windows est l'allemand.

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
