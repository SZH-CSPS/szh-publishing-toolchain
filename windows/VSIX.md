# Extensions VSCodium épinglées (`vsix.lock`)

On ne tire jamais « latest » à l'exécution, et la mise à jour automatique est désactivée
sur les postes : c'est la parade aux campagnes de type GlassWorm sur Open VSX.

[`vsix.lock`](vsix.lock) est la source de vérité : `id`, `version`, `sha256` et `source`
(URL Open VSX) par extension. La CI télécharge chaque VSIX, vérifie son empreinte et le
publie en asset de release ; `update.ps1` l'installe par `codium --install-extension`.

## Extensions retenues

| Extension | ID | Rôle |
|---|---|---|
| Aperçu PDF | `tomoki1207.pdf` | volet PDF dans l'éditeur |
| Build à la sauvegarde | `Gruntfuggly.triggertaskonsave` | Ctrl+S → make pdf |
| Correcteur orthographique | `streetsidesoftware.code-spell-checker` | base cSpell |
| Dictionnaire FR | `streetsidesoftware.code-spell-checker-french` | |
| Dictionnaire DE (Suisse) | `streetsidesoftware.code-spell-checker-swiss-german` | |
| Tableaux markdown | `TakumiI.markdowntable` | navigation Tab, lignes et colonnes |
| Gestes Word | `yzhang.markdown-all-in-one` | Ctrl+B, Ctrl+I, continuation des listes |
| Interface DE | `MS-CEINTL.vscode-language-pack-de` | menus natifs en allemand |

Les deux extensions maison (`szh-csps.szh-apercu`, `szh-csps.szh-cockpit`) ne figurent pas
ici : la CI les construit depuis `vscodium-extension/` et les ajoute au manifest.

Facultatif, pour une interface en français : `MS-CEINTL.vscode-language-pack-fr`.

### Packs de langue : la version se choisit *sous* celle de l'éditeur

Un pack déclare `engines.vscode: ^1.<minor>.0` et ne s'installe qu'à partir de cette
version. Le pack allemand est donc épinglé en 1.108.0, compatible avec le VSCodium 1.109
du poste de référence et les suivants, et non en dernière version, qui serait refusée.
Installer le pack ne suffit pas : `update.ps1` écrit aussi `"locale"` dans
`%APPDATA%\VSCodium\argv.json` quand Windows s'affiche en allemand.

## Monter une extension de version (décision explicite, jamais automatique)

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
