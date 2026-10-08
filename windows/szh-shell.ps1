# Identité de barre des tâches (AppUserModelID) et son pont C#, raccourcis du menu Démarrer,
# ouverture de VSCodium et de l'Accueil, tâches de démarrage du lanceur.
# Compatibilité : Windows PowerShell 5.1.

# ---- Ouverture d'un dossier dans VSCodium ----
# Retire ELECTRON_RUN_AS_NODE (un script peut le poser après le dot-source) et journalise
# un échec. open-md.ps1 a son propre lanceur, Start-SzhCodiumFichier, qui ouvre deux chemins
# et a un mode simulation ; les deux noms doivent rester distincts.
# Les secrets Shlink et OJS sont posés par Set-SzhEnvironnementSecrets, dans szh-common.ps1
# pour qu'open-md.ps1, qui ne charge que ce fichier, y ait accès.
#
# $env:SZH_CODIUM_PROFIL (outils-dev/pronto-dev.ps1) ouvre un profil de développement ;
# vide ou absent, la ligne de commande est inchangée. $env:SZH_LANCEUR_SIMULE=1 journalise
# la ligne sans rien lancer.
function Start-SzhCodium([string]$Dossier) {
  # Secrets posés avant de vérifier VSCodium, indépendamment de sa présence.
  Set-SzhEnvironnementSecrets
  $codium = Get-VSCodiumExe
  if (-not $codium) {
    Write-SzhLog ('codium : introuvable, impossible d''ouvrir ' + $Dossier)
    return $false
  }
  if (Test-Path 'Env:ELECTRON_RUN_AS_NODE') { Remove-Item 'Env:ELECTRON_RUN_AS_NODE' -ErrorAction SilentlyContinue }
  $arguments = @(Get-SzhArgumentsProfil)
  $arguments += ('"{0}"' -f $Dossier)
  Write-SzhLog ('codium : ' + $codium + ' ' + ($arguments -join ' '))
  if ($env:SZH_LANCEUR_SIMULE -eq '1') { return $true }
  try {
    Start-Process -FilePath $codium -ArgumentList $arguments
    return $true
  } catch {
    Write-SzhLog ('codium : lancement impossible (' + $_.Exception.Message + ') pour ' + $Dossier)
    return $false
  }
}

# ---- L'Accueil du cockpit ----
# « Pronto » ouvre VSCodium en fenêtre neuve, sans dossier : le cockpit y ouvre l'Accueil.
# Version minimale du cockpit pour cela ; en dessous, on demande la mise à jour.
$script:SzhCockpitAccueilMin = '0.74.0'

# Les arguments que $env:SZH_CODIUM_PROFIL ajoute à toute ligne de VSCodium (aucun si elle
# est vide).
function Get-SzhArgumentsProfil {
  $arguments = @()
  if ($env:SZH_CODIUM_PROFIL) {
    $arguments += ('--user-data-dir "{0}"' -f (Join-Path $env:SZH_CODIUM_PROFIL 'data'))
    $arguments += ('--extensions-dir "{0}"' -f (Join-Path $env:SZH_CODIUM_PROFIL 'extensions'))
  }
  return $arguments
}

# Écrit un plan de simulation en octets UTF-8 sur la sortie : Write-Output passerait par
# l'encodage de la console et abîmerait les accents sous PowerShell 5.1.
function Write-SzhPlanJson($Objet) {
  $octets = [System.Text.Encoding]::UTF8.GetBytes(($Objet | ConvertTo-Json -Depth 6))
  $flux = [Console]::OpenStandardOutput()
  $flux.Write($octets, 0, $octets.Length)
  $flux.Flush()
}

# VSCodium manque : un rapport, puis une boîte de dialogue (le lanceur n'a pas de console).
function Show-SzhCodiumAbsent {
  try { Write-SzhRapport -Code 'LANCEUR-CODIUM-ABSENT' -Source 'lanceur' -Etape 'démarrage du lanceur' } catch { }
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.codium' @($SzhSupport)), $SzhNomApplication)
}

# La version de szh-cockpit posée pour ce compte, lue dans son package.json sans lancer
# l'éditeur ; '' quand aucune n'est posée. $env:SZH_COCKPIT_DOSSIER nomme le dossier
# (instance de dev) ; sinon on parcourt les extensions du profil, sans celles que l'éditeur
# a marquées obsolètes et qu'il effacera.
function Get-SzhVersionCockpit {
  $dossiers = @()
  if ($env:SZH_COCKPIT_DOSSIER) {
    $dossiers = @($env:SZH_COCKPIT_DOSSIER)
  } else {
    $racine = Join-Path $env:USERPROFILE '.vscode-oss\extensions'
    if ($env:SZH_CODIUM_PROFIL) { $racine = Join-Path $env:SZH_CODIUM_PROFIL 'extensions' }
    if (-not (Test-Path -LiteralPath $racine)) { return '' }
    $obsoletes = @{}
    $fichierObsoletes = Join-Path $racine '.obsolete'
    if (Test-Path -LiteralPath $fichierObsoletes) {
      try {
        $o = Get-Content -LiteralPath $fichierObsoletes -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($p in $o.PSObject.Properties) { $obsoletes[$p.Name] = $true }
      } catch { }
    }
    foreach ($d in @(Get-ChildItem -LiteralPath $racine -Directory -Filter 'szh-csps.szh-cockpit-*' -ErrorAction SilentlyContinue)) {
      if (-not $obsoletes.ContainsKey($d.Name)) { $dossiers += $d.FullName }
    }
  }
  $meilleure = $null
  foreach ($d in $dossiers) {
    try {
      $pkg = Get-Content -LiteralPath (Join-Path $d 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
      $v = [version]([string]$pkg.version)
      if (($null -eq $meilleure) -or ($v -gt $meilleure)) { $meilleure = $v }
    } catch { }
  }
  if ($null -eq $meilleure) { return '' }
  return $meilleure.ToString()
}

function Test-SzhCockpitAccueil([string]$Version) {
  if (-not $Version) { return $false }
  try { return ([version]$Version -ge [version]$SzhCockpitAccueilMin) } catch { return $false }
}

# Les tâches de démarrage de tout lancement, lien szh:// compris, dans cet ordre : l'ancrage
# d'abord, dont les autres lisent la racine. Aucune ne bloque le lancement. Rend leurs noms
# et l'ancrage résolu.
function Invoke-SzhTachesDemarrage {
  $taches = New-Object System.Collections.ArrayList
  [void]$taches.Add('Initialize-SzhAncrage')
  $ancrage = Initialize-SzhAncrage
  if ($ancrage.chemin) {
    Write-SzhLog ('demarrage : ancrage SharePoint "{0}" (origine {1})' -f $ancrage.chemin, $ancrage.origine)
  } else {
    Write-SzhLog ('demarrage : ancrage SharePoint introuvable (origine {0})' -f $ancrage.origine)
  }
  # Rapport seulement après une demande restée sans réponse : l'origine « defaut » (demande
  # récente, non répétée) est fréquente.
  if ($ancrage.origine -eq 'absent') {
    try { Write-SzhRapport -Code 'ANCRAGE-INTROUVABLE' -Source 'lanceur' -Etape (T 'ancrage.demande.titre') } catch { }
  }
  [void]$taches.Add('Clear-SzhRapportsEnAttente')
  try { Clear-SzhRapportsEnAttente } catch { }
  [void]$taches.Add('Invoke-SzhCheckin')
  try { [void](Invoke-SzhCheckin -OrigineAncrage $ancrage.origine) } catch { }
  [void]$taches.Add('Invoke-SzhEpinglageHorsLigne')
  try { [void](Invoke-SzhEpinglageHorsLigne) } catch { }
  [void]$taches.Add('Initialize-SzhEmplacementsTest')
  try { [void](Initialize-SzhEmplacementsTest) } catch { }
  [void]$taches.Add('Set-SzhEnvironnementSecrets')
  Set-SzhEnvironnementSecrets
  return [ordered]@{ taches = @($taches); ancrage = $ancrage }
}

# L'entrée « Pronto » : l'éditeur, puis la version du cockpit, puis les tâches de démarrage,
# et VSCodium en fenêtre neuve sans dossier. Rend le code de sortie ; sous
# $env:SZH_LANCEUR_SIMULE=1, écrit le plan en JSON au lieu de lancer, et l'absence de
# l'éditeur n'arrête rien.
function Start-SzhAccueil {
  $simule = ($env:SZH_LANCEUR_SIMULE -eq '1')
  $codium = Get-VSCodiumExe
  if ((-not $codium) -and (-not $simule)) { Show-SzhCodiumAbsent; return 1 }

  $version = Get-SzhVersionCockpit
  if (-not (Test-SzhCockpitAccueil $version)) {
    $constat = ('cockpit « {0} », il faut au moins {1}' -f $version, $SzhCockpitAccueilMin)
    Write-SzhLog ('accueil : ' + $constat)
    try { Write-SzhRapport -Code 'ACCUEIL-COCKPIT-ABSENT' -Source 'lanceur' -Etape 'démarrage de l''Accueil' -Message $constat } catch { }
    if ($simule) {
      Write-SzhPlanJson ([ordered]@{ entree = 'accueil'; refus = 'ACCUEIL-COCKPIT-ABSENT'; cockpit = $version; minimum = $SzhCockpitAccueilMin })
      return 1
    }
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show(
      (T 'accueil.cockpit.absent' @($SzhNomApplication, $SzhNomMiseAJour, $SzhSupport)), $SzhNomApplication)
    return 1
  }

  $demarrage = Invoke-SzhTachesDemarrage
  $arguments = @(Get-SzhArgumentsProfil) + @('-n')
  Write-SzhLog ('accueil : ' + $codium + ' ' + ($arguments -join ' '))
  if ($simule) {
    Write-SzhPlanJson ([ordered]@{ entree = 'accueil'; codium = [string]$codium; cockpit = $version
      arguments = $arguments; taches = $demarrage.taches; ancrage = $demarrage.ancrage })
    return 0
  }
  if (Test-Path 'Env:ELECTRON_RUN_AS_NODE') { Remove-Item 'Env:ELECTRON_RUN_AS_NODE' -ErrorAction SilentlyContinue }
  try {
    Start-Process -FilePath $codium -ArgumentList $arguments
    return 0
  } catch {
    Write-SzhLog ('accueil : lancement impossible (' + $_.Exception.Message + ')')
    return 1
  }
}

# ---- Identité de barre des tâches (AppUserModelID) ----
# La barre des tâches groupe les boutons par AppUserModelID et prend l'image associée à
# cet identifiant, pas l'icône de la fenêtre. Sans identité déclarée, nos scripts reçoivent
# celle de powershell.exe, et son icône.
#
# Il faut deux choses :
#   * le processus déclare son identité avant sa première fenêtre : Windows la lit quand la
#     fenêtre s'inscrit à la barre, puis ne la relit plus ;
#   * le .lnk du menu Démarrer porte la même chaîne : le bouton prend alors l'icône du
#     raccourci, et « Épingler à la barre des tâches » épingle le raccourci, pas
#     powershell.exe.
#
# Trois identités : « Pronto » prend celle de VSCodium, qu'il ouvre ; la mise à jour a la
# sienne ; les raccourcis de l'installeur VSCodium en reçoivent une troisième, car le menu
# Démarrer ne montre qu'une entrée par identité et « VSCodium » masquerait « Pronto ».
#
# Un raccourci épinglé est une copie et ne reçoit pas ces identités : il faut le dépingler
# puis le réépingler. Le dossier des épinglages appartient au shell : y écrire reste sans
# effet jusqu'au redémarrage d'explorer.exe.
$script:SzhAppIds = @{
  # Celle de VSCodium (win32AppUserModelId de son product.json) : « Pronto » partage ainsi
  # le bouton de l'éditeur qu'il ouvre.
  'codium' = 'VSCodium.VSCodium'
  'maj'   = 'SZH.Publishing.MiseAJour'
  # Celle des raccourcis posés par l'installeur VSCodium, qu'aucun processus ne déclare.
  'installeur' = 'SZH.Publishing.VSCodium'
}

# Rend '' pour une clé inconnue, sans lever : le bouton prend alors l'icône de PowerShell,
# mais le lanceur s'ouvre.
function Get-SzhAppId([string]$Cle) {
  if ($SzhAppIds.ContainsKey($Cle)) { return $SzhAppIds[$Cle] }
  return ''
}

# Le pont vers le shell, en C# : écrire une propriété de raccourci demande IPropertyStore,
# que seul COM expose (ni WScript.Shell ni PowerShell ne le font). Compilé à la première
# demande : szh-common.ps1 est chargé par tous les scripts, et la compilation coûte une
# demi-seconde.
$script:SzhPontBarre = $null
$script:SzhSourcePontBarre = @'
using System;
using System.Runtime.InteropServices;

namespace Szh {

  // PROPERTYKEY : le GUID d'un jeu de propriétés, et le numéro de l'une d'elles.
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct CleProp {
    public Guid fmtid;
    public uint pid;
  }

  // PROPVARIANT ne sert ici que de tampon : propsys le remplit, ole32 le vide, et rien
  // ci-dessous ne lit ses champs. Ces six-là en couvrent la taille en 32 comme en 64 bits.
  [StructLayout(LayoutKind.Sequential)]
  public struct VarProp {
    public ushort vt;
    public ushort r1;
    public ushort r2;
    public ushort r3;
    public IntPtr p1;
    public IntPtr p2;
  }

  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    void GetCount(out uint nb);
    void GetAt(uint rang, out CleProp cle);
    void GetValue(ref CleProp cle, out VarProp valeur);
    void SetValue(ref CleProp cle, ref VarProp valeur);
    void Commit();
  }

  [ComImport, Guid("0000010b-0000-0000-C000-000000000046"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPersistFile {
    void GetClassID(out Guid classe);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string fichier, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string fichier,
              [MarshalAs(UnmanagedType.Bool)] bool memoriser);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string fichier);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string fichier);
  }

  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  public class LienShell { }

  public static class BarreDesTaches {

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SetCurrentProcessExplicitAppUserModelID(string id);

    [DllImport("ole32.dll", PreserveSig = false)]
    private static extern void PropVariantClear(ref VarProp valeur);

    private const ushort VT_EMPTY = 0;
    private const ushort VT_BSTR = 8;
    private const ushort VT_LPWSTR = 31;

    // PKEY_AppUserModel_ID : {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, propriété 5.
    private static CleProp Cle() {
      CleProp c = new CleProp();
      c.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
      c.pid = 5;
      return c;
    }

    public static void Declarer(string id) {
      SetCurrentProcessExplicitAppUserModelID(id);
    }

    // Charger, écrire, valider, enregistrer : c'est l'ordre qu'impose le shell. Commit()
    // seul ne touche que la copie en mémoire ; sans le Save() final, le .lnk sur le disque
    // reste tel qu'il était.
    public static void Poser(string lnk, string id) {
      object lien = new LienShell();
      try {
        ((IPersistFile)lien).Load(lnk, 2);          // STGM_READWRITE
        CleProp cle = Cle();
        // Le PROPVARIANT monté à la main : propsys.dll n'exporte pas de fabrique pour
        // les chaînes (InitPropVariantFromString est une inline de l'en-tête, pas un
        // symbole). StringToCoTaskMemUni alloue par CoTaskMemAlloc, c'est-à-dire dans
        // l'allocateur que PropVariantClear rendra.
        VarProp valeur = new VarProp();
        valeur.vt = VT_LPWSTR;
        valeur.p1 = Marshal.StringToCoTaskMemUni(id);
        try {
          IPropertyStore magasin = (IPropertyStore)lien;
          magasin.SetValue(ref cle, ref valeur);
          magasin.Commit();
        } finally {
          PropVariantClear(ref valeur);
        }
        ((IPersistFile)lien).Save(lnk, true);
      } finally {
        Marshal.ReleaseComObject(lien);
      }
    }

    // Rend "" quand le raccourci ne porte aucune identité : c'est le cas de tous ceux
    // posés par les versions antérieures, et ce n'est pas une erreur.
    public static string Lire(string lnk) {
      object lien = new LienShell();
      try {
        ((IPersistFile)lien).Load(lnk, 0);          // STGM_READ
        CleProp cle = Cle();
        VarProp valeur;
        ((IPropertyStore)lien).GetValue(ref cle, out valeur);
        try {
          if (valeur.vt == VT_LPWSTR) { return Marshal.PtrToStringUni(valeur.p1); }
          if (valeur.vt == VT_BSTR) { return Marshal.PtrToStringBSTR(valeur.p1); }
          return "";                                // VT_EMPTY, ou un type inattendu
        } finally {
          PropVariantClear(ref valeur);
        }
      } finally {
        Marshal.ReleaseComObject(lien);
      }
    }
  }
}
'@

# Compile le pont au premier appel. Ne lève pas, et ne journalise un échec qu'une fois.
function Initialize-SzhPontBarre {
  if ($null -ne $script:SzhPontBarre) { return $script:SzhPontBarre }
  $script:SzhPontBarre = $false
  try {
    if (-not ('Szh.BarreDesTaches' -as [type])) {
      Add-Type -TypeDefinition $script:SzhSourcePontBarre -ErrorAction Stop
    }
    $script:SzhPontBarre = $true
  } catch {
    Write-SzhLog ('AppUserModelID : pont COM indisponible (' + $_.Exception.Message + ')')
  }
  return $script:SzhPontBarre
}

# À appeler avant la première fenêtre du processus : ensuite, Windows a déjà rangé le
# bouton sous l'identité de powershell.exe.
function Set-SzhAppUserModelId([string]$Id) {
  if (-not $Id) { return $false }
  if (-not (Initialize-SzhPontBarre)) { return $false }
  try {
    [Szh.BarreDesTaches]::Declarer($Id)
    return $true
  } catch {
    Write-SzhLog ('AppUserModelID « ' + $Id + ' » non déclaré : ' + $_.Exception.Message)
    return $false
  }
}

function Set-SzhLnkAppId([string]$Lnk, [string]$Id) {
  if ((-not $Id) -or (-not (Test-Path -LiteralPath $Lnk))) { return $false }
  if (-not (Initialize-SzhPontBarre)) { return $false }
  try {
    [Szh.BarreDesTaches]::Poser((Resolve-Path -LiteralPath $Lnk).Path, $Id)
    return $true
  } catch {
    Write-SzhLog ('AppUserModelID non posé sur ' + $Lnk + ' : ' + $_.Exception.Message)
    return $false
  }
}

function Get-SzhLnkAppId([string]$Lnk) {
  if (-not (Test-Path -LiteralPath $Lnk)) { return '' }
  if (-not (Initialize-SzhPontBarre)) { return '' }
  try {
    return [Szh.BarreDesTaches]::Lire((Resolve-Path -LiteralPath $Lnk).Path)
  } catch {
    return ''
  }
}

# ---- Raccourcis du menu Démarrer ----
# Deux entrées, dans le profil du compte : Pronto et sa mise à jour. Posées par update.ps1,
# par update-launcher.ps1 (à chaque ouverture de session) et par bootstrap.ps1 (poste
# neuf), pour que chaque compte les reçoive sans intervention.
#
# ---- Le nom de l'application ----
# Tout ce que PowerShell affiche lit le nom ici : entrées du menu Démarrer, titres des
# fenêtres, messages de new-revue.ps1 et new-livre.ps1.
#
# Le nom est aussi écrit en toutes lettres dans des textes que PowerShell ne lit pas. Pour
# renommer l'outil, chercher le nom dans tout le dépôt ; notamment :
#   windows/szh-textes.ps1               'lien.introuvable', dans les trois langues
#   vscodium-extension/…/lib/i18n.js     'err.version.lancement', 'ctl.pasrevue',
#                                        'reimport.injoignable', 'etat.barre.test.parametres'
#   vscodium-extension/…/mail-templates/ traduction.fr.twig et traduction.de.twig
#   vscodium-extension/…/package.nls*.json  'tuto.ouvrir.texte'
#   revue-template/BIENVENUE.md, livre-template/BIENVENUE.md
#   windows/Installer le poste SZH.cmd   (où « & » s'échappe en « ^& »)
#
# Le nom devient un nom de fichier .lnk : il ne doit contenir aucun des neuf caractères
# interdits par Windows (« / » compris, sinon CreateShortcut échoue sans message). « & »
# est permis.
#
# Renommer une entrée supprime puis recrée le .lnk, ce qui casse les épinglages.
# Set-SzhRaccourcisMenu retire les anciens noms ; le réépinglage reste à faire à la main.
$script:SzhNomApplication = 'Pronto'
$script:SzhNomMiseAJour   = 'Pronto (Updater)'

# Les entrées du menu : nom du .lnk, cible, arguments, description (infobulle), icône,
# identité de barre des tâches et script lancé.
#
# Les trois produits s'ouvrent depuis l'Accueil du cockpit, et la mise à jour prend la
# langue réglée pour le compte : une entrée de chaque suffit. Le nom de la mise à jour,
# « Pronto (Updater) », ne se traduit pas : un nom de .lnk qui changerait avec la langue
# casserait les épinglages.
#
# Pronto passe par hidden.vbs, sans console. La mise à jour lance powershell.exe
# directement : sa fenêtre montre le téléchargement et les erreurs (Show-SzhErreur propose
# le journal et le courriel au support).
#
# Chaque entrée a une icône (pronto.ico, pronto-maj.ico ; repli sur celle de VSCodium), et
# son AppUserModelID pour que le bouton de la barre des tâches la reprenne (voir
# « Identité de barre des tâches » plus haut).
function Get-SzhRaccourcisMenu {
  param([string]$Toolkit = $SzhToolkit)
  $vbs     = Join-Path $Toolkit 'windows\hidden.vbs'
  $lanceur = Join-Path $Toolkit 'windows\open-revue.ps1'
  $maj     = Join-Path $Toolkit 'windows\update.ps1'
  $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
  # Windows PowerShell 5.1 explicitement : sous PowerShell 7, $PSHOME n'a pas de
  # powershell.exe.
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path $ps)) { $ps = Join-Path $PSHOME 'powershell.exe' }

  $liste = New-Object System.Collections.ArrayList
  # Sans -Produit : l'Accueil suit le produit réglé pour le compte. La description suit
  # $SzhLangue.
  [void]$liste.Add([ordered]@{
    nom    = $SzhNomApplication
    cible  = $wscript
    args   = ('//B "{0}" "{1}"' -f $vbs, $lanceur)
    desc   = $SzhTextes[$SzhLangue]['raccourci.lanceur.desc']
    icone  = (Join-Path $Toolkit 'windows\pronto.ico')
    appid  = (Get-SzhAppId 'codium')
    pilote = $lanceur
  })
  # Sans -Langue : la fenêtre prend la langue réglée pour le compte.
  [void]$liste.Add([ordered]@{
    nom    = $SzhNomMiseAJour
    cible  = $ps
    args   = ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $maj)
    desc   = $SzhTextes[$SzhLangue]['raccourci.maj.desc']
    icone  = (Join-Path $Toolkit 'windows\pronto-maj.ico')
    appid  = (Get-SzhAppId 'maj')
    pilote = $maj
  })
  return $liste
}

# Les anciens noms d'entrées du menu Démarrer, pour la désinstallation : le toolkit peut
# déjà avoir disparu, elle ne peut donc pas lire la cible des .lnk (Set-SzhRaccourcisMenu,
# elle, reconnaît un ancien raccourci à sa cible).
#
# Les anciennes mises à jour se lisent dans la table des textes (raccourci.maj.nom), un nom
# par langue. La liste ne fait que grandir : un poste qui saute des versions doit y trouver
# tout ce qu'il a pu recevoir. « Pronto (dev) » est posé par outils-dev/pronto-dev.ps1 sur le
# poste de développement.
function Get-SzhRaccourcisObsoletes {
  $noms = New-Object System.Collections.ArrayList
  foreach ($n in @('Revues SZH', 'Zeitschriften SZH', 'Books SZH-CSPS',
                   'Revue & Zeitschrift', 'Revue & Zeitschrift (Updater)', 'Pronto (dev)')) { [void]$noms.Add($n) }
  foreach ($langue in @('fr', 'de', 'en')) {
    try {
      $nom = [string]$SzhTextes[$langue]['raccourci.maj.nom']
      if ($nom -and (-not $noms.Contains($nom))) { [void]$noms.Add($nom) }
    } catch { }
  }
  return $noms
}

# Les raccourcis qui visent VSCodium.exe, au premier niveau du menu et dans le dossier
# « VSCodium » de l'installeur, reçoivent pronto.ico (comme dans patch-icone.ps1) et
# l'identité 'installeur' : avec celle de « Pronto », ils l'effaceraient du menu Démarrer.
# Chaque mise à jour de VSCodium les remet dans leur état d'origine, d'où une reprise à
# chaque passage. Rend les noms modifiés.
function Set-SzhRaccourcisCodium([string]$Menu, [string]$Icone, $Shell) {
  $retouches = New-Object System.Collections.ArrayList
  $voulu = ''
  if (Test-Path -LiteralPath $Icone) { $voulu = ('{0},0' -f $Icone) }
  $identite = Get-SzhAppId 'installeur'
  foreach ($dossier in @($Menu, (Join-Path $Menu 'VSCodium'))) {
    if (-not (Test-Path -LiteralPath $dossier)) { continue }
    foreach ($f in @(Get-ChildItem -LiteralPath $dossier -Filter '*.lnk' -File -ErrorAction SilentlyContinue)) {
      try {
        $lnk = $Shell.CreateShortcut($f.FullName)
        $cible = [string]$lnk.TargetPath
        if ((-not $cible) -or ((Split-Path $cible -Leaf) -ne 'VSCodium.exe')) { continue }
        $retouche = $false
        if ($voulu -and ([string]$lnk.IconLocation -ne $voulu)) {
          $lnk.IconLocation = $voulu
          $lnk.Save()
          $retouche = $true
        }
        # Après Save() : WScript.Shell réécrit le fichier entier.
        if ((Get-SzhLnkAppId $f.FullName) -ne $identite) {
          if (Set-SzhLnkAppId $f.FullName $identite) { $retouche = $true }
        }
        if ($retouche) { [void]$retouches.Add($f.Name) }
      } catch { }
    }
  }
  return $retouches
}

# Pose les entrées ci-dessus et retire les anciennes. Ne lève pas : un menu verrouillé par
# stratégie de groupe ne fait pas échouer la mise à jour. Rend un bilan (poses, retires,
# manques, codium) que l'appelant journalise. $Menu permet de tester hors du vrai menu.
function Set-SzhRaccourcisMenu {
  param(
    [string]$Menu    = '',
    [string]$Toolkit = $SzhToolkit
  )
  if (-not $Menu) { $Menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs' }
  $bilan = [ordered]@{
    poses   = New-Object System.Collections.ArrayList
    retires = New-Object System.Collections.ArrayList
    manques = New-Object System.Collections.ArrayList
    codium  = New-Object System.Collections.ArrayList
  }
  $voulus = @(Get-SzhRaccourcisMenu -Toolkit $Toolkit)
  $canoniques = @{}
  foreach ($r in $voulus) { $canoniques[($r.nom + '.lnk').ToLower()] = $true }

  $shell = $null
  try {
    New-Item -ItemType Directory -Force -Path $Menu | Out-Null
    $shell = New-Object -ComObject WScript.Shell
  } catch {
    # Dossier non inscriptible ou COM indisponible : une seule ligne de bilan.
    [void]$bilan.manques.Add(('menu Démarrer inaccessible ({0}) : {1}' -f $Menu, $_.Exception.Message))
    return $bilan
  }

  $codium = Get-VSCodiumExe
  foreach ($r in $voulus) {
    try {
      # Script absent : pas de raccourci vers rien. Un raccourci existant est laissé tel quel.
      if (-not (Test-Path $r.pilote)) {
        [void]$bilan.manques.Add(('{0} : non posé, {1} manque au toolkit — celui-ci est incomplet, la tâche planifiée le réinstalle à la prochaine ouverture de session.' -f $r.nom, (Split-Path $r.pilote -Leaf)))
        continue
      }
      $lnk = $shell.CreateShortcut((Join-Path $Menu ($r.nom + '.lnk')))
      $lnk.TargetPath  = $r.cible
      $lnk.Arguments   = $r.args
      $lnk.Description = $r.desc
      $lnk.WindowStyle = 1        # fenêtre normale : la mise à jour doit se voir
      if (Test-Path $r.icone) { $lnk.IconLocation = ('{0},0' -f $r.icone) }
      elseif ($codium) { $lnk.IconLocation = $codium }
      $lnk.Save()
      # L'identité après Save() : WScript.Shell réécrit le fichier entier. En cas d'échec,
      # l'entrée fonctionne, avec l'icône de PowerShell dans la barre des tâches.
      if ($r.appid -and (-not (Set-SzhLnkAppId (Join-Path $Menu ($r.nom + '.lnk')) $r.appid))) {
        [void]$bilan.manques.Add(('{0} : identité de barre des tâches non posée, le bouton de la barre gardera l''icône de PowerShell.' -f $r.nom))
      }
      [void]$bilan.poses.Add($r.nom)
    } catch {
      [void]$bilan.manques.Add(('{0} : {1}' -f $r.nom, $_.Exception.Message))
    }
  }

  foreach ($n in @(Set-SzhRaccourcisCodium $Menu (Join-Path $Toolkit 'windows\pronto.ico') $shell)) {
    [void]$bilan.codium.Add($n)
    Write-SzhLog ('raccourcis : icône et identité posées sur ' + $n + ', qui vise VSCodium')
  }

  # Aucune entrée écrite : une ligne qui explique la cause probable et les autres accès à
  # la mise à jour.
  if (($bilan.poses.Count -eq 0) -and ($bilan.manques.Count -gt 0)) {
    [void]$bilan.manques.Add(('aucune entrée n''a pu être écrite dans « {0} » : ce dossier refuse l''écriture, le plus souvent parce qu''une stratégie de groupe tient le menu Démarrer. Rien d''autre n''est affecté, et la mise à jour reste atteignable par le bouton « Changer de version… » du lanceur et par la tâche planifiée qui la déclenche.' -f $Menu))
  }

  # Retire tout .lnk qui lance un de nos scripts sans porter un des noms voulus : c'est un
  # ancien raccourci. On le reconnaît à sa cible, pas à son nom, ce qui couvre tous les
  # renommages. Premier niveau du menu seulement : le sous-dossier « SZH » appartient à un
  # autre produit.
  $nos = @('open-revue.ps1', 'open-livre.ps1', 'open-produit.ps1', 'update.ps1')
  try {
    foreach ($f in @(Get-ChildItem -LiteralPath $Menu -Filter '*.lnk' -File -ErrorAction Stop)) {
      if ($canoniques.ContainsKey($f.Name.ToLower())) { continue }
      $vise = $false
      try {
        $vieux = $shell.CreateShortcut($f.FullName)
        $ligne = (([string]$vieux.TargetPath) + ' ' + ([string]$vieux.Arguments)).ToLower()
        foreach ($n in $nos) { if ($ligne -like ('*' + $n + '*')) { $vise = $true } }
      } catch { $vise = $false }
      if ($vise) {
        Remove-Item -LiteralPath $f.FullName -Force
        [void]$bilan.retires.Add($f.Name)
      }
    }
  } catch {
    [void]$bilan.manques.Add(('nettoyage des anciens raccourcis : ' + $_.Exception.Message))
  }
  return $bilan
}

# ---- Raccourci « Ouvrir la revue » (ou « Ouvrir le livre ») ----
# Ce raccourci vit dans le dossier du numéro et voyage avec lui sur OneDrive. Aucun de ses
# chemins ne dépend donc du poste ni du compte :
#
#   cible      %WINDIR%\System32\wscript.exe
#   arguments  //B "<toolkit>\windows\hidden.vbs" "<toolkit>\windows\open-revue.ps1" "szh://ouvrir/<produit>/<numero>"
#   icône      "<toolkit>\windows\<icône du produit>",0
#
# <toolkit> est $SzhToolkit, sous C:\ProgramData, identique sur tous les postes. La
# composition est celle du protocole szh: (Set-SzhProtocoleSzh, update.ps1). Le numéro est
# désigné par un lien szh:// que le lanceur résout dans les racines du poste
# (Find-SzhProduitOuvrir) : un dossier archivé ou déplacé est retrouvé. Pas de
# WorkingDirectory, qui réintroduirait un chemin du poste.
#
# Ne lève pas ; rend $false si le raccourci n'a pas pu être posé.
#
# $NomLien et $Description valent par défaut ceux de la revue ; new-livre.ps1 passe les
# siens. $Produit vide : lu sur le disque (Get-SzhJetonDossier). Le lien porte l'`id:` du
# manifeste, posé s'il manque (Set-SzhAusgabeIdSiAbsent), pas le nom du dossier.
function Set-SzhRaccourciRevue([string]$Dossier, [string]$NomLien = 'Ouvrir la revue', [string]$Description = 'Ouvrir cette revue dans l''éditeur', [string]$Produit = '') {
  try {
    $chemin = (Resolve-Path -LiteralPath $Dossier -ErrorAction Stop).Path
    $jeton = ([string]$Produit).Trim().ToLower()
    if (-not $SzhProduits.ContainsKey($jeton)) { $jeton = Get-SzhJetonDossier $chemin }
    if (-not $jeton) { return $false }
    $manifeste = [string](Get-SzhProduitInfo $jeton).manifeste
    [void](Set-SzhAusgabeIdSiAbsent $chemin $manifeste)
    $valeurs = Get-SzhAusgabe (Join-Path $chemin $manifeste)
    $id = ''
    if ($valeurs.ContainsKey('id')) { $id = $valeurs['id'] }
    # Un id absent ou mal formé ne donne pas de lien, donc pas de raccourci.
    $lien = New-SzhLienOuvrir $jeton $id
    if (-not $lien) { return $false }

    $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
    $vbs     = Join-Path $SzhToolkit 'windows\hidden.vbs'
    $lanceur = Join-Path $SzhToolkit 'windows\open-revue.ps1'
    $icone   = Join-Path $SzhToolkit ('windows\' + (Get-SzhProduitInfo $jeton).icone)

    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut((Join-Path $chemin ($NomLien + '.lnk')))
    $lnk.TargetPath = $wscript
    $lnk.Arguments = ('//B "{0}" "{1}" "{2}"' -f $vbs, $lanceur, $lien)
    # Sans .ico, rien n'est posé (un chemin absent donnerait un carré blanc).
    if (Test-Path $icone) { $lnk.IconLocation = ('{0},0' -f $icone) }
    $lnk.Description = $Description
    $lnk.Save()
    return $true
  } catch {
    try { Write-SzhLog ('raccourci du numero : ' + $_.Exception.Message) } catch { }
    return $false
  }
}

# ---- Scripts du cockpit, sous le Node de VSCodium ----
# Les scripts d'outils\ de l'extension du cockpit tournent sous le Node embarqué par
# VSCodium : ELECTRON_RUN_AS_NODE=1, sans quoi VSCodium.exe ouvre une fenêtre d'éditeur.

# Échappe un argument de ligne de commande selon la règle Windows (guillemets, barres
# obliques inverses) : ProcessStartInfo.Arguments est une seule chaîne, et les chemins
# OneDrive contiennent des espaces.
function ConvertTo-SzhArgumentEchappe([string]$Valeur) {
  if ($null -eq $Valeur) { $Valeur = '' }
  if ($Valeur -eq '') { return '""' }
  if ($Valeur -notmatch '[\s"]') { return $Valeur }
  $resultat = '"'
  $nbBarres = 0
  foreach ($caractere in $Valeur.ToCharArray()) {
    if ($caractere -eq '\') {
      $nbBarres++
      $resultat += $caractere
    } elseif ($caractere -eq '"') {
      $resultat += ('\' * $nbBarres) + '\"'
      $nbBarres = 0
    } else {
      $nbBarres = 0
      $resultat += $caractere
    }
  }
  $resultat += ('\' * $nbBarres) + '"'
  return $resultat
}
function ConvertTo-SzhArguments([string[]]$Valeurs) {
  return (($Valeurs | ForEach-Object { ConvertTo-SzhArgumentEchappe $_ }) -join ' ')
}

# Le script d'outils\ demandé, dans l'extension du cockpit la plus récente. Lève un message
# précis (dossier d'extension absent, ou script absent de ce dossier).
function Get-SzhOutilCockpit {
  param(
    [Parameter(Mandatory = $true)][string]$Outil
  )
  $dossierCockpit = Get-SzhDossierCockpit
  if ($dossierCockpit) {
    $scriptCandidat = Join-Path $dossierCockpit ('outils\' + $Outil)
    if (Test-Path -LiteralPath $scriptCandidat) { return $scriptCandidat }
  }
  if (-not $dossierCockpit) { throw 'dossier de l''extension du cockpit introuvable' }
  throw ('outils\' + $Outil + ' introuvable dans ' + $dossierCockpit)
}

# Lance un script d'outils\ sous VSCodium-en-Node : -Entree (objet, converti en JSON, ou texte
# JSON déjà prêt) sur stdin, tout stdout rendu dans .Sortie. Rend .Demarre, .CodeSortie,
# .Sortie et .Erreur (stderr).
#
# stdout et stderr sont lus par des Task .NET (ReadToEndAsync) : un gestionnaire
# d'évènement PowerShell (add_ErrorDataReceived, BeginErrorReadLine) s'exécute hors pipeline
# et peut tuer tout le processus PowerShell sans exception à attraper. La lecture de stderr
# démarre en premier, pour qu'aucun tube ne sature et ne bloque l'enfant.
function Invoke-SzhNodeCockpit {
  param(
    [Parameter(Mandatory = $true)][string]$Outil,
    [string]$Codium = '',
    [string[]]$Arguments = @(),
    $Entree = $null,
    [hashtable]$Environnement = @{}
  )
  $resultat = [pscustomobject]@{ Demarre = $false; CodeSortie = $null; Sortie = ''; Erreur = '' }
  if (-not $Codium) {
    $Codium = Get-VSCodiumExe
    if (-not $Codium) { throw 'VSCodium introuvable sur ce poste' }
  }
  $cheminOutil = Get-SzhOutilCockpit -Outil $Outil

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Codium
  $psi.Arguments = ConvertTo-SzhArguments (@($cheminOutil) + $Arguments)
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
  foreach ($nomVariable in $Environnement.Keys) { $psi.EnvironmentVariables[[string]$nomVariable] = [string]$Environnement[$nomVariable] }

  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  if ($null -ne $Entree) { $psi.RedirectStandardInput = $true }

  $processus = New-Object System.Diagnostics.Process
  $processus.StartInfo = $psi
  try {
    [void]$processus.Start()
    $resultat.Demarre = $true
    $tacheErreur = $processus.StandardError.ReadToEndAsync()
    $tacheSortie = $processus.StandardOutput.ReadToEndAsync()

    if ($null -ne $Entree) {
      $texteEntree = $Entree
      if ($Entree -isnot [string]) { $texteEntree = $Entree | ConvertTo-Json -Depth 6 -Compress }
      # UTF-8 sans BOM : un BOM ferait échouer JSON.parse() côté Node.
      $octetsEntree = (New-Object System.Text.UTF8Encoding($false)).GetBytes([string]$texteEntree)
      $processus.StandardInput.BaseStream.Write($octetsEntree, 0, $octetsEntree.Length)
      $processus.StandardInput.Close()
    }

    [System.Threading.Tasks.Task]::WaitAll(@($tacheSortie, $tacheErreur))
    $processus.WaitForExit()
    $resultat.Sortie = $tacheSortie.Result.TrimStart([char]0xFEFF)
    $resultat.CodeSortie = $processus.ExitCode
    $resultat.Erreur = $tacheErreur.Result
    return $resultat
  } finally {
    try {
      if ($processus -and -not $processus.HasExited) { $processus.Kill() }
      if ($processus) { $processus.Dispose() }
    } catch { }
  }
}
