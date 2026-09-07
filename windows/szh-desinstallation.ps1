<#
  Le plan de désinstallation du poste SZH : ce qu'il faut retirer, et ce qu'il faut
  conserver. Dot-sourcé après le socle (szh-common.ps1 puis szh-taches.ps1, dans cet
  ordre -- voir bootstrap.ps1) par windows/uninstall.ps1, qui seul décide quand agir.

  Trois fonctions, pures autant que possible :
    Get-SzhPlanDesinstallation   construit le plan (jamais n'agit)
    Invoke-SzhPlanDesinstallation applique un plan déjà construit
    Format-SzhPlanDesinstallation rend le plan lisible, en français

  Ce que ce fichier ne fait JAMAIS, sous aucune option :
    - désinscrire la distribution WSL (elle et son enregistrement sont conservés) ;
    - supprimer C:\ProgramData\SZH\WSL\ ou l'un de ses sous-dossiers (les disques des
      distributions, un par compte -- Get-SzhDossierDistro, szh-common.ps1) ;
    - un Remove-Item sur $SzhBase lui-même (la racine reste, avec son ACL, tant que
      WSL\ existe).
  Ces trois refus sont vérifiés par test/js/desinstallation.test.js et par la garde
  Assert-SzhCibleMachineAutorisee ci-dessous, réappliquée avant CHAQUE suppression
  d'une entrée « fichier-machine » -- même patron que Clear-SzhDossierDistro
  (szh-common.ps1) : un nom de dossier vérifié juste avant l'opération qui le retire,
  jamais une seule fois en amont.

  Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#>

# ---- Une entrée de plan : toujours les quatre mêmes champs ----
function New-SzhPlanEntree {
  param(
    [Parameter(Mandatory = $true)][string]$Type,
    [string]$Cible = '',
    [string]$Detail = '',
    [bool]$Present = $false
  )
  return [pscustomobject]@{ type = $Type; cible = $Cible; detail = $Detail; present = $Present }
}

# ---- La garde : jamais WSL, jamais la racine ----
# Réutilisée à la construction du plan (ci-dessous, sur la liste fixe -- une tripwire pour
# une future liste mal modifiée) ET à l'exécution (Invoke-SzhPlanDesinstallation, sur un
# plan qui pourrait avoir été forgé à la main). Chemins comparés sans casse ni barre de fin,
# comme Clear-SzhDossierDistro.
function Assert-SzhCibleMachineAutorisee {
  param(
    [Parameter(Mandatory = $true)][string]$Base,
    [Parameter(Mandatory = $true)][string]$Cible
  )
  $baseNorm = $Base.TrimEnd('\')
  $cibleNorm = $Cible.TrimEnd('\')
  $wslNorm = (Join-Path $baseNorm 'WSL')
  if ($cibleNorm -ieq $baseNorm) {
    throw ('refus : « ' + $Cible + ' » est la racine SZH elle-même -- jamais une cible de fichier-machine.')
  }
  if (($cibleNorm -ieq $wslNorm) -or ($cibleNorm -ilike ($wslNorm + '\*'))) {
    throw ('refus : « ' + $Cible + ' » est sous WSL\ -- les disques des distributions ne sont jamais touchés.')
  }
}

# Les onze entrées « machine » directement sous $SzhBase, chacune avec ce qu'elle est.
# Ordre sans conséquence pour le plan (Format- et Invoke- regroupent par type), mais gardé
# stable pour la lisibilité d'un diff.
function Get-SzhNomsFichiersMachine {
  return @(
    [ordered]@{ nom = 'toolkit';        detail = 'toolkit installé (pipeline, gabarits, extensions figées)' }
    [ordered]@{ nom = 'toolkit.neuf';   detail = 'reste d''une bascule de toolkit interrompue' }
    [ordered]@{ nom = 'toolkit.vieux';  detail = 'reste d''une bascule de toolkit interrompue' }
    [ordered]@{ nom = 'staging';        detail = 'archives et manifestes déjà téléchargés' }
    [ordered]@{ nom = 'logs';           detail = 'journaux du poste' }
    [ordered]@{ nom = 'comptes';        detail = 'état par compte (postes sans %LOCALAPPDATA%)' }
    [ordered]@{ nom = 'config.json';    detail = 'configuration du poste (dépôt, emplacements des revues)' }
    [ordered]@{ nom = 'state.json';     detail = 'état du poste (version du toolkit installée)' }
    [ordered]@{ nom = 'auteurs.json';   detail = 'cache des auteurs (moissonnage ojs.szh.ch)' }
    [ordered]@{ nom = 'mots-cles.json'; detail = 'cache des mots-clés (edudoc)' }
    [ordered]@{ nom = 'maj-auto.json';  detail = 'reste d''un ancien emplacement de la cadence de mise à jour (déplacée chez l''utilisateur, voir update.ps1)' }
  )
}

# Les extensions VSCodium à retirer : celles épinglées dans vsix.lock (le toolkit peut déjà
# avoir disparu, d'où le repli figé -- une liste légèrement périmée ne fait qu'échouer
# proprement sur une extension déjà absente d'un poste, jamais plus), plus les deux
# extensions maison, qui ne sont pas dans vsix.lock (elles ne sont pas tierces).
function Get-SzhIdsExtensions {
  param([string]$Toolkit = $SzhToolkit)
  $ids = @()
  try {
    $lock = Join-Path $Toolkit 'vsix.lock'
    if (Test-Path -LiteralPath $lock) {
      $donnees = Get-Content -LiteralPath $lock -Raw -Encoding UTF8 | ConvertFrom-Json
      $ids = @($donnees.extensions | ForEach-Object { [string]$_.id })
    }
  } catch { $ids = @() }
  if ($ids.Count -eq 0) {
    # Repli, identique à windows/vsix.lock au moment d'écrire ce désinstalleur.
    $ids = @(
      'tomoki1207.pdf', 'Gruntfuggly.triggertaskonsave',
      'streetsidesoftware.code-spell-checker', 'streetsidesoftware.code-spell-checker-french',
      'streetsidesoftware.code-spell-checker-swiss-german', 'TakumiI.markdowntable',
      'MS-CEINTL.vscode-language-pack-de', 'yzhang.markdown-all-in-one'
    )
  }
  return (@($ids) + @('szh-csps.szh-cockpit', 'szh-csps.szh-apercu'))
}

# Les fichiers profil d'UN compte (le courant, ou un autre sous -TousLesProfils) : réglages
# VSCodium, extraits de code, et l'état par utilisateur. $LocalAppData/$AppData sont ceux du
# compte visé -- %LOCALAPPDATA%/%APPDATA% pour le compte courant, ou
# <profil>\AppData\Local / <profil>\AppData\Roaming pour un autre compte.
function Get-SzhPlanFichiersProfilCompte {
  param(
    [Parameter(Mandatory = $true)][string]$LocalAppData,
    [Parameter(Mandatory = $true)][string]$AppData,
    [string]$Toolkit = $SzhToolkit,
    [string]$Suffixe = ''   # ' de <compte>' pour -TousLesProfils, vide pour le compte courant
  )
  $entrees = New-Object System.Collections.ArrayList

  $baseUtil = Join-Path $LocalAppData 'SZH'
  [void]$entrees.Add((New-SzhPlanEntree 'fichier-profil' $baseUtil `
    ('état par utilisateur' + $Suffixe + ' (environnement WSL, extensions, langue retenue)') `
    (Test-Path -LiteralPath $baseUtil)))

  $dstVscodium = Join-Path $AppData 'VSCodium\User'
  foreach ($f in 'settings.json', 'keybindings.json', 'tasks.json') {
    $cible = Join-Path $dstVscodium $f
    [void]$entrees.Add((New-SzhPlanEntree 'fichier-profil' $cible `
      ('réglages VSCodium' + $Suffixe + ' (' + $f + ')') (Test-Path -LiteralPath $cible)))
  }

  # Un extrait de code n'est reconnu que si son nom existe dans le toolkit : sans lui,
  # impossible de dire ce qui vient de nous plutôt qu'un extrait personnel du compte.
  $srcSnippets = Join-Path $Toolkit 'vscodium-user\snippets'
  $dstSnippets = Join-Path $dstVscodium 'snippets'
  if (Test-Path -LiteralPath $srcSnippets) {
    foreach ($sf in @(Get-ChildItem -LiteralPath $srcSnippets -File -ErrorAction SilentlyContinue)) {
      $cible = Join-Path $dstSnippets $sf.Name
      [void]$entrees.Add((New-SzhPlanEntree 'fichier-profil' $cible `
        ('extrait de code' + $Suffixe + ' (' + $sf.Name + ')') (Test-Path -LiteralPath $cible)))
    }
  } else {
    [void]$entrees.Add((New-SzhPlanEntree 'conserve' $dstSnippets `
      ('toolkit absent : extraits de code' + $Suffixe + ' non énumérables, laissés en place') `
      (Test-Path -LiteralPath $dstSnippets)))
  }
  return $entrees
}

# ---- Le plan ----
#
# -Machine : tâches planifiées, fichiers sous $SzhBase, et ce qui est conservé là (WSL,
#   racine, distribution enregistrée). Demande l'administrateur à l'exécution -- pas ici,
#   la LECTURE seule ne l'exige jamais (Get-ScheduledTask, Test-Path).
# -Profil : ce qui est par utilisateur pour le compte COURANT -- raccourcis, réglages
#   VSCodium, extraits de code, état par utilisateur, registre HKCU, extensions VSCodium.
# -Applications : VSCodium et SumatraPDF, jamais par défaut (logiciels partagés).
# -AutresProfils : dossiers C:\Users\<compte> AUTRES que le courant (uninstall.ps1
#   -TousLesProfils) -- seulement leurs fichiers profil, jamais leur registre (la ruche HKCU
#   d'un autre compte n'est pas chargée) ni leurs extensions (le CLI ne répond que pour le
#   compte qui l'invoque).
function Get-SzhPlanDesinstallation {
  param(
    [switch]$Applications,
    [switch]$Profil,
    [switch]$Machine,
    [string[]]$AutresProfils = @()
  )
  $plan = New-Object System.Collections.ArrayList

  # ---- Machine ----
  if ($Machine) {
    # Tâches planifiées. $SzhTacheMaj vient de szh-taches.ps1 (nom canonique, une seule
    # vérité) ; repli sur le même littéral si ce fichier n'a pas été dot-sourcé (les tests
    # qui n'éprouvent que le plan, sans charger tout le socle).
    $nomTacheMaj = 'SZH - Mise a jour'
    if ($script:SzhTacheMaj) { $nomTacheMaj = $script:SzhTacheMaj }
    $tachesVoulues = @(
      [ordered]@{ nom = $nomTacheMaj; detail = 'mise à jour hebdomadaire (mardi 14 h) et à l''ouverture de session' }
      [ordered]@{ nom = 'SZH - Prechauffage WSL'; detail = 'préchauffage de WSL à l''ouverture de session' }
    )
    foreach ($t in $tachesVoulues) {
      $existe = $false
      try { $null = Get-ScheduledTask -TaskName $t.nom -ErrorAction Stop; $existe = $true } catch { $existe = $false }
      [void]$plan.Add((New-SzhPlanEntree 'tache' $t.nom $t.detail $existe))
    }

    # Fichiers directement sous $SzhBase.
    $noms = @(Get-SzhNomsFichiersMachine)
    foreach ($n in $noms) {
      $cible = Join-Path $SzhBase $n.nom
      # Garde de construction : une liste fixe ne désigne jamais WSL ni la racine, mais la
      # garde reste posée ici -- une tripwire si la liste ci-dessus était un jour mal reprise.
      Assert-SzhCibleMachineAutorisee -Base $SzhBase -Cible $cible
      [void]$plan.Add((New-SzhPlanEntree 'fichier-machine' $cible $n.detail (Test-Path -LiteralPath $cible)))
    }

    # Ce qui n'est ni connu ni WSL, à la racine : jamais supprimé, seulement signalé.
    $connus = @($noms | ForEach-Object { $_.nom.ToLowerInvariant() }) + @('wsl')
    if (Test-Path -LiteralPath $SzhBase) {
      foreach ($item in @(Get-ChildItem -LiteralPath $SzhBase -Force -ErrorAction SilentlyContinue)) {
        if ($connus -contains $item.Name.ToLowerInvariant()) { continue }
        [void]$plan.Add((New-SzhPlanEntree 'inconnu' $item.FullName `
          'présent à la racine SZH, non reconnu par ce désinstalleur : ni retiré, ni recensé ailleurs' $true))
      }
    }

    # Conservé : WSL, la racine, la distribution enregistrée.
    $dossierWsl = Join-Path $SzhBase 'WSL'
    [void]$plan.Add((New-SzhPlanEntree 'conserve' $dossierWsl `
      'disques des distributions WSL, un par compte -- jamais touchés, jamais désinscrits' (Test-Path -LiteralPath $dossierWsl)))
    [void]$plan.Add((New-SzhPlanEntree 'conserve' $SzhBase `
      'racine SZH : conservée tant que WSL\ existe ; si vide ensuite, peut être retirée à la main' (Test-Path -LiteralPath $SzhBase)))
    $distroEnregistree = $false
    try { $distroEnregistree = (@(Get-SzhDistrosEnregistrees) -contains $SzhDistro) } catch { $distroEnregistree = $false }
    [void]$plan.Add((New-SzhPlanEntree 'conserve' $SzhDistro `
      'distribution WSL et son enregistrement : jamais désinscrite' $distroEnregistree))
  }

  # ---- Profil (compte courant) ----
  if ($Profil) {
    # Extensions VSCodium.
    $ids = @(Get-SzhIdsExtensions)
    $cli = Get-VSCodiumCli
    $installees = $null
    if ($cli) { $installees = Get-SzhExtensionsInstallees -Cli $cli }
    foreach ($id in $ids) {
      $present = $false
      if ($null -ne $installees) {
        $present = $installees.ContainsKey($id)
      } else {
        $dossierExt = Join-Path $env:USERPROFILE '.vscode-oss\extensions'
        if (Test-Path -LiteralPath $dossierExt) {
          $present = [bool](Get-ChildItem -LiteralPath $dossierExt -Directory -Filter ($id + '-*') -ErrorAction SilentlyContinue)
        }
      }
      [void]$plan.Add((New-SzhPlanEntree 'extension' $id 'extension VSCodium (codium --uninstall-extension)' $present))
    }

    # Raccourcis du menu Démarrer (les cinq entrées voulues, quel que soit leur état réel).
    $menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    foreach ($r in @(Get-SzhRaccourcisMenu)) {
      $cible = Join-Path $menu ($r.nom + '.lnk')
      [void]$plan.Add((New-SzhPlanEntree 'raccourci' $cible $r.nom (Test-Path -LiteralPath $cible)))
    }

    # Fichiers profil du compte courant.
    foreach ($e in @(Get-SzhPlanFichiersProfilCompte -LocalAppData $env:LOCALAPPDATA -AppData $env:APPDATA)) {
      [void]$plan.Add($e)
    }

    # Registre HKCU.
    $racineClasses = 'HKCU:\Software\Classes'
    $cleMarkdown = Join-Path $racineClasses 'SZH.Markdown'
    [void]$plan.Add((New-SzhPlanEntree 'registre' $cleMarkdown `
      'association « Ouvrir avec » des .md (ProgId SZH.Markdown)' (Test-Path -LiteralPath $cleMarkdown)))
    $cleSzh = Join-Path $racineClasses 'szh'
    [void]$plan.Add((New-SzhPlanEntree 'registre' $cleSzh `
      'protocole szh:// (liens d''envoi pour traduction)' (Test-Path -LiteralPath $cleSzh)))
    $cleOuvrirAvec = Join-Path $racineClasses '.md\OpenWithProgids'
    $presentOuvrirAvec = $false
    try {
      $presentOuvrirAvec = [bool](Get-ItemProperty -Path $cleOuvrirAvec -Name 'SZH.Markdown' -ErrorAction Stop)
    } catch { $presentOuvrirAvec = $false }
    [void]$plan.Add((New-SzhPlanEntree 'registre' ($cleOuvrirAvec + '::SZH.Markdown') `
      'entrée SZH.Markdown dans « Ouvrir avec » les .md' $presentOuvrirAvec))
    $cleConfiance = 'HKCU:\Software\Microsoft\Office\Common\Security\Trusted Protocols\All Applications\szh:'
    [void]$plan.Add((New-SzhPlanEntree 'registre' $cleConfiance `
      'confiance Office pour les liens szh:// (Outlook)' (Test-Path -LiteralPath $cleConfiance)))

    # Conservé, par utilisateur.
    $argv = Join-Path $env:APPDATA 'VSCodium\argv.json'
    [void]$plan.Add((New-SzhPlanEntree 'conserve' $argv `
      'langue de l''éditeur, réglage commun à tous les postes VSCodium : jamais touché' (Test-Path -LiteralPath $argv)))
    $wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
    [void]$plan.Add((New-SzhPlanEntree 'conserve' $wslconfig `
      'réglages WSL globaux (valent pour toutes les distributions) : jamais touché' (Test-Path -LiteralPath $wslconfig)))
    [void]$plan.Add((New-SzhPlanEntree 'conserve' '(revues)' `
      'les revues et livres (OneDrive ou ailleurs) ne sont jamais touchés' $true))
  }

  # ---- Fichiers profil d'autres comptes (-TousLesProfils, uninstall.ps1) ----
  foreach ($dossierProfil in $AutresProfils) {
    $compte = Split-Path $dossierProfil -Leaf
    $localAppData = Join-Path $dossierProfil 'AppData\Local'
    $appDataAutre = Join-Path $dossierProfil 'AppData\Roaming'
    if (-not (Test-Path -LiteralPath $localAppData)) { continue }
    foreach ($e in @(Get-SzhPlanFichiersProfilCompte -LocalAppData $localAppData -AppData $appDataAutre -Suffixe (' de ' + $compte))) {
      [void]$plan.Add($e)
    }
  }

  # ---- Applications (jamais par défaut) ----
  if ($Applications) {
    $uninsSysteme = Join-Path $env:ProgramFiles 'VSCodium\unins000.exe'
    $uninsLocal = Join-Path $env:LOCALAPPDATA 'Programs\VSCodium\unins000.exe'
    $uninsVsc = $uninsSysteme
    if (-not (Test-Path -LiteralPath $uninsSysteme)) {
      if (Test-Path -LiteralPath $uninsLocal) { $uninsVsc = $uninsLocal }
    }
    [void]$plan.Add((New-SzhPlanEntree 'application' $uninsVsc `
      'VSCodium (/VERYSILENT /NORESTART) -- logiciel partagé, retiré seulement avec -Applications' (Test-Path -LiteralPath $uninsVsc)))

    $sumatra = Join-Path $env:ProgramFiles 'SumatraPDF\SumatraPDF.exe'
    [void]$plan.Add((New-SzhPlanEntree 'application' $sumatra `
      'SumatraPDF (-uninstall -s) -- logiciel partagé, retiré seulement avec -Applications' (Test-Path -LiteralPath $sumatra)))
  }

  return $plan
}

# ---- L'application du plan ----
#
# Ordre fixe : tâches, extensions, raccourcis, fichiers profil, registre, fichiers machine,
# applications. Chaque suppression est dans son propre try/catch -- un fichier verrouillé ou
# une clé refusée ne doit jamais arrêter le reste. $Journal (scriptblock à un paramètre) reçoit
# une ligne par entrée traitée ; l'appelant l'écrit où il veut (jamais $SzhLogs ici : ce
# dossier peut disparaître pendant l'opération même).
function Invoke-SzhPlanDesinstallation {
  param(
    [Parameter(Mandatory = $true)]$Plan,
    [switch]$Simuler,
    [scriptblock]$Journal
  )
  $faits = New-Object System.Collections.ArrayList
  $echecs = New-Object System.Collections.ArrayList
  $ignores = New-Object System.Collections.ArrayList

  function Consigner-SzhLigne([string]$Message) {
    if ($Journal) { try { & $Journal $Message } catch { } }
  }

  $ordre = @('tache', 'extension', 'raccourci', 'fichier-profil', 'registre', 'fichier-machine', 'application')
  foreach ($type in $ordre) {
    foreach ($entree in @($Plan | Where-Object { $_.type -eq $type })) {
      if (-not $entree.present) {
        [void]$ignores.Add($entree)
        continue
      }
      if ($Simuler) {
        Consigner-SzhLigne ('simulé : ' + $type + ' -> ' + $entree.cible)
        [void]$ignores.Add($entree)
        continue
      }
      try {
        switch ($type) {
          'tache' {
            Unregister-ScheduledTask -TaskName $entree.cible -Confirm:$false -ErrorAction Stop
          }
          'extension' {
            $cli = Get-VSCodiumCli
            $fait = $false
            if ($cli) {
              $sortie = Invoke-SzhNatif { & $cli --uninstall-extension $entree.cible 2>&1 }
              if ($LASTEXITCODE -eq 0) { $fait = $true }
            }
            if (-not $fait) {
              $dossierExt = Join-Path $env:USERPROFILE '.vscode-oss\extensions'
              if (Test-Path -LiteralPath $dossierExt) {
                $trouves = @(Get-ChildItem -LiteralPath $dossierExt -Directory -Filter ($entree.cible + '-*') -ErrorAction SilentlyContinue)
                foreach ($d in $trouves) { Remove-Item -LiteralPath $d.FullName -Recurse -Force }
                if ($trouves.Count -gt 0) { $fait = $true }
              }
            }
            if (-not $fait) { throw ('extension non désinstallée (ni CLI, ni dossier trouvé) : ' + $entree.cible) }
          }
          'raccourci' {
            Remove-Item -LiteralPath $entree.cible -Force
          }
          'fichier-profil' {
            Remove-Item -LiteralPath $entree.cible -Recurse -Force
          }
          'registre' {
            if ($entree.cible -like '*::*') {
              $parties = $entree.cible -split '::', 2
              Remove-ItemProperty -Path $parties[0] -Name $parties[1] -Force -ErrorAction Stop
            } else {
              Remove-Item -LiteralPath $entree.cible -Recurse -Force
            }
          }
          'fichier-machine' {
            # Réappliquée ici, sur l'entrée telle qu'exécutée -- pas seulement à la
            # construction du plan : un plan forgé à la main (test, ou appelant fautif) ne
            # doit jamais pouvoir faire supprimer WSL ou la racine.
            Assert-SzhCibleMachineAutorisee -Base $SzhBase -Cible $entree.cible
            Remove-Item -LiteralPath $entree.cible -Recurse -Force
          }
          'application' {
            $argsInstalleur = @('/VERYSILENT', '/NORESTART')
            if ($entree.cible -like '*SumatraPDF*') { $argsInstalleur = @('-uninstall', '-s') }
            $p = Start-Process -FilePath $entree.cible -ArgumentList $argsInstalleur -Wait -PassThru
            if ($p.ExitCode -ne 0) { throw ('code de sortie ' + $p.ExitCode) }
          }
          default {
            throw ('type de plan inconnu, rien retiré : ' + $type)
          }
        }
        Consigner-SzhLigne ('retiré : ' + $type + ' -> ' + $entree.cible)
        [void]$faits.Add($entree)
      } catch {
        Consigner-SzhLigne ('échec : ' + $type + ' -> ' + $entree.cible + ' (' + $_.Exception.Message + ')')
        [void]$echecs.Add([pscustomobject]@{ entree = $entree; erreur = $_.Exception.Message })
      }
    }
  }

  # « conserve » et « inconnu » : jamais touchés, mais comptés -- le bilan doit rendre
  # compte de CHAQUE ligne du plan, pas seulement de celles qui pouvaient agir.
  foreach ($entree in @($Plan | Where-Object { ($_.type -eq 'conserve') -or ($_.type -eq 'inconnu') })) {
    [void]$ignores.Add($entree)
  }

  return [ordered]@{ faits = @($faits); echecs = @($echecs); ignores = @($ignores) }
}

# ---- Le plan, en français ----
function Format-SzhPlanDesinstallation {
  param([Parameter(Mandatory = $true)]$Plan)

  $etiquettesType = [ordered]@{
    'tache'           = 'Tâches planifiées'
    'extension'       = 'Extensions VSCodium'
    'raccourci'       = 'Raccourcis du menu Démarrer'
    'fichier-profil'  = 'Fichiers de votre compte'
    'registre'        = 'Registre (HKCU, votre compte)'
    'fichier-machine' = 'Fichiers du poste (C:\ProgramData\SZH)'
    'application'     = 'Applications (retirées seulement avec -Applications)'
    'inconnu'         = 'Non reconnu à la racine SZH -- ni retiré, ni recensé'
  }
  $ordre = @('tache', 'extension', 'raccourci', 'fichier-profil', 'registre', 'fichier-machine', 'application', 'inconnu')

  $texte = New-Object System.Text.StringBuilder
  foreach ($type in $ordre) {
    $lignes = @($Plan | Where-Object { $_.type -eq $type })
    if ($lignes.Count -eq 0) { continue }
    [void]$texte.AppendLine($etiquettesType[$type] + ' :')
    foreach ($l in $lignes) {
      $etat = ''
      if (-not $l.present) { $etat = '  (absent)' }
      [void]$texte.AppendLine('  - ' + $l.cible + '  -- ' + $l.detail + $etat)
    }
    [void]$texte.AppendLine('')
  }

  $conserves = @($Plan | Where-Object { $_.type -eq 'conserve' })
  if ($conserves.Count -gt 0) {
    [void]$texte.AppendLine('Conservé :')
    foreach ($c in $conserves) {
      $etat = ''
      if (-not $c.present) { $etat = '  (absent)' }
      [void]$texte.AppendLine('  - ' + $c.cible + '  -- ' + $c.detail + $etat)
    }
  }
  return $texte.ToString()
}
