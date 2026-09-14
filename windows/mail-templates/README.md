# Gabarits de courriel du lanceur Windows

Un fichier par courriel et par langue : `nom.langue.twig` (`support.fr.twig`,
`support.de.twig`, `support.en.twig`). Repli sur `.fr.twig` — voir `Get-SzhCourriel`
dans `windows/szh-common.ps1`.

Même convention que le cockpit : deux blocs, `{% block sujet %}…{% endblock %}` et
`{% block corps %}…{% endblock %}`.

## Un seul moteur

Depuis le 14.09.2026, ces gabarits sont rendus par **le même moteur que le cockpit**
(`vscodium-extension/szh-cockpit/lib/gabarits.js`) — plus de sous-ensemble restreint,
plus de mini-Twig écrit à la main côté PowerShell. `Get-SzhCourriel` appelle
`outils/rendre-gabarit.js` (dans l'extension du cockpit), exécuté par le Node
qu'embarque VSCodium (`ELECTRON_RUN_AS_NODE=1`) : un aller-retour JSON sur
stdin/stdout, sur le même patron qu'`Invoke-SzhSecretariat`
(`windows/open-produit.ps1`). Toute la syntaxe de `lib/gabarits.js` est donc
disponible ici — `{% if %}`, `{% for %}`, `loop.*`, les filtres — voir
`vscodium-extension/szh-cockpit/mail-templates/README.md` pour le détail.

La convention de rendu (sujet débarrassé de ses blancs de bord, corps amputé d'un
retour à la ligne de chaque côté, puis conversion en CRLF) reste du ressort de
`Get-SzhCourriel`, pas du moteur : c'est une convention d'appel, identique à celle du
cockpit (`lib/courriel.js#rendreCourriel`).

## Le repli

`Get-SzhCourriel` est appelée par `Show-SzhErreur`, l'écran d'une mise à jour qui a
échoué — y compris à la toute première installation, où VSCodium peut ne pas encore
être posé sur le poste. Si l'exécutable, le dossier de l'extension du cockpit ou
`outils/rendre-gabarit.js` sont introuvables, ou si le rendu échoue pour n'importe
quelle raison, `Get-SzhCourriel` **ne lève jamais** : elle rend un message minimal
assemblé depuis `windows/szh-textes.ps1` (clés `courriel.repli.sujet` /
`courriel.repli.corps`) et journalise pourquoi le repli a servi
(`Write-SzhLog`). Ce repli n'est pas un second moteur : il ne lit jamais un `.twig` et
ne substitue jamais un `{{ }}`, c'est un texte d'incident volontairement différent du
gabarit habituel.
