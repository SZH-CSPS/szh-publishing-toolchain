# Todo Robin (mis à jour le 2026-08-13, après la release v2026.08.7)

## Validations qui demandent un humain

- [ ] **Scénarios GUI du lot M** : redémarrer VSCodium (release v2026.08.7 installée sur ce poste),
  puis vérifier l'aperçu HTML cliquable, le formulaire de métadonnées d'article, le menu de
  réglages, la bascule de langue.
- [ ] **Nouveau — collage de tableau Excel** (`Maj+Alt+V`, D75) : copier des cellules dans Excel ou
  Word, coller dans un article → tableau markdown. Remplace `excel-to-markdown-table`, disparu
  d'Open VSX. La fonction de conversion est testée headless (7 cas), le geste ne l'est pas.
- [ ] **Libellés DE/IT des 6 types d'article** (D71) : à confronter aux **noms de rubriques réellement
  imprimés** dans la Zeitschrift / la Revue, pas seulement à une traduction plausible. Cas à
  regarder en premier : `tribune-libre` → « Freie Tribüne » (DE) / « Tribuna libera » (IT), et les
  deux en-têtes de groupe « Zum Themenschwerpunkt gehörend » / « Ausserhalb des Schwerpunkts ».
  ⚠ Deux tables à modifier **ensemble** : `LIBELLES_TYPES` (extension) et `LIBELLES` de
  `pipeline/filters/szh-maquette.lua` — sinon le formulaire et le PDF affichent des libellés
  différents.
- [ ] **Relecture germanophone des textes du cockpit** : 230 clés (pas 102). L'audit mécanique est
  propre — 0 `ß`, 0 placeholder `{0}` divergent, 0 guillemet `„ “`, parité FR/DE totale — donc il
  reste le style. Candidats signalés : « Word in Warteschlange » (plutôt « Wartende Word-Dateien »),
  « für diese Benutzerin / diesen Benutzer » (plutôt « für dieses Benutzerkonto »), « Design »
  (VSCodium DE dit « Farbdesign »).

## Reste technique

- [ ] **Extension résiduelle sur ce poste** : `csholmq.excel-to-markdown-table@1.4.0` est encore
  installée localement (héritée d'avant). Elle ne l'est plus sur les nouveaux postes.
  À désinstaller pour tester le geste `Maj+Alt+V` dans les mêmes conditions que la flotte :
  `codium --uninstall-extension csholmq.excel-to-markdown-table`.
- [ ] **Interface en anglais sur ce poste** : `Get-UICulture` renvoie `en-GB`, donc l'UI de mise à
  jour et les textes du cockpit ne sont pas en français. Pour tester le FR ou le DE :
  `$env:SZH_LANGUE='fr'` (scripts PowerShell) et le réglage `szh.langue` (cockpit).
- [ ] **P6** (jamais commencé, hors T6.1) : `open-md.ps1`, association `.md`, dispatch `profil:`.
- [ ] **Poste pilote** : checklist V1–V8 du §5 sur une machine vierge (celle-ci ne l'est plus).
- [ ] **D7** : retirer `fonts-noto` du rootfs. D73 a déjà rendu la maquette indépendante des polices
  du rootfs (`pipeline/fonts/`) ; il ne reste que le gain de taille (plusieurs centaines de Mo).

## Fait le 2026-08-13

- Release **v2026.08.7** publiée : cockpit 0.2.0, szh-apercu 0.1.2, pack de langue DE, pipeline
  (extracteur Python de tableaux, aperçu HTML, maquette). Plus besoin de re-synchroniser
  `pipeline/` à la main.
- Poste installé par `bootstrap.ps1` : toolkit 2026.08.7, tâches planifiées, `.wslconfig`, extensions.
- `PLANIFICATION.md` : D37–D74 transcrites (dette plus large que prévu — le code allait jusqu'à D74),
  D75 pour le retrait de `csholmq`, P0/P3 cochés, arborescences du §3 corrigées.
- `Feature.docx` : plus aucun `.docx` suivi ni présent dans le dépôt — rien à sortir.

# Todo Features

Utilise le calculateur APCA pour recalculer les couleurs d'accentuation idéales dans les tableaux.

Créé une palette complète de couleurs (plusieurs gradations) : au moins 3 utilisables avec
l'écriture en blanc et 3 avec l'écriture en noir, pour chaque couleur d'accentuation.

Créé un fichier html qui présente rapidement cette palette.
