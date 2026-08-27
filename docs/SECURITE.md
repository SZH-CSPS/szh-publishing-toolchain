# Sécurité & déploiement flotte (10 postes)

> Page courte : ce qui protège la chaîne, les risques assumés, et **ce qu'il faut vérifier
> avec le prestataire** pour déployer sur les 10 machines.

## Ce qui protège déjà la chaîne

- **Extensions VSCodium épinglées + empreintes sha256** (`windows/vsix.lock`) : version ET
  hash figés, vérifiés à l'installation → protège contre une extension piégée ou une mise à
  jour malveillante (type « GlassWorm »).
- **Rootfs WSL vérifié par sha256** et **dépendances Python figées** (pins transitifs) :
  ce qui tourne sur les postes est exactement ce qui a été construit et audité.
- **Mises à jour intègres** : les postes lisent un `manifest.json` puis téléchargent depuis
  les **Releases GitHub en HTTPS**, avec **contrôle sha256** de chaque artefact.
- **Moindre privilège** : après le `bootstrap.ps1` initial, **plus aucun droit administrateur**
  n'est requis ; les mises à jour se font en espace utilisateur.
- **Isolation** : la compilation tourne **dans la VM WSL**, ce qui limite la surface d'exposition
  côté Windows.

## Racine de confiance

Le seul point qui peut modifier ce qui s'exécute sur les postes, c'est **une release GitHub**.
→ **Restreindre qui peut pousser un tag / créer une release** (droits du dépôt, protection de
branche, 2FA obligatoire sur les comptes ayant ce droit). C'est le contrôle de sécurité le plus
important de tout le système.

## Risques assumés (à connaître)

| Risque | Pourquoi | Atténuation |
|---|---|---|
| **Workspace Trust désactivé** | machine dédiée, pour permettre le build auto sans pop-up | n'ouvrir que des **revues de confiance** (OneDrive interne) ; postes dédiés à cet usage |
| **Utilisateurs autorisés à écrire dans `C:\ProgramData\SZH`** | nécessaire pour les MAJ sans admin | un logiciel malveillant tournant sous le compte utilisateur pourrait altérer le toolkit local (ré-exécuté au build). Compenser par **antivirus/EDR** actif + comptes **utilisateurs standard** + surveillance endpoint |
| **Sur un poste partagé, cette écriture traverse les comptes** | le toolkit est commun, et la tâche planifiée l'exécute à l'ouverture de session de **chaque** utilisateur | un compte standard qui remplacerait `toolkit\windows\*.ps1` ferait exécuter son code dans la session des autres comptes du poste — pas une élévation vers l'administrateur, mais un passage latéral. Assumé pour une flotte interne de postes à un rédacteur ; sur un poste réellement partagé, retirer l'écriture aux Utilisateurs sur `toolkit\` et confier la pose du toolkit à une tâche SYSTEM (au prix d'un téléchargement distant exécuté en SYSTEM, ce qui déplace le risque plutôt que de le supprimer) |
| **Le toolkit local n'est pas re-vérifié à chaque exécution** | seuls les **téléchargements** sont contrôlés (sha256) | idem ci-dessus : la protection repose sur l'intégrité du poste (EDR, MAJ Windows) |

## À vérifier avec le prestataire — checklist déploiement (×10)

- [ ] **Droits admin ponctuels** : le prestataire peut-il exécuter `bootstrap.ps1` **une fois**
      par poste (ou nous accorder l'admin temporaire) ? Ensuite plus besoin d'admin.
- [ ] **WSL2 activable** : virtualisation activée dans le **BIOS/UEFI** ; fonctionnalités Windows
      « Plateforme de machine virtuelle » + « WSL » ; pas de conflit avec un autre hyperviseur
      ou une politique VBS/Device Guard qui bloquerait WSL2.
- [ ] **Édition de Windows** compatible WSL2 (Pro/Enterprise recommandé ; Home accepté).
- [ ] **Applications figées, sans winget.** VSCodium et SumatraPDF sont épinglés dans
      `windows/apps.lock` (version, `sha256`, signataire attendu) et posés au **niveau
      machine** par téléchargement direct. winget n'est plus dans la chaîne : il n'existe pas
      pour un compte de support non provisionné, et sa source tombe en panne sur un poste
      neuf. Rien ne monte de version tout seul (voir `windows/APPS.md`).
- [ ] **Réseau / pare-feu / proxy** : autoriser en sortie **`github.com`** et
      **`objects.githubusercontent.com`** (releases du toolkit, installeur VSCodium),
      **`www.sumatrapdfreader.org`** (installeur SumatraPDF — les Releases GitHub du projet
      ne portent aucun asset) et **`api.github.com`** (liste des versions installables du
      sélecteur). Un proxy qui **demande une authentification** est géré : les scripts
      présentent les identifiants de la session, sans saisie.
      Aucun autre flux sortant n'est nécessaire pour compiler (le pipeline est hors-ligne).
- [ ] **Antivirus / EDR** : poser les **exclusions** WSL (`…\SZH\WSL\` et ses sous-dossiers —
      un par SID de compte —, `…\SZH\staging`,
      processus `vmcompute.exe`/`vmmem.exe`/`wsl.exe`/`wslservice.exe`) **et s'assurer qu'une
      politique centrale ne les réécrasera pas**. ⚠ `bootstrap.ps1` se contente de les afficher :
      personne ne les pose à votre place.
- [ ] **Tâches planifiées autorisées** : la MAJ silencieuse (connexion + mardi 14h00) et le
      préchauffage WSL utilisent le Planificateur de tâches — vérifier qu'aucune politique ne les
      bloque. Elles tournent avec le jeton de l'utilisateur connecté (groupe Utilisateurs, niveau
      limité), jamais en SYSTEM.
- [ ] **ACL sur `C:\ProgramData\SZH`** : `bootstrap.ps1` donne l'écriture aux Utilisateurs ;
      confirmer que la gestion du parc (Intune/GPO) ne la révoque pas et ne la signale pas.
- [ ] **OneDrive/SharePoint** : déploiement configuré, et pouvoir mettre les dossiers de revue en
      **« Toujours conserver sur cet appareil »**.
- [ ] **Espace disque** : prévoir quelques Go par poste (rootfs + croissance du `.vhdx`).
- [ ] **Coordination des mises à jour** : qui gère Windows/WSL sur le parc ? Prévoir un **test de
      fumée** après chaque mise à jour majeure de Windows (voir [`MAINTENANCE.md`](MAINTENANCE.md)).

## Questions concrètes à poser au prestataire

1. Pouvez-vous exécuter un script PowerShell d'installation **en administrateur, une fois par
   poste** (ou nous ouvrir un accès admin temporaire) ?
2. Quelles sont vos **règles pare-feu/proxy** en sortie ? Peut-on autoriser GitHub (releases)
   et `www.sumatrapdfreader.org` (installeur du lecteur PDF) ? Votre proxy demande-t-il une
   **authentification** ?
3. Votre **antivirus/EDR** accepte-t-il des **exclusions persistantes** pour WSL, et qui les gère ?
4. Votre gestion de parc (Intune/GPO) **tolère-t-elle** des tâches planifiées locales et une ACL
   personnalisée sous `C:\ProgramData` ?
5. Qui **pilote les mises à jour Windows** et peut nous prévenir avant une montée de version
   majeure (pour tester la chaîne) ?

> Rien dans cette chaîne n'ouvre de service réseau entrant ni ne stocke de secret sur les postes.
> La sécurité repose sur : **intégrité des releases (sha256 + contrôle des droits GitHub)**,
> **intégrité des postes (EDR + moindre privilège)**, et **isolation WSL**.
