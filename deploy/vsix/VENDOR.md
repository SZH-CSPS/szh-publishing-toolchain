# VSIX à vendoriser (épinglés)

Déposer ici les `.vsix` **téléchargés et vérifiés** depuis Open VSX. On ne tire jamais
« latest » au runtime (auto-update désactivé) — mitigation directe des campagnes type
GlassWorm sur Open VSX.

## Obligatoires

| Extension | ID Open VSX | Version cible | Page |
|---|---|---|---|
| Aperçu PDF | `tomoki1207.pdf` | 1.2.2 | open-vsx.org/extension/tomoki1207/pdf |
| Build à la sauvegarde | `Gruntfuggly.triggertaskonsave` | 0.2.x | open-vsx.org/extension/Gruntfuggly/triggertaskonsave |
| Correcteur orthographique | `streetsidesoftware.code-spell-checker` | 4.5.x+ | open-vsx.org/extension/streetsidesoftware/code-spell-checker |
| Dictionnaire FR | `streetsidesoftware.code-spell-checker-french` | latest | …/code-spell-checker-french |
| Dictionnaire DE (Suisse) | `streetsidesoftware.code-spell-checker-swiss-german` | latest | …/code-spell-checker-swiss-german |

## Optionnel (langue d'interface FR figée — voir README)
| Pack langue FR (mai 2021) | `MS-CEINTL.vscode-language-pack-fr` | 1.56.x | open-vsx.org/extension/MS-CEINTL/vscode-language-pack-fr |

## Procédure
1. Télécharger chaque `.vsix` depuis la page Open VSX (bouton « Download »).
2. Vérifier l'éditeur, l'âge, l'absence de typosquat.
3. Déposer ici. `deploy.ps1` les installe via `codium --install-extension`.
4. Conserver les versions : tout bump est une décision explicite.
