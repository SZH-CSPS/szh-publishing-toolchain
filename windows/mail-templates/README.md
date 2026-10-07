# Gabarits de courriel du lanceur Windows

Ce dossier contient le courriel au support que propose l'écran d'erreur de la mise à jour
(`Show-SzhErreur`, touche `E`).

Un fichier par langue : `support.fr.twig`, `support.de.twig`, `support.en.twig`. Si la langue
du poste manque, `support.fr.twig` est utilisé. Variables : `poste`, `etape`, `message`,
`journal`.

La forme (blocs `sujet` et `corps`) et la syntaxe sont celles des gabarits du cockpit :
[`vscodium-extension/szh-cockpit/mail-templates/`](../../vscodium-extension/szh-cockpit/mail-templates/README.md).

## Rendu

`Get-SzhCourriel` (`windows/szh-common.ps1`) fait rendre le gabarit par le moteur du cockpit,
`lib/gabarits.js`. Il appelle `outils/rendre-gabarit.js` de l'extension du cockpit avec le
Node de VSCodium (`ELECTRON_RUN_AS_NODE=1`), par `Invoke-SzhNodeCockpit`
(`windows/szh-shell.ps1`). L'échange se fait en JSON sur l'entrée et la sortie standard.
Le résultat est ensuite converti en fins de ligne CRLF, et le corps coupé à 1500 caractères.

## Repli

Si le rendu échoue (VSCodium ou l'extension pas encore installés, par exemple à la première
installation), `Get-SzhCourriel` rend un texte simple tiré de `windows/szh-textes.ps1`
(clés `courriel.repli.sujet` et `courriel.repli.corps`) et note la raison dans le journal.
Ce texte ne lit aucun gabarit.
