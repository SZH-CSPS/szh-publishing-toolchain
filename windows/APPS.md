# Applications du poste épinglées (`apps.lock`)

Deux applications, et deux seulement : **VSCodium** (l'éditeur) et **SumatraPDF** (le
lecteur PDF, choisi parce qu'il ne verrouille pas le fichier et le recharge tout seul).
[`apps.lock`](apps.lock) en est la source de vérité : `version`, `fichier`, `source`,
`sha256`, `signataire`, arguments d'installation silencieuse et sondes de présence.

## Pourquoi winget a disparu de la chaîne

Sur un poste neuf, winget tombe en panne plus souvent qu'on ne le croit : index de source
jamais synchronisé (`0x8a15000f`, « données manquantes »), source `msstore` qui réclame une
région à deux lettres, proxy d'entreprise qui coupe `cdn.winget.microsoft.com`. Et le cas
qui a coûté une matinée le 26 août 2026 : **sous une élévation faite avec un compte de
support, App Installer n'est pas provisionné pour ce compte-là** — winget n'existe
simplement pas. Les deux applications ont fini par être posées à la main.

Une version figée, téléchargée en direct et vérifiée, supprime toute cette classe de
pannes : plus de source à réparer, plus de code retour à interpréter, plus de « latest »
qui change sous les pieds d'un poste. C'est le même raisonnement que `vsix.lock`.

## Ce que fait `bootstrap.ps1`

1. **Déjà là, à la bonne version ?** Les sondes cherchent l'exécutable (paquet système
   d'abord, paquet par utilisateur ensuite) et sa `ProductVersion` est comparée au verrou.
   Rien à faire, on passe.
2. **Déjà là, dans une autre version ?** On ne remplace pas : une montée de version est un
   geste volontaire (ci-dessous), et remplacer l'éditeur pendant l'installation d'un poste
   n'est pas une surprise à faire à qui que ce soit. L'écart est signalé, et
   `diagnostic.ps1` le redit à chaque contrôle.
3. **Absente ?** Téléchargement (trois essais, fichier `.part` tant qu'il est incomplet),
   `sha256` vérifié — **arrêt** si écart —, en-tête `MZ` vérifié (un proxy qui répond par
   une page d'erreur donne un fichier de la bonne taille et du mauvais genre), signature
   Authenticode lue, installation silencieuse, puis **contrôle par les sondes**.

Le dernier point est le seul qui décide : un installeur peut sortir en code 0 sans rien
poser là où on l'attend. C'est le disque qui dit si l'application est installée.

La signature ne remplace pas l'empreinte, elle la double : l'empreinte fige des octets, la
signature dit qui les a produits. Un défaut de chaîne ou de révocation sur un poste hors
ligne n'arrête donc rien — sauf `NotSigned` et `HashMismatch`, qui n'arrivent pas par
accident.

| Application | Signataire attendu |
|---|---|
| VSCodium | `CN=SignPath Foundation` |
| SumatraPDF | `CN=Krzysztof Kowalczyk` |

## Niveau machine, et pourquoi pas par utilisateur

Le paquet **système** (`VSCodiumSetup`, et `-all-users` pour SumatraPDF), jamais la variante
par utilisateur. Deux raisons, dans cet ordre :

- une installation élevée avec un compte de support poserait la variante par utilisateur
  dans le profil **du support** : le rédacteur ouvrirait sa session sans éditeur, ce qui est
  exactement la panne d'origine ;
- dans une flotte gérée, AppLocker ou WDAC interdit couramment l'exécution depuis un chemin
  inscriptible par l'utilisateur — un éditeur sous `%LOCALAPPDATA%` ne démarrerait pas.

Un poste qui porte déjà un VSCodium par utilisateur continue de fonctionner : les sondes le
trouvent, et `diagnostic.ps1` le signale comme « installé pour ce compte seulement ».

## Monter de version (décision explicite, jamais automatique)

Rien ne monte tout seul : ni winget, ni la mise à jour automatique de VSCodium (désactivée
sur les postes), ni `update.ps1` — qui ne demande jamais l'administrateur et ne peut donc
pas toucher à Program Files.

1. Lire les notes de version amont, et vérifier que le pack de langue allemand épinglé dans
   [`vsix.lock`](vsix.lock) reste sous la version de l'éditeur (voir [VSIX.md](VSIX.md)).
2. Relever la nouvelle empreinte :
   ```powershell
   $u = 'https://github.com/VSCodium/vscodium/releases/download/X.Y.Z/VSCodiumSetup-x64-X.Y.Z.exe'
   $f = "$env:TEMP\app.exe"
   (New-Object System.Net.WebClient).DownloadFile($u, $f)
   (Get-FileHash $f -Algorithm SHA256).Hash.ToLower()
   (Get-AuthenticodeSignature $f).SignerCertificate.Subject
   ```
3. Mettre à jour `version`, `fichier`, `source` et `sha256` dans `apps.lock`.
4. Tagger une release : la CI télécharge chaque `source` et **refuse de publier** si
   l'empreinte a changé ou si l'URL ne répond plus.
5. Sur les postes déjà installés, la montée reste manuelle — un administrateur relance
   `bootstrap.ps1`, ou désinstalle l'ancienne version pour que le prochain passage pose la
   nouvelle. `diagnostic.ps1` liste les postes en écart.

Les installeurs ne sont pas réhébergés en assets de release : 164 Mo par release pour des
fichiers qui ne changent qu'à un bump délibéré. La contrepartie est assumée — la CI vérifie
à chaque release que l'URL amont répond toujours et que les octets sont inchangés, et une
disparition amont se voit donc au plus tard à la release suivante.
