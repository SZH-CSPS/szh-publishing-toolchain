# Sécurité du déploiement

Cette page décrit ce qui protège Pronto sur les postes de rédaction, les secrets qu'il garde,
les connexions qu'il ouvre vers l'extérieur et les risques acceptés. Elle se termine par la
liste à vérifier avec le prestataire informatique avant de déployer un poste.

## Le modèle de confiance

### Ce qui peut changer le code d'un poste

Seule une version publiée sur GitHub change ce qui s'exécute sur les postes. Elle part d'un
commit `release: X.Y.Z …` poussé sur `main` et jugé vert par la CI, ou d'un lancement manuel
du workflow `release` ([`DEVELOPPEMENT.md`](DEVELOPPEMENT.md)).

Le contrôle le plus important de tout le système est donc **qui peut pousser sur `main` et
lancer un workflow** : droits du dépôt, protection de branche, double authentification
obligatoire sur les comptes qui ont ces droits.

### Ce qui vérifie l'intégrité

- **Mises à jour.** Le poste lit `manifest.json` dans la version publiée, puis télécharge le
  toolkit, l'image WSL et les extensions depuis GitHub en HTTPS. Chaque fichier est contrôlé
  par son empreinte sha256 avant installation (`Test-SzhSha256`, `windows/update.ps1`).
- **Extensions VSCodium tierces.** Version et empreinte sont figées dans `windows/vsix.lock`.
  La CI les télécharge, vérifie l'empreinte et les publie avec la version : un poste ne va
  pas les chercher sur Open VSX.
- **Applications tierces.** VSCodium et SumatraPDF sont figés dans `windows/apps.lock`
  (version, sha256, signataire attendu) et installés par `bootstrap.ps1` au niveau machine,
  sans winget. Rien ne monte de version tout seul ([`windows/APPS.md`](../windows/APPS.md)).
- **Image WSL.** Les dépendances Python sont figées, y compris les dépendances indirectes.
  L'image téléchargée est vérifiée par sha256.
- **VSCodium.** Les mises à jour automatiques de l'éditeur et des extensions, et la
  télémétrie, sont désactivées (`vscodium-user/settings.json`).

### Moindre privilège

- Seul `bootstrap.ps1`, lancé une fois à l'installation, demande les droits
  d'administrateur. Les mises à jour se font ensuite sous le compte de l'utilisateur.
- Les tâches planifiées (mise à jour à l'ouverture de session et le mardi à 14 h,
  préchauffage de la WSL) tournent avec le jeton de l'utilisateur connecté, au niveau
  limité du groupe Utilisateurs, jamais en SYSTEM (`windows/szh-taches.ps1`).
- La compilation tourne dans la WSL, isolée du reste de Windows.
- Aucun service réseau n'écoute sur le poste.

### L'administrateur n'exécute jamais le toolkit modifiable

`bootstrap.ps1` donne au groupe Utilisateurs le droit de modifier `C:\ProgramData\SZH`, ce
qui permet les mises à jour sans administrateur. En contrepartie, un processus élevé ne
lance jamais un script de `C:\ProgramData\SZH\toolkit\windows` :

- `bootstrap.ps1` lance `update.ps1` et `diagnostic.ps1` depuis une seconde extraction de
  l'archive déjà vérifiée, dans un dossier qu'il crée sous `%TEMP%` et supprime à la fin ;
- `windows/uninstall.ps1` refuse de s'exécuter depuis le toolkit sous élévation, sauf avec
  `-Simuler`.

## Les secrets sur le poste

Pronto garde trois clés d'API, propres à chaque compte Windows :

| Clé | Sert à | Où |
|---|---|---|
| Shlink | créer les liens courts des livres (`pipeline/liens-courts.py`) | coffre de VSCodium, `szh.shlinkCle` |
| OJS | réservée : aucun code ne s'en sert encore | coffre de VSCodium, `szh.ojsCle` |
| Mistral | résumer les propositions des moissonneurs (`lib/resumes-hote.js`) | coffre de VSCodium, `szh.mistralCle` |

- Le coffre de VSCodium (`context.secrets`) est chiffré par Windows pour le compte (DPAPI).
  Une clé ne se copie pas d'un poste ou d'un compte à l'autre : il faut la saisir à nouveau.
- Les clés se saisissent dans l'Accueil, onglet Paramètres. La page ne reçoit jamais la clé,
  seulement « réglée » ou « absente ». Une clé n'est écrite ni dans un fichier, ni dans un
  journal, ni dans un rapport d'erreur.
- Les clés Shlink et OJS passent à la WSL par des variables d'environnement
  (`SZH_SHLINK_URL`, `SZH_SHLINK_CLE`, `SZH_OJS_CLE`), transmises par `WSLENV` dans le sens
  Windows vers WSL seulement (`lib/services-env.js`). La clé Mistral ne quitte pas le cockpit.
- Un ancien format reste lu : les clés Shlink et OJS chiffrées par DPAPI (portée
  CurrentUser) dans `%LOCALAPPDATA%\SZH\etat-utilisateur.json`. Les scripts PowerShell les
  déchiffrent et les posent dans l'environnement du processus qu'ils lancent
  (`Set-SzhEnvironnementSecrets`, `windows/szh-common.ps1`). Une clé illisible vaut une clé
  absente.
- L'adresse de l'instance Shlink n'est pas un secret : elle est en clair dans les réglages de
  VSCodium (`szh.shlinkUrl`).

## Les connexions sortantes

Pronto n'ouvre aucune connexion entrante. Les connexions sortantes sont toutes en HTTPS. La
compilation d'un numéro n'en a pas besoin ; celle d'un livre n'appelle Shlink que si
l'adresse Shlink est réglée.

### Installation et mises à jour (scripts PowerShell)

| Destination | Pourquoi | Quand |
|---|---|---|
| `github.com` et ses redirections de téléchargement (`objects.githubusercontent.com`) | `manifest.json`, toolkit, image WSL, extensions ; installeur de VSCodium | installation, mise à jour |
| `api.github.com` | liste des versions publiées, pour la fenêtre « Changer de version… » | à la demande |
| `www.sumatrapdfreader.org` | installeur de SumatraPDF | installation |

Les scripts PowerShell passent par le proxy du système avec les identifiants de la session
(Kerberos ou NTLM), sans saisie (`windows/szh-common.ps1`).

### Le cockpit (VSCodium)

| Destination | Pourquoi | Ce qui part |
|---|---|---|
| `ojs.szh.ch` (OAI-PMH public) | liste des auteurs et autrices publiés ; numéros publiés pour les exports du secrétariat | des requêtes de lecture, sans clé |
| `edudoc.ch` (OAI-PMH public) | vocabulaire des mots-clés Edudoc | des requêtes de lecture, sans clé |
| `api.ror.org` | nom des institutions des auteurs lus sur OJS | des identifiants ROR |
| `api.mistral.ai` | résumé des propositions des moissonneurs, si une clé Mistral est réglée | le texte public des propositions, et la clé |

Le bouton de traduction ouvre `www.deepl.com` dans le navigateur de l'utilisateur, avec le
texte à traduire dans l'adresse. Ce n'est pas une connexion de Pronto, mais le texte quitte
le poste.

### La WSL (Python)

| Destination | Programme | Ce qui part |
|---|---|---|
| `api.ror.org` | nettoyeur de manuscrit (`pipeline/manuscrit_identifiants.py`) | les noms d'institution des auteurs du manuscrit |
| `pub.orcid.org` | nettoyeur de manuscrit | les noms des auteurs du manuscrit |
| `api.crossref.org` | nettoyeur de manuscrit (`pipeline/manuscrit_biblio.py`) | les références bibliographiques à compléter d'un DOI |
| l'instance Shlink réglée (par exemple `link.szh-csps.ch`) | liens courts des livres (`pipeline/liens-courts.py`, cible `liens-courts` de `profils/livre.mk`) | les adresses à raccourcir, et la clé |
| `api.openparldata.ch`, `files.openparldata.ch` | moissonneur `parlement` | des requêtes de lecture |
| `www.skbf-csre.ch`, `www.hfh.ch`, `www.phbern.ch`, `www.phsg.ch`, `www.ehb.swiss`, `www.fhnw.ch`, `www.hepl.ch` | moissonneur `recherche` | des requêtes de lecture, avec un délai entre deux requêtes et le respect de `robots.txt` |

Le moissonneur `recherche` lit aussi l'export du Fonds national (`data.snf.ch`), mais le
`robots.txt` du site interdit les robots : le fichier se télécharge à la main et se passe en
argument (`--fichier-snf`). Les sites désactivés dans `moissonneurs/recherche/sources/sites.py`
(`actif=False`) ne sont pas contactés.

Seul le nettoyeur de manuscrit envoie des données tirées d'un manuscrit (noms, institutions,
références). Il le fait quand la rédaction le lance depuis l'onglet Préprocessing de
l'Accueil ([`ARCHITECTURE-nettoyeur-manuscrit.md`](ARCHITECTURE-nettoyeur-manuscrit.md)).

## Les risques acceptés

| Risque | Pourquoi | Ce qui le limite |
|---|---|---|
| La confiance de l'espace de travail (*Workspace Trust*) est désactivée | la compilation doit partir à l'enregistrement, sans fenêtre de confirmation | n'ouvrir que des numéros du partage interne ; postes réservés à cet usage |
| Les utilisateurs peuvent écrire dans `C:\ProgramData\SZH` | nécessaire aux mises à jour sans administrateur | un logiciel malveillant sous le compte de l'utilisateur pourrait modifier le toolkit local, exécuté à chaque compilation. Compenser par un antivirus ou EDR actif, des comptes utilisateurs standard et la surveillance des postes |
| Sur un poste partagé, cette écriture traverse les comptes | le toolkit est commun, et la tâche planifiée l'exécute à l'ouverture de session de chaque utilisateur | un compte standard qui modifierait `toolkit\windows\*.ps1` ferait exécuter son code dans la session d'un autre compte du poste. Ce n'est pas une élévation vers l'administrateur. Accepté pour des postes à un seul rédacteur. Sur un poste réellement partagé : retirer l'écriture aux Utilisateurs sur `toolkit\` et confier la pose du toolkit à une tâche SYSTEM, ce qui déplace le risque vers un téléchargement exécuté en SYSTEM |
| Le toolkit local n'est pas revérifié à chaque exécution | seuls les téléchargements sont contrôlés par sha256 | la protection repose sur l'intégrité du poste (EDR, mises à jour de Windows) |

## Liste à vérifier avec le prestataire

- [ ] **Droits d'administrateur, une fois par poste**, pour lancer `bootstrap.ps1`.
- [ ] **WSL2 activable** : virtualisation activée dans le BIOS/UEFI ; fonctionnalités
      Windows « Plateforme de machine virtuelle » et « Sous-système Windows pour Linux » ;
      pas de conflit avec un autre hyperviseur ni avec une politique VBS ou Device Guard.
- [ ] **Édition de Windows** compatible WSL2 (Pro ou Entreprise recommandées).
- [ ] **Pare-feu et proxy** : autoriser en sortie les destinations de
      [Les connexions sortantes](#les-connexions-sortantes). Le minimum pour installer et
      mettre à jour est GitHub et SumatraPDF ; le reste sert au nettoyeur, aux exports, aux
      livres et aux moissonneurs.
- [ ] **Antivirus ou EDR** : poser les exclusions de la WSL (`C:\ProgramData\SZH\WSL\` et
      ses sous-dossiers, un par compte ; `C:\ProgramData\SZH\staging\` ; processus
      `vmcompute.exe`, `vmmem.exe`, `wsl.exe`, `wslservice.exe`) et s'assurer qu'une
      politique centrale ne les efface pas. `bootstrap.ps1` affiche ces exclusions mais ne
      les pose pas.
- [ ] **Tâches planifiées** : aucune politique ne bloque les tâches locales de mise à jour
      et de préchauffage.
- [ ] **Droits sur `C:\ProgramData\SZH`** : la gestion du parc (Intune, GPO) ne retire pas
      l'écriture donnée au groupe Utilisateurs, et ne la signale pas comme anomalie.
- [ ] **OneDrive et SharePoint** : client déployé, bibliothèque `Daten_Allgemein - General`
      synchronisée, et « Toujours conserver sur cet appareil » autorisé
      ([épinglage hors ligne](EMPLACEMENTS.md#épinglage-hors-ligne)).
- [ ] **Espace disque** : quelques Go par compte (image WSL et croissance du disque
      virtuel `.vhdx`).
- [ ] **Mises à jour de Windows** : savoir qui les pilote, pour faire un test de
      fonctionnement après chaque mise à jour majeure ([`MAINTENANCE.md`](MAINTENANCE.md)).

## Questions au prestataire

1. Pouvez-vous exécuter un script PowerShell d'installation en administrateur, une fois par
   poste, ou nous ouvrir un accès administrateur temporaire ?
2. Quelles sont vos règles de pare-feu et de proxy en sortie ? Pouvez-vous autoriser les
   destinations listées ici ? Votre proxy demande-t-il une authentification ?
3. Votre antivirus ou EDR accepte-t-il des exclusions durables pour la WSL, et qui les gère ?
4. Votre gestion de parc tolère-t-elle des tâches planifiées locales et des droits modifiés
   sous `C:\ProgramData` ?
5. Qui pilote les mises à jour de Windows, et peut nous prévenir avant une mise à jour
   majeure ?
