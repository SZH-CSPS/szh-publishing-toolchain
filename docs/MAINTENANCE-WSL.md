# Maintenance & pérennité de la couche WSL

> Ce que tu dois surveiller, tester et mettre à jour pour que la chaîne reste fiable dans le
> temps. WSL est la seule pièce « système » ; le reste (pipeline, styles, config) est du code
> versionné et redéployé par une simple release.

## Rappel : ce que WSL fait (et ne fait pas)

La distro **`SZH-Publishing`** contient **Debian + Pandoc + WeasyPrint** (venv Python figé).
Elle ne sert **qu'à compiler** (`make` appelé à la sauvegarde). Elle **n'a pas besoin de
réseau** pour fonctionner, ne contient **aucune donnée de revue** (les revues sont sur
OneDrive, montées via `/mnt/c`). **Conséquence rassurante : une distro cassée se ré-importe
sans perte de données.**

## Test de fumée (le geste de contrôle universel)

Avant/après toute intervention, le meilleur test est de **compiler un article** :

```powershell
# depuis le banc d'essai versionné (test/)
wsl -d SZH-Publishing -- bash -lc "cd /mnt/c/Users/<toi>/prog/szh-publishing-toolchain/test && make -f ../pipeline/Makefile out/contenu-long/contenu-long.pdf"
```

Un PDF produit sans erreur = la chaîne est saine. Sur un poste rédacteur, l'équivalent est :
ouvrir une revue, **Ctrl+S**, vérifier que l'aperçu PDF se met à jour.

## Points à surveiller (par ordre de probabilité)

### 1. Le disque WSL grossit et ne se réduit jamais tout seul
Le `ext4.vhdx` (`…\SZH\WSL\*.vhdx`) **croît** au fil des compilations et **ne se compacte pas
automatiquement**. À terme : plusieurs Go inutiles.
- **Vérifier** : taille du `.vhdx` (Explorateur) ; `wsl --system df -h` (usage interne).
- **Résoudre** : `wsl --shutdown` puis compacter — `Optimize-VHD` (Hyper-V) ou `diskpart`
  (`select vdisk file="…"; attach…; compact vdisk`). À planifier ~2×/an, ou si le disque poste sature.
- **Prévenir** : le `make clean`/la régénération n'accumule pas dans WSL (les sorties vont dans
  `/mnt/c/.../out`), mais `/tmp` et les caches peuvent gonfler.

### 2. Mises à jour du moteur WSL par Windows
Windows Update (ou `wsl --update`) fait évoluer le **noyau WSL2** et le moteur. Une mise à jour
peut changer le réseau, le montage `/mnt/c`, ou activer/désactiver systemd.
- **Vérifier** : `wsl --version` et `wsl --status` (noter la version qui marche).
- **Tester** : **test de fumée** après chaque mise à jour notable de Windows.
- **Résoudre** : si régression, épingler la version WSL (paramètre de politique) le temps de
  corriger ; en dernier recours, `wsl --update --rollback` (selon version).

### 3. OneDrive « fichiers à la demande » non téléchargés
Si un dossier de revue n'est **pas** en local, WSL lit des fichiers fantômes via `/mnt/c` →
la compilation échoue ou se bloque.
- **Vérifier** : le dossier de revue doit être **« Toujours conserver sur cet appareil »**
  (clic droit OneDrive). Icône verte pleine, pas un nuage.
- **Résoudre** : (re)cocher l'option ; attendre la synchro complète avant de compiler.

### 4. Antivirus qui inspecte la VM
L'AV qui scanne `*.vhdx`, `vmmem.exe`, `wsl.exe`, `wslservice.exe` ralentit fortement (voire
verrouille) les builds.
- **Vérifier** : les **exclusions** posées par `bootstrap.ps1` sont toujours présentes
  (`…\SZH\WSL\*.vhdx`, `…\SZH\staging`, et les processus ci-dessus).
- **Risque long terme** : une **politique AV centrale** (Intune/prestataire) peut **réécraser**
  les exclusions. À re-vérifier après tout changement de politique de sécurité.

### 5. La distro ne démarre pas / démarrage à froid lent
- **Vérifier** : `wsl -l -v` (distro présente, **VERSION 2**), virtualisation activée (BIOS +
  fonctionnalités Windows « Plateforme d'machine virtuelle » et « WSL »).
- **Résoudre** : réactiver les fonctionnalités Windows ; la **tâche de préchauffage** (posée au
  bootstrap) réduit la latence du 1er build. Un `wsl --shutdown` règle beaucoup de blocages
  transitoires (horloge décalée après veille, montage figé).

### 6. Corruption de la distro
Coupure brutale, disque plein : la distro peut se corrompre.
- **Résoudre (sans perte)** : `wsl --unregister SZH-Publishing` puis **ré-importer le rootfs**
  (le mécanisme de mise à jour le refait ; ou `wsl --import SZH-Publishing <dossier> <rootfs.tar.gz>`).
  Aucune donnée de revue n'est dans la distro → rien à sauver côté WSL.

## Vieillissement à moyen/long terme (le fond du sujet)

### A. Le rootfs est figé — c'est voulu, mais il faut le rafraîchir
Pandoc, WeasyPrint, Python et Debian sont **gelés au moment du build de l'image** (pins
transitifs, reproductibilité). Avantage : deux postes produisent **exactement** le même PDF.
Inconvénient : les **correctifs et améliorations amont ne s'appliquent pas** tant qu'on ne
**reconstruit pas l'image**.
- **À faire** : ~**1 à 2 fois par an**, bumper `image/` (base Debian + `requirements.txt`),
  laisser la CI reconstruire le rootfs, tester (banc d'essai), puis release. Les postes
  récupèrent le nouveau rootfs en silence.
- **Déclencheurs** : faille de sécurité Debian ; bug WeasyPrint/Pandoc corrigé en amont dont on
  a besoin ; approche de la **fin de support (EOL)** de la version Debian de base.

### B. Fin de support de la base Debian
La base a une durée de vie (support standard ~3 ans, LTS ~5). Passé l'EOL, plus de correctifs
de sécurité.
- **À surveiller** : la version Debian dans `image/Containerfile` et son calendrier EOL.
- **Résoudre** : monter d'une version majeure dans le `Containerfile`, reconstruire, tester.
  C'est l'opération de maintenance **lourde mais rare** (prévoir ~½–1 j de test).

### C. Ne jamais bricoler la distro « à la main »
Un `apt install` ou `pip install` fait directement dans WSL **casse la reproductibilité** (le
poste diverge des autres et de l'image). **Toute évolution passe par `image/` + une release.**
Si un poste a été bidouillé : le ré-importer (§6) le remet dans l'état de référence.

### D. Contraintes structurelles à ne pas oublier
- **`inotify` ne traverse pas `/mnt/c`** : ne jamais bâtir une fonctionnalité sur
  `pandoc --watch` / un watcher lisant `/mnt/c` (ça ne se déclenchera pas).
- **`/mnt/c` est plus lent** que le disque natif WSL : normal, les fichiers sont sur OneDrive.
- **Scripts `.ps1` en PowerShell 5.1** (proscrire `?.`, `??`, `?:`, `&&`/`||`).

## Cadence de maintenance conseillée

| Quand | Geste |
|---|---|
| Après une **mise à jour majeure de Windows** (ex. 24H2) | test de fumée sur 1 poste ; vérifier `wsl -l -v` |
| Après un **changement de politique AV/Intune** | re-vérifier les exclusions WSL |
| **~2×/an** | compacter le `.vhdx` sur les postes ; reconstruire le rootfs (sécurité + versions) |
| **1×/an** | vérifier l'EOL Debian, planifier la montée de version si nécessaire |
| **En continu** | s'assurer que les revues restent « conservées sur l'appareil » (OneDrive) |

## Si tout casse : plan de reprise minimal

1. `wsl --shutdown` (règle la majorité des blocages transitoires).
2. Test de fumée. Si KO : `wsl --unregister SZH-Publishing` + ré-import du dernier rootfs.
3. Si KO encore : relancer `bootstrap.ps1` (admin) — il ré-installe proprement.
4. Rien de tout cela ne touche les **revues** (OneDrive) : le contenu est toujours là.
