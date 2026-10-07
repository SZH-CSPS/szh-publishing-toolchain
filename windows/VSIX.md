# Extensions VSCodium épinglées (`vsix.lock`)

Les extensions tierces des postes ont une version fixe, vérifiée par son empreinte. Une
extension ne change donc que lorsqu'on modifie ce fichier. Cela protège des extensions
piégées publiées sur Open VSX. La mise à jour automatique des extensions est désactivée
(`"extensions.autoUpdate": false` dans
[`vscodium-user/settings.json`](../vscodium-user/settings.json)).

[`vsix.lock`](vsix.lock) donne pour chaque extension `id`, `version`, `sha256` et `source`
(l'URL Open VSX).

## Le trajet d'une extension

1. La CI ([`release.yml`](../.github/workflows/release.yml)) télécharge chaque VSIX, vérifie
   son empreinte et le publie avec la version de Pronto. Elle l'inscrit dans
   `manifest.json`.
2. `update.ps1` installe par `codium --install-extension` chaque extension dont la version
   installée diffère de celle du manifest, après avoir vérifié l'empreinte.

Les deux extensions maison (`szh-csps.szh-apercu`, `szh-csps.szh-cockpit`) ne sont pas dans
`vsix.lock`. La CI les construit depuis `vscodium-extension/` et les ajoute au manifest avec
l'empreinte calculée au moment de la construction.

## Extensions épinglées

| Extension | ID | Rôle |
|---|---|---|
| Aperçu PDF | `tomoki1207.pdf` | affiche le PDF dans l'éditeur |
| Compilation à l'enregistrement | `Gruntfuggly.triggertaskonsave` | Ctrl+S lance la tâche « Aperçu / Export PDF » |
| Correcteur orthographique | `streetsidesoftware.code-spell-checker` | base cSpell |
| Dictionnaire français | `streetsidesoftware.code-spell-checker-french` | |
| Dictionnaire suisse allemand | `streetsidesoftware.code-spell-checker-swiss-german` | |
| Tableaux Markdown | `TakumiI.markdowntable` | Tab pour naviguer, ajout de lignes et de colonnes |
| Raccourcis d'édition | `yzhang.markdown-all-in-one` | Ctrl+B, Ctrl+I, suite automatique des listes |
| Interface allemande | `MS-CEINTL.vscode-language-pack-de` | menus de VSCodium en allemand |

## Packs de langue

Un pack de langue déclare `engines.vscode: ^1.<minor>.0` et ne s'installe que sur cette
version de l'éditeur ou une plus récente. On épingle donc une version de pack inférieure ou
égale à celle de VSCodium dans [`apps.lock`](apps.lock), et non la dernière parue.

Le pack ne suffit pas : quand la langue du poste est l'allemand, `update.ps1` écrit aussi
`"locale": "de"` dans `%APPDATA%\VSCodium\argv.json`.

## Monter une extension de version

1. Vérifier la page Open VSX : éditeur, ancienneté de la version, nom proche d'une extension
   connue (typosquat).
2. Calculer l'empreinte :
   ```powershell
   $v = 'X.Y.Z' ; $e = 'namespace/nom'
   $f = "$env:TEMP\ext.vsix"
   Invoke-WebRequest "https://open-vsx.org/api/$e/$v/file/$($e -replace '/','.')-$v.vsix" -OutFile $f
   (Get-FileHash $f -Algorithm SHA256).Hash.ToLower()
   ```
3. Mettre à jour `version`, `sha256` et `source` dans `vsix.lock`.
4. Publier une version de Pronto. La CI échoue si l'empreinte ne correspond pas.
