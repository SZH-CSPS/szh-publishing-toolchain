# Applications du poste (`apps.lock`)

Un poste de rédaction a besoin de deux applications Windows :

| Application | Rôle | Obligatoire | Signataire attendu |
|---|---|---|---|
| VSCodium | l'éditeur | oui | `SignPath Foundation` |
| SumatraPDF | le lecteur PDF : il ne verrouille pas le fichier et le recharge seul | non | `Krzysztof Kowalczyk` |

[`apps.lock`](apps.lock) fixe pour chacune la version, l'installeur (`fichier`, `source`),
son empreinte `sha256`, le signataire, les arguments d'installation silencieuse et les
`sondes` (chemins où chercher l'exécutable). Les installeurs sont téléchargés chez l'éditeur,
pas par winget. Le principe est le même que pour les extensions ([`VSIX.md`](VSIX.md)).

## Ce que fait `bootstrap.ps1`

Pour chaque application :

1. **Présente à la bonne version** (`ProductVersion` de l'exécutable trouvé par les
   sondes) : rien à faire.
2. **Présente dans une autre version** : elle reste telle quelle. Un avertissement le dit, et
   `diagnostic.ps1` le signale à chaque contrôle.
3. **Absente** :
   1. téléchargement (trois essais, fichier `.part` tant qu'il est incomplet) ;
   2. contrôle de l'empreinte : arrêt si elle diffère ;
   3. contrôle de l'en-tête `MZ` (un proxy qui renvoie une page d'erreur est repéré) ;
   4. lecture de la signature : arrêt si l'installeur n'est pas signé (`NotSigned`) ou si sa
      signature ne correspond pas (`HashMismatch`) ; un autre défaut, ou un autre
      signataire, ne donne qu'un avertissement ;
   5. installation silencieuse, puis nouvelle recherche par les sondes. C'est elle qui dit
      si l'application est installée, pas le code de retour de l'installeur. SumatraPDF a un
      second jeu d'arguments (`installationRepli`) si le premier ne pose rien.

Si VSCodium manque à la fin, le script s'arrête. Si SumatraPDF manque, il le signale et
continue.

## Installation pour tous les comptes

`bootstrap.ps1` installe le paquet système : `VSCodiumSetup` (et non `VSCodiumUserSetup`),
`-all-users` pour SumatraPDF. Les deux vont dans `Program Files`. Deux raisons :

- l'installation se fait souvent avec un compte de support élevé ; un paquet par utilisateur
  irait dans le profil de ce compte, et le rédacteur n'aurait pas d'éditeur. Dans ce cas, le
  script ignore aussi les sondes sous `%LOCALAPPDATA%` ;
- dans un parc géré, AppLocker ou WDAC interdisent souvent de lancer un programme depuis un
  dossier où l'utilisateur peut écrire.

Un VSCodium déjà installé pour un seul compte continue de fonctionner. `diagnostic.ps1`
l'affiche « installé pour ce compte seulement ».

## Monter de version

Aucune application ne monte seule : VSCodium est réglé en `"update.mode": "manual"`
([`vscodium-user/settings.json`](../vscodium-user/settings.json)), et `update.ps1` ne
demande pas les droits d'administrateur.

1. Lire les notes de version de l'éditeur. Pour VSCodium, vérifier que le pack de langue
   allemand reste compatible ([`VSIX.md`](VSIX.md#packs-de-langue)).
2. Relever l'empreinte et le signataire du nouvel installeur :
   ```powershell
   $u = 'https://github.com/VSCodium/vscodium/releases/download/X.Y.Z/VSCodiumSetup-x64-X.Y.Z.exe'
   $f = "$env:TEMP\app.exe"
   (New-Object System.Net.WebClient).DownloadFile($u, $f)
   (Get-FileHash $f -Algorithm SHA256).Hash.ToLower()
   (Get-AuthenticodeSignature $f).SignerCertificate.Subject
   ```
3. Mettre à jour `version`, `fichier`, `source` et `sha256` dans `apps.lock`.
4. Publier une version de Pronto. La CI ([`release.yml`](../.github/workflows/release.yml))
   télécharge chaque `source` et échoue si l'URL ne répond pas ou si l'empreinte diffère.
5. Sur les postes déjà installés, un administrateur relance `bootstrap.ps1` après avoir
   désinstallé l'ancienne version. `diagnostic.ps1` montre les postes en écart.

Les installeurs ne sont pas copiés dans les fichiers de la version publiée. La CI vérifie
donc, à chaque publication, que l'URL d'origine répond encore et que le fichier n'a pas
changé.
