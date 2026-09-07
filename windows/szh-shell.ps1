# Identité de barre des tâches (AppUserModelID) et son pont C#, raccourcis du menu Démarrer,
# ouverture d'un dossier dans VSCodium.
# Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).

# ---- Ouverture d'un dossier dans VSCodium ----
# Ici, l'environnement doit être assaini (ELECTRON_RUN_AS_NODE ci-dessus ; la garde est
# répétée, un script pouvant régler ses variables après le dot-source) et un échec doit se
# voir dans le journal. open-md.ps1 a son propre lanceur, Start-SzhCodiumFichier, et ne passe
# pas par ici : il doit ouvrir deux chemins d'un coup (le dossier de revue et le fichier, pour
# que l'aperçu comme la régénération s'activent) et porte un mode simulation pour les tests
# (SZH_OPENMD_SIMULE=1), deux besoins que cette fonction-ci n'a pas. Garder les deux noms
# distincts et corrects : une redéfinition locale de Start-SzhCodium occulterait celle-ci en
# silence.
function Start-SzhCodium([string]$Dossier) {
  $codium = Get-VSCodiumExe
  if (-not $codium) {
    Write-SzhLog ('codium : introuvable, impossible d''ouvrir ' + $Dossier)
    return $false
  }
  if (Test-Path 'Env:ELECTRON_RUN_AS_NODE') { Remove-Item 'Env:ELECTRON_RUN_AS_NODE' -ErrorAction SilentlyContinue }
  try {
    Start-Process -FilePath $codium -ArgumentList ('"{0}"' -f $Dossier)
    return $true
  } catch {
    Write-SzhLog ('codium : lancement impossible (' + $_.Exception.Message + ') pour ' + $Dossier)
    return $false
  }
}

# ---- Identité de barre des tâches (AppUserModelID) ----
# La barre des tâches ne prend pas l'icône de la fenêtre : elle groupe les boutons par
# AppUserModelID et va chercher l'image de ce côté-là. Un processus qui n'en déclare aucun
# s'en voit attribuer un, déduit de son exécutable hôte — powershell.exe pour nos lanceurs,
# ouverts par hidden.vbs —, et le bouton porte alors l'icône de PowerShell. L'icône posée
# sur la fenêtre (Set-SzhIconeFenetre, dans open-produit.ps1) ne se voit plus alors que dans
# le bandeau de titre et dans Alt+Tab, jamais dans la barre.
#
# Il faut les deux moitiés :
#   * le processus déclare son identité avant sa première fenêtre — Windows lit
#     l'AppUserModelID quand la fenêtre s'inscrit à la barre, et ne le relit pas ensuite ;
#   * le .lnk du menu Démarrer porte la même chaîne. C'est elle qui fait que le bouton et
#     le raccourci ne font qu'un : le bouton reprend l'icône du raccourci — donc la même
#     image qu'au menu Démarrer — et « Épingler à la barre des tâches » épingle le lanceur
#     au lieu d'épingler powershell.exe.
#
# Une identité par programme : les trois lanceurs de produit ont chacun la leur, sans quoi
# ils ne feraient qu'un seul bouton et l'icône ne distinguerait plus la Revue de la
# Zeitschrift. Les deux entrées de mise à jour partagent la leur : c'est le même
# update.ps1, la même icône, et seule la langue de la fenêtre les sépare — les voir
# groupées sous un bouton est ce qu'on veut.
#
# ⚠ Un raccourci déjà épinglé est une copie, faite avant que ces identités existent : elle
# ne les porte pas. Il faut dépingler puis réépingler une fois, geste laissé au rédacteur —
# le dossier des épinglages est tenu par le shell, et y écrire reste sans effet jusqu'au
# redémarrage d'explorer.exe.
# Une identité par entrée de menu, et non par script. Windows tient l'AppUserModelID pour
# l'identité de l'application et ne garde qu'une entrée par identité : les deux mises à
# jour, qui partageaient « SZH.Publishing.MiseAJour », ne s'affichaient qu'une fois dans le
# menu Démarrer — l'allemande sur un poste francophone, le .lnk français présent sur le
# disque mais absent de Get-StartApps. Le nom sans langue reste le repli des fenêtres
# lancées autrement que par le menu.
# Le livre n'a qu'une entrée de menu (contrairement à la mise à jour, qui en a deux) : une
# seule identité lui suffit, jamais partagée avec aucune des cinq autres.
$script:SzhAppIds = @{
  'revue'       = 'SZH.Publishing.Revue'
  'zeitschrift' = 'SZH.Publishing.Zeitschrift'
  'livre'       = 'SZH.Publishing.Livres'
  'maj'         = 'SZH.Publishing.MiseAJour'
  'maj.fr'      = 'SZH.Publishing.MiseAJour.fr'
  'maj.de'      = 'SZH.Publishing.MiseAJour.de'
}

# Rend '' pour une clé inconnue plutôt que de lever : sans identité on retombe sur le
# comportement d'avant, une icône de PowerShell, et non sur un lanceur qui ne s'ouvre pas.
function Get-SzhAppId([string]$Cle) {
  if ($SzhAppIds.ContainsKey($Cle)) { return $SzhAppIds[$Cle] }
  return ''
}

# Le pont vers le shell, en C# : ni WScript.Shell ni aucune applet PowerShell ne sait
# écrire une propriété de raccourci — il y faut IPropertyStore, que seul COM expose.
# Compilé à la première demande et non au dot-source : szh-common.ps1 est chargé par tous
# les scripts, y compris ceux qui n'ouvrent aucune fenêtre, et une compilation C# leur
# coûterait une demi-seconde pour rien.
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

# Ne lève jamais et ne se plaint qu'une fois : une identité de barre des tâches est un
# confort d'affichage, pas une condition d'ouverture d'un lanceur.
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

# À appeler avant la première fenêtre du processus. Voir le commentaire d'en-tête : passé
# ce moment, Windows a déjà rangé le bouton sous l'identité déduite de powershell.exe.
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
# Cinq entrées, au niveau utilisateur : les trois lanceurs de produit et les deux entrées
# de mise à jour. Posées par update.ps1 (mise à jour), par update-launcher.ps1 (à chaque
# ouverture de session) et par bootstrap.ps1 (poste neuf), pour qu'un poste déjà à jour
# comme un poste sortant de sa boîte finisse par les avoir sans que personne n'intervienne,
# et chacun dans le profil du rédacteur qui ouvre la session.
#
# Pourquoi deux entrées de mise à jour, une française et une allemande, plutôt qu'une seule
# renommée selon la langue du poste ? Parce qu'un nom de fichier .lnk est figé alors que la
# langue de l'interface bouge (variable d'environnement, préférence retenue dans state.json,
# langue de Windows). Renommer à chaque mise à jour aurait trois défauts : sur un poste neuf
# la langue résolue est l'anglais — les Windows d'ici sont en anglais et state.json est
# encore muet —, c'est-à-dire la seule langue qu'aucune des deux équipes n'emploie ; le nom
# changerait sous les doigts du rédacteur dès qu'un collègue ouvre l'autre lanceur, alors
# qu'on ne retrouve une entrée du menu Démarrer qu'en tapant son nom ; et un renommage
# revient à supprimer puis recréer, ce qui casse l'épinglage. Deux noms fixes, chacun
# portant sa langue à update.ps1 : c'est déjà ce que font « Revues SZH » et
# « Zeitschriften SZH », qui cohabitent sur tous les postes. Ajouter 'en' ici y ajouterait
# une troisième entrée.
$script:SzhLanguesRaccourci = @('fr', 'de')

# Ce que le menu doit porter, une ligne par entrée : le nom du .lnk, sa cible, ses
# arguments, sa description (l'infobulle), son icône, et le script qu'elle pilote.
#
# Les deux lanceurs passent par hidden.vbs, qui lance sans console : une fenêtre noire
# devant un lanceur graphique n'apprendrait rien à personne. La mise à jour, elle, vise
# powershell.exe en direct : elle télécharge, elle prend plusieurs minutes, elle peut
# échouer, et sa fenêtre est la seule chose qui le montre — c'est aussi là que
# Show-SzhErreur propose le journal et l'e-mail au support.
#
# Chaque entrée porte une icône (windows/icone.py) : épinglée à la barre des tâches, elle
# perd son libellé et l'icône devient le seul repère. Sans IconLocation le shell affiche
# celle de wscript.exe, qui ne dit rien à personne ; d'où le repli sur celle de VSCodium.
# Elle porte aussi son AppUserModelID : l'icône du raccourci ne vaut que pour le menu, et
# c'est cette identité-là qui la fait suivre jusqu'au bouton de la barre des tâches.
# Voir « Identité de barre des tâches » ci-dessus.
function Get-SzhRaccourcisMenu {
  param([string]$Toolkit = $SzhToolkit)
  $vbs     = Join-Path $Toolkit 'windows\hidden.vbs'
  $lanceur = Join-Path $Toolkit 'windows\open-revue.ps1'
  $lanceurLivre = Join-Path $Toolkit 'windows\open-livre.ps1'
  $maj     = Join-Path $Toolkit 'windows\update.ps1'
  $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
  # Windows PowerShell 5.1 explicitement : $PSHOME désignerait pwsh si la mise à jour
  # avait été lancée depuis PowerShell 7, et pwsh n'a pas de powershell.exe à côté.
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path $ps)) { $ps = Join-Path $PSHOME 'powershell.exe' }

  $liste = New-Object System.Collections.ArrayList
  # « Revues SZH » et « Zeitschriften SZH » sont des noms de produit, pas des phrases à
  # traduire : ils ne bougent pas, des épinglages les désignent. Le produit est passé
  # explicitement des deux côtés, pour qu'un raccourci ancien ne montre pas les deux listes
  # mêlées. Chacun s'adresse à son équipe, donc chacun décrit dans sa langue.
  [void]$liste.Add([ordered]@{
    nom    = 'Revues SZH'
    cible  = $wscript
    args   = ('//B "{0}" "{1}" "-Produit" "revue"' -f $vbs, $lanceur)
    desc   = $SzhTextes['fr']['raccourci.revue.desc']
    icone  = (Join-Path $Toolkit 'windows\szh-revue.ico')
    appid  = (Get-SzhAppId 'revue')
    pilote = $lanceur
  })
  [void]$liste.Add([ordered]@{
    nom    = 'Zeitschriften SZH'
    cible  = $wscript
    args   = ('//B "{0}" "{1}" "-Produit" "zeitschrift"' -f $vbs, $lanceur)
    desc   = $SzhTextes['de']['raccourci.zs.desc']
    icone  = (Join-Path $Toolkit 'windows\szh-zeitschrift.ico')
    appid  = (Get-SzhAppId 'zeitschrift')
    pilote = $lanceur
  })
  # « Books SZH-CSPS » : un troisième produit, sans langue à lui — un livre s'écrit dans sa
  # langue (`lang:` de buch.yaml), jamais celle du lanceur qui les liste. La description
  # suit donc $SzhLangue, la langue déjà résolue en tête de ce fichier (variable
  # d'environnement, préférence retenue, langue de Windows), au lieu d'un « fr » ou « de »
  # figé comme pour les deux autres produits. Le caractère « / » n'est pas de mise dans un nom de fichier
  # .lnk (Windows le lit comme un séparateur de chemin) : le nom du raccourci et de la
  # fenêtre s'écrit donc « Books SZH-CSPS », trait d'union, partout où c'est un nom de
  # fichier ou une identité, pas seulement ici.
  [void]$liste.Add([ordered]@{
    nom    = 'Books SZH-CSPS'
    cible  = $wscript
    args   = ('//B "{0}" "{1}"' -f $vbs, $lanceurLivre)
    desc   = $SzhTextes[$SzhLangue]['raccourci.livre.desc']
    icone  = (Join-Path $Toolkit 'windows\szh-livre.ico')
    appid  = (Get-SzhAppId 'livre')
    pilote = $lanceurLivre
  })
  foreach ($langue in $SzhLanguesRaccourci) {
    [void]$liste.Add([ordered]@{
      nom    = $SzhTextes[$langue]['raccourci.maj.nom']
      cible  = $ps
      args   = ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -Langue {1}' -f $maj, $langue)
      desc   = $SzhTextes[$langue]['raccourci.maj.desc']
      icone  = (Join-Path $Toolkit 'windows\szh-maj.ico')
      appid  = (Get-SzhAppId ('maj.' + $langue))
      pilote = $maj
    })
  }
  return $liste
}

# Pose les entrées ci-dessus et retire celles d'une version antérieure. Ne lève jamais :
# un menu Démarrer verrouillé par une stratégie de groupe ne doit pas faire échouer une
# mise à jour par ailleurs réussie. Rend un bilan — poses, retires, manques — que
# l'appelant écrit au journal, car un raccourci absent qui ne se dit pas est introuvable.
# $Menu est paramétrable pour éprouver la fonction hors du vrai menu Démarrer.
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
  }
  $voulus = @(Get-SzhRaccourcisMenu -Toolkit $Toolkit)
  $canoniques = @{}
  foreach ($r in $voulus) { $canoniques[($r.nom + '.lnk').ToLower()] = $true }

  $shell = $null
  try {
    New-Item -ItemType Directory -Force -Path $Menu | Out-Null
    $shell = New-Object -ComObject WScript.Shell
  } catch {
    # Dossier non inscriptible, ou COM indisponible : rien ne sera posé, et c'est tout ce
    # qu'on peut en dire. On le dit une fois, pas quatre.
    [void]$bilan.manques.Add(('menu Démarrer inaccessible ({0}) : {1}' -f $Menu, $_.Exception.Message))
    return $bilan
  }

  $codium = Get-VSCodiumExe
  foreach ($r in $voulus) {
    try {
      # Pas de raccourci mort : un .lnk vers un script absent ne ferait que clignoter. Un
      # raccourci déjà en place est alors laissé tel quel plutôt que remplacé par du vide.
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
      # L'identité vient après Save() : WScript.Shell réécrit le fichier entier et
      # effacerait une propriété posée avant lui. Un échec ici ne retire pas l'entrée du
      # menu — elle s'ouvre, elle n'a que la mauvaise icône dans la barre des tâches.
      if ($r.appid -and (-not (Set-SzhLnkAppId (Join-Path $Menu ($r.nom + '.lnk')) $r.appid))) {
        [void]$bilan.manques.Add(('{0} : identité de barre des tâches non posée, le bouton de la barre gardera l''icône de PowerShell.' -f $r.nom))
      }
      [void]$bilan.poses.Add($r.nom)
    } catch {
      [void]$bilan.manques.Add(('{0} : {1}' -f $r.nom, $_.Exception.Message))
    }
  }

  # Une seule ligne suffit à dire qu'un dossier entier se refuse, et elle doit dire la
  # suite : rien ne s'arrête pour autant, et la mise à jour garde deux autres portes.
  if (($bilan.poses.Count -eq 0) -and ($bilan.manques.Count -gt 0)) {
    [void]$bilan.manques.Add(('aucune entrée n''a pu être écrite dans « {0} » : ce dossier refuse l''écriture, le plus souvent parce qu''une stratégie de groupe tient le menu Démarrer. Rien d''autre n''est affecté, et la mise à jour reste atteignable par le bouton « Changer de version… » du lanceur et par la tâche planifiée qui la déclenche.' -f $Menu))
  }

  # Un raccourci d'une version antérieure, mal nommé, doublerait l'entrée sans jamais
  # disparaître : on retire donc tout .lnk qui pilote un de nos scripts sans porter l'un
  # des noms voulus. Un raccourci bien nommé mais pointant ailleurs a déjà été corrigé
  # ci-dessus, CreateShortcut réécrivant le fichier existant. Le premier niveau du menu
  # seulement : le sous-dossier « SZH » appartient à un autre produit, et rien ici ne doit
  # y toucher.
  $nos = @('open-revue.ps1', 'open-livre.ps1', 'update.ps1')
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
# Le raccourci vit dans le dossier de revue et porte son chemin absolu : à réécrire à
# chaque déplacement, sinon il rouvre un chemin disparu. Ne lève pas si VSCodium manque,
# c'est un confort et non la condition du déplacement.
# `$NomLien`/`$Description` par défaut : ceux de la revue, pour que new-revue.ps1 n'ait rien
# à changer ; new-livre.ps1 passe les siens.
function Set-SzhRaccourciRevue([string]$Dossier, [string]$NomLien = 'Ouvrir la revue', [string]$Description = 'Ouvrir cette revue dans l''éditeur') {
  $codium = Get-VSCodiumExe
  if (-not $codium) { return $false }
  $chemin = (Resolve-Path -LiteralPath $Dossier).Path
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut((Join-Path $chemin ($NomLien + '.lnk')))
  $lnk.TargetPath = $codium
  $lnk.Arguments = ('"{0}"' -f $chemin)
  $lnk.IconLocation = $codium
  $lnk.Description = $Description
  $lnk.Save()
  return $true
}
