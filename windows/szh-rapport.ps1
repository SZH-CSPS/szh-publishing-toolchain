# Ecrivain PowerShell des rapports d'erreur automatiques (docs/RAPPORTS-ERREUR.md, jalon J3 ;
# docs/RAPPORTS-ERREUR.md). Construit un rapport conforme au schema v1 et l'ecrit -- ou
# n'ecrit rien, mais ne leve JAMAIS (D5, la regle absolue). Dot-source par szh-common.ps1,
# juste apres szh-ancrage.ps1 dont il reutilise Resolve-SzhAncrage (passive, memoisee,
# n'ouvre jamais de fenetre) et Get-SzhDossierRapportsDepuisAncrage : ce fichier-ci ne
# refait ni l'un ni l'autre.
#
# Compatibilite : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#
# Contrepartie exacte, cote JS, de vscodium-extension/szh-cockpit/lib/rapport-erreur.js et
# lib/codes-erreur.js : meme schema, meme masquage, meme calcul de signature, meme format
# d'id, memes plafonds -- au signe pres, sans quoi l'anti-inondation partagee
# (etat-utilisateur.json, cle "rapports") diverge en silence entre les deux ecrivains
# (D6). Chaque fonction ci-dessous porte, en commentaire, le nom de son equivalent JS.
#
# Auto-protection (pas dans la spec, necessaire pour ne jamais ecrire ailleurs que dans un
# dossier jetable pendant les tests) : Write-SzhRapport et Clear-SzhRapportsEnAttente sont
# des NO-OP silencieux des que $env:SZH_LANCEUR_SIMULE ou $env:SZH_OPENMD_SIMULE valent '1'
# -- exactement les deux drapeaux que open-produit.ps1 et open-md.ps1 posent deja pour leurs
# propres tests (aucune fenetre WinForms ne doit s'ouvrir en simulation ; un rapport ecrit
# pour de vrai serait le meme genre d'effet de bord). archive-revue.ps1 n'a pas ce drapeau :
# il n'a jamais ete concu pour tourner dans un banc de test automatise (fenetre visible
# assumee), donc rien ne l'y gate ici.

# =========================================================================================
# 1. Masquage (docs/RAPPORTS-ERREUR.md §3, regle 5 amendee -- equivalent JS : codesErreur.masquer)
# =========================================================================================
#
# Sept regles, dans cet ordre : 1 ancrage -> 2 %USERPROFILE% -> 3 ProgramData ->
# 4 mot-cle+valeur -> 5b JWT complet -> 5a secret nu resserre -> 6 courriel. Fonction
# entierement autonome (aucune dependance a une constante de script) pour rester testable
# isolement par extraction de son corps depuis ce fichier (meme technique que
# test/js/courriel-support.test.js).
function Protect-SzhRapportTexte {
  param([string]$Texte, $Racines)

  $s = ''
  if ($null -ne $Texte) { $s = [string]$Texte }

  $ancrage = ''
  $userProfile = ''
  $programData = 'C:\ProgramData\SZH'
  if ($Racines) {
    if ($Racines.Contains('ancrage') -and $Racines['ancrage']) { $ancrage = [string]$Racines['ancrage'] }
    if ($Racines.Contains('userProfile') -and $Racines['userProfile']) { $userProfile = [string]$Racines['userProfile'] }
    if ($Racines.Contains('programData') -and $Racines['programData']) { $programData = [string]$Racines['programData'] }
  }

  function Get-SzhRapportMotifRacineLocal([string]$Racine) {
    $segments = @($Racine -split '[\\/]+' | Where-Object { $_ -ne '' })
    $echappes = @($segments | ForEach-Object { [regex]::Escape($_) })
    return ($echappes -join '[\\\\/]+')
  }

  function Remove-SzhRapportRacineLocale([string]$TexteEntree, [string]$Racine, [string]$Remplacement) {
    if (-not $Racine) { return $TexteEntree }
    $motif = (Get-SzhRapportMotifRacineLocal $Racine) + '[\\\\/]?'
    $regex = New-Object System.Text.RegularExpressions.Regex($motif, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    return $regex.Replace($TexteEntree, $Remplacement)
  }

  function Test-SzhRapportSecretHauteEntropieLocal([string]$Candidat) {
    if (-not ($Candidat -cmatch '[A-Z]')) { return $false }
    if (-not ($Candidat -cmatch '[a-z]')) { return $false }
    if (-not ($Candidat -match '[0-9]')) { return $false }
    if ($Candidat -match '^[0-9a-fA-F-]+$') { return $false }
    return $true
  }

  # 1-2-3 : racines connues, la plus specifique d'abord (voir codes-erreur.js pour la
  # justification complete de l'ordre).
  $s = Remove-SzhRapportRacineLocale $s $ancrage ''
  $s = Remove-SzhRapportRacineLocale $s $userProfile '~\'
  $s = Remove-SzhRapportRacineLocale $s $programData ''

  # 4 : mot-cle de secret + le jeton qui suit, rien de plus (le reste de la ligne survit).
  $motif4 = '\b(api[-_ ]?key|token|secret|authorization|bearer|deepl|password|mot de passe|pwd)(\s*[:=]\s*|\s+)(\S+)'
  $s = [regex]::Replace($s, $motif4,
    { param($m) $m.Groups[1].Value + $m.Groups[2].Value + '***' },
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

  # 5b : un JWT complet (en-tete.charge-utile.signature), avant 5a -- sans quoi 5a ne
  # masquerait qu'un segment individuellement assez long, laissant les autres lisibles.
  $motif5b = 'eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_.-]+)+'
  $s = [regex]::Replace($s, $motif5b, '***')

  # 5a : secret nu resserre -- jamais un chemin (« / » retire de la classe), jamais une
  # empreinte hexadecimale ni un GUID.
  $motif5a = '[A-Za-z0-9+=_-]{32,}'
  $s = [regex]::Replace($s, $motif5a,
    { param($m) if (Test-SzhRapportSecretHauteEntropieLocal $m.Value) { '***' } else { $m.Value } })

  # 6 : une adresse courriel, sauf celle du support (deja publique dans le depot).
  $motif6 = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  $courrielSupport = 'robin.morand@szh.ch'
  $s = [regex]::Replace($s, $motif6,
    { param($m) if ($m.Value.ToLowerInvariant() -eq $courrielSupport.ToLowerInvariant()) { $m.Value } else { '***@***' } })

  return $s
}

# =========================================================================================
# 2. Chemin relatif a une racine donnee (equivalent JS : codesErreur.versCheminRelatif)
# =========================================================================================
#
# Rend { chemin; relatifA }, jamais une chaine masquee -- pour un chemin absolu qui ne
# tombe sous aucune racine connue, l'appelant (Write-SzhRapport) applique Protect-SzhRapportTexte
# lui-meme ensuite, comme cote JS (cheminRelatifAvecRepli).
function ConvertTo-SzhRapportCheminRelatif {
  param([string]$Chemin, [string]$Racine, [string]$Etiquette)

  $brut = ''
  if ($null -ne $Chemin) { $brut = [string]$Chemin }
  $normalise = $brut -replace '/', '\'

  if (-not $Racine) {
    return [pscustomobject]@{ chemin = $normalise; relatifA = 'absolu' }
  }

  $segments = @($Racine -split '[\\/]+' | Where-Object { $_ -ne '' })
  $echappes = @($segments | ForEach-Object { [regex]::Escape($_) })
  $motif = '^' + ($echappes -join '[\\\\/]+') + '[\\\\/]?'
  $regex = New-Object System.Text.RegularExpressions.Regex($motif, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

  if ($regex.IsMatch($brut)) {
    $reste = $regex.Replace($brut, '')
    $reste = $reste -replace '/', '\'
    return [pscustomobject]@{ chemin = $reste; relatifA = $Etiquette }
  }
  return [pscustomobject]@{ chemin = $normalise; relatifA = 'absolu' }
}

# =========================================================================================
# 3. Signature anti-inondation (equivalent JS : codesErreur.calculerSignature)
# =========================================================================================
#
# 12 premiers caracteres hexadecimaux de SHA-256(source | code | etape |
# 200 premiers caracteres du message DEJA masque | produit.numero), champ manquant = ''.
# Le separateur ' | ' est fixe -- c'est ce texte-la, caractere pour caractere, que les deux
# ecrivains doivent produire pour qu'un meme incident se regroupe pareil des deux cotes.
function Get-SzhRapportSignature {
  param([string]$Source, [string]$Code, [string]$Etape, [string]$MessageMasque, [string]$ProduitNumero)

  function ConvertTo-SzhRapportTexteSignatureLocal($Valeur) {
    if ($null -eq $Valeur) { return '' }
    return [string]$Valeur
  }

  $msg = ConvertTo-SzhRapportTexteSignatureLocal $MessageMasque
  if ($msg.Length -gt 200) { $msg = $msg.Substring(0, 200) }

  $morceaux = @(
    (ConvertTo-SzhRapportTexteSignatureLocal $Source),
    (ConvertTo-SzhRapportTexteSignatureLocal $Code),
    (ConvertTo-SzhRapportTexteSignatureLocal $Etape),
    $msg,
    (ConvertTo-SzhRapportTexteSignatureLocal $ProduitNumero)
  )
  $texte = ($morceaux -join ' | ')

  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $octets = [System.Text.Encoding]::UTF8.GetBytes($texte)
    $empreinte = $sha.ComputeHash($octets)
    $hex = -join ($empreinte | ForEach-Object { $_.ToString('x2') })
    return $hex.Substring(0, 12)
  } finally {
    $sha.Dispose()
  }
}

# =========================================================================================
# 4. Identifiant du rapport (equivalent JS : codesErreur.calculerId + formaterHorodatageId +
#    nettoyerPoste + genererAleatoireHex)
# =========================================================================================
#
# <AAAAMMJJ-HHmmss>-<poste>-<6 hex>, ASCII, <= 120 caracteres, aussi le nom du fichier.
# L'horodatage de l'id est fonde sur l'UTC de l'instant recu (D9) -- jamais l'heure locale,
# qui reculerait d'une heure au changement d'heure et casserait le tri alphabetique une fois
# par an.
function New-SzhRapportAleatoireHex {
  $octets = New-Object byte[] 3
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($octets) } finally { $rng.Dispose() }
  return -join ($octets | ForEach-Object { $_.ToString('x2') })
}

function Get-SzhRapportId {
  param([datetime]$Horodatage, [string]$Poste, [string]$AleatoireHex)

  $hex = ''
  if ($null -ne $AleatoireHex) { $hex = ([string]$AleatoireHex).ToLowerInvariant() }
  if ($hex -notmatch '^[0-9a-f]{6}$') {
    throw ('Get-SzhRapportId : AleatoireHex doit etre 6 caracteres hexadecimaux, recu ' + $AleatoireHex)
  }

  $u = $Horodatage.ToUniversalTime()
  $horodatageTxte = $u.ToString('yyyyMMdd-HHmmss', [System.Globalization.CultureInfo]::InvariantCulture)

  # Nettoyage du nom de poste (equivalent nettoyerPoste) : diacritiques retires (NFD),
  # majuscules, tout le reste ramene a [A-Z0-9-], tirets multiples fusionnes, bornes 40.
  $base = ''
  if ($null -ne $Poste) { $base = [string]$Poste }
  $forme = $base.Normalize([System.Text.NormalizationForm]::FormD)
  $sansAccents = -join ($forme.ToCharArray() | Where-Object {
    [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne [System.Globalization.UnicodeCategory]::NonSpacingMark
  })
  $majuscule = $sansAccents.ToUpperInvariant()
  $nettoye = [regex]::Replace($majuscule, '[^A-Z0-9-]', '-')
  $nettoye = [regex]::Replace($nettoye, '-+', '-')
  $nettoye = $nettoye.Trim('-')
  if (-not $nettoye) { $nettoye = 'POSTE' }
  if ($nettoye.Length -gt 40) { $nettoye = $nettoye.Substring(0, 40) }

  return ($horodatageTxte + '-' + $nettoye + '-' + $hex)
}

# horodatageLocal (equivalent JS : formaterHorodatageLocal) : le meme instant, a l'heure du
# poste, decalage inclus -- pour la personne qui relit, jamais pour le tri.
function Get-SzhRapportHorodatageLocal {
  param([datetime]$DateLocale)

  $decalage = [System.TimeZoneInfo]::Local.GetUtcOffset($DateLocale)
  $signe = '+'
  if ($decalage.Ticks -lt 0) { $signe = '-' }
  $abs = $decalage.Duration()

  return ('{0:0000}-{1:00}-{2:00}T{3:00}:{4:00}:{5:00}{6}{7:00}:{8:00}' -f `
    $DateLocale.Year, $DateLocale.Month, $DateLocale.Day, `
    $DateLocale.Hour, $DateLocale.Minute, $DateLocale.Second, `
    $signe, $abs.Hours, $abs.Minutes)
}

# =========================================================================================
# 5. Table des codes et resumes FR/DE (equivalent JS : codesErreur.CODES) -- transcrite
#    depuis le fichier JS gele par un script Node (pas a la main), pour eviter toute
#    divergence de ponctuation ou de typographie entre les deux ecrivains.
# =========================================================================================
function Get-SzhRapportResume {
  param([string]$Code)

  # ATTENTION lecture : chaque apostrophe typographique ' est DOUBLEE ci-dessous ('') --
  # verifie empiriquement (pas suppose) que PowerShell 5.1 traite ' (U+2019) comme un
  # delimiteur de chaine simple-quote au meme titre que ' (U+0027) : un ' isolement place
  # a l'interieur d'une chaine '...' termine la chaine et casse le fichier (message
  # "Le terminateur ' est manquant"). La doubler ('') est exactement le meme mecanisme
  # d'echappement qu'une apostrophe droite doublee (''), et rend bien UNE SEULE apostrophe
  # typographique une fois la chaine evaluee -- verifie aussi. C'est la meme convention,
  # deja en place, que les 35 occurrences preexistantes de windows/szh-textes.ps1.
  $table = @{
    'LANCEUR-TRAP' = @{ fr = 'Une erreur inattendue est survenue à l’’ouverture du lanceur ; ce rapport en garde la trace pour le diagnostic.'; de = 'Beim Öffnen des Starters ist ein unerwarteter Fehler aufgetreten; dieser Bericht hält ihn zur Diagnose fest.' }
    'LANCEUR-CODIUM-ABSENT' = @{ fr = 'VSCodium est introuvable au démarrage du lanceur ; l’’éditeur ne peut pas s’’ouvrir tant qu’’il n’’est pas réinstallé.'; de = 'VSCodium wurde beim Start des Starters nicht gefunden; der Editor kann erst nach einer Neuinstallation geöffnet werden.' }
    'ANCRAGE-INTROUVABLE' = @{ fr = 'Aucun dossier SharePoint n’’a pu être identifié, ni automatiquement ni par la personne consultée ; les produits restent introuvables jusqu’’à ce qu’’il soit indiqué.'; de = 'Es konnte kein SharePoint-Ordner gefunden werden, weder automatisch noch durch Rückfrage; die Produkte bleiben unauffindbar, bis er angegeben wird.' }
    'MAJ-ETAPE-ECHEC' = @{ fr = 'Une étape de la mise à jour a échoué, mais les suivantes ont continué ; ce rapport précise laquelle.'; de = 'Ein Schritt der Aktualisierung ist fehlgeschlagen, die übrigen wurden trotzdem fortgesetzt; dieser Bericht nennt den betroffenen Schritt.' }
    'MAJ-ECHEC' = @{ fr = 'La mise à jour s’’est arrêtée avant la fin ; le poste garde la version qu’’il avait avant l’’essai.'; de = 'Die Aktualisierung wurde vorzeitig abgebrochen; der Rechner behält die Version, die er vor dem Versuch hatte.' }
    'ARCHIVAGE-ECHEC' = @{ fr = 'Le déplacement d’’un numéro ou d’’un livre vers les archives n’’a pas abouti ; rien n’’a été perdu, il reste à l’’endroit où il était.'; de = 'Das Verschieben einer Ausgabe oder eines Buches ins Archiv ist nicht gelungen; nichts ist verloren gegangen, es bleibt an seinem bisherigen Ort.' }
    'COMPIL-ECHEC' = @{ fr = 'La compilation s’’est arrêtée sans produire de résultat exploitable ; le journal de la tâche en donne le détail.'; de = 'Die Kompilierung wurde beendet, ohne ein brauchbares Ergebnis zu liefern; das Aufgabenprotokoll enthält die Einzelheiten.' }
    'COCKPIT-EXCEPTION' = @{ fr = 'Une erreur inattendue est survenue dans l’’extension du cockpit ; VSCodium reste ouvert, seule une fonctionnalité peut être affectée.'; de = 'In der Cockpit-Erweiterung ist ein unerwarteter Fehler aufgetreten; VSCodium bleibt geöffnet, nur eine einzelne Funktion kann betroffen sein.' }
    'RAPPORT-ECHEC-ECRITURE' = @{ fr = 'L’’écriture d’’un rapport d’’erreur a elle-même échoué ; par construction, cet échec n’’est jamais transformé en nouveau rapport, seul le journal local le garde.'; de = 'Das Schreiben eines Fehlerberichts ist selbst fehlgeschlagen; dieser Fehler wird bewusst nicht erneut als Bericht erzeugt, nur das lokale Protokoll hält ihn fest.' }
  }

  if ($table.ContainsKey($Code)) {
    $r = $table[$Code]
    return [ordered]@{ fr = $r.fr; de = $r.de }
  }
  return [ordered]@{ fr = $null; de = $null }
}

# Codes connus de la table (pour Test-SzhRapportValide, sans dupliquer les textes complets).
function Get-SzhRapportCodesConnus {
  return @('LANCEUR-TRAP', 'LANCEUR-CODIUM-ABSENT', 'ANCRAGE-INTROUVABLE', 'MAJ-ETAPE-ECHEC',
    'MAJ-ECHEC', 'ARCHIVAGE-ECHEC', 'COMPIL-ECHEC', 'COCKPIT-EXCEPTION', 'RAPPORT-ECHEC-ECRITURE')
}

# =========================================================================================
# 6. Serialisation JSON UTF-8 sans BOM, indentee 2 espaces (equivalent JS :
#    JSON.stringify(rapport, null, 2))
# =========================================================================================
#
# ECRIT A LA MAIN, ConvertTo-Json volontairement ECARTE ici -- verifie A L'EXECUTION, sous le
# vrai Windows PowerShell 5.1 (pas seulement pwsh 7, dont le comportement diverge) : son
# indentation est fixe a 4 espaces avec deux espaces avant chaque valeur
# (« "cle":  "valeur" »), non conforme au schema qui exige 2 espaces -- aucun parametre ne le
# change. Un serialiseur recursif minimal, calque sur le format exact de
# JSON.stringify(valeur, null, 2) de Node (memes deux espaces par niveau, memes deux-points
# suivis d'un seul espace, memes accolades/crochets vides "{}"/"[]", AUCUN caractere non-ASCII
# echappe -- Node ne le fait pas par defaut, et PowerShell n'a donc pas a le faire non plus)
# est plus sur qu'un contournement des sorties changeantes d'un outil qu'on ne maitrise pas.
function ConvertTo-SzhRapportJsonChaine {
  param([string]$Texte)

  $brut = ''
  if ($null -ne $Texte) { $brut = [string]$Texte }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  foreach ($caractere in $brut.ToCharArray()) {
    if ($caractere -eq '"') { [void]$sb.Append('\"') }
    elseif ($caractere -eq '\') { [void]$sb.Append('\\') }
    elseif ($caractere -eq "`n") { [void]$sb.Append('\n') }
    elseif ($caractere -eq "`r") { [void]$sb.Append('\r') }
    elseif ($caractere -eq "`t") { [void]$sb.Append('\t') }
    else {
      $code = [int][char]$caractere
      if ($code -lt 0x20) { [void]$sb.Append('\u' + $code.ToString('x4')) }
      # Non-ASCII (>= 0x80) : jamais echappe, ecrit tel quel -- Node ne le fait pas non
      # plus par defaut, et c'est exactement ce que le schema veut sur le disque.
      else { [void]$sb.Append($caractere) }
    }
  }
  [void]$sb.Append('"')
  return $sb.ToString()
}

function ConvertTo-SzhRapportJsonValeur {
  param($Valeur, [int]$Niveau = 0)

  $indentEnfant = '  ' * ($Niveau + 1)
  $indentCourant = '  ' * $Niveau

  if ($null -eq $Valeur) { return 'null' }
  if ($Valeur -is [bool]) { if ($Valeur) { return 'true' } else { return 'false' } }
  if ($Valeur -is [string]) { return (ConvertTo-SzhRapportJsonChaine $Valeur) }

  if (($Valeur -is [int]) -or ($Valeur -is [long]) -or ($Valeur -is [double]) -or ($Valeur -is [single]) -or ($Valeur -is [decimal])) {
    return $Valeur.ToString([System.Globalization.CultureInfo]::InvariantCulture)
  }

  # Objet : Hashtable/OrderedDictionary (IDictionary) ou PSCustomObject -- deux
  # representations differentes d'un "objet" selon qu'il vient d'un littéral @{}/[ordered]@{}
  # ou d'un aller-retour ConvertTo-Json/ConvertFrom-Json (utilise par Add-SzhRapportPlafonds).
  if ($Valeur -is [System.Collections.IDictionary]) {
    $cles = @($Valeur.Keys)
    if ($cles.Count -eq 0) { return '{}' }
    $lignes = @($cles | ForEach-Object {
      $indentEnfant + (ConvertTo-SzhRapportJsonChaine ([string]$_)) + ': ' +
        (ConvertTo-SzhRapportJsonValeur -Valeur $Valeur[$_] -Niveau ($Niveau + 1))
    })
    return "{`n" + ($lignes -join ",`n") + "`n" + $indentCourant + '}'
  }
  if ($Valeur -is [System.Management.Automation.PSCustomObject]) {
    $proprietes = @($Valeur.PSObject.Properties)
    if ($proprietes.Count -eq 0) { return '{}' }
    $lignes = @($proprietes | ForEach-Object {
      $indentEnfant + (ConvertTo-SzhRapportJsonChaine $_.Name) + ': ' +
        (ConvertTo-SzhRapportJsonValeur -Valeur $_.Value -Niveau ($Niveau + 1))
    })
    return "{`n" + ($lignes -join ",`n") + "`n" + $indentCourant + '}'
  }

  # Tableau : tout IEnumerable qui n'est pas une chaine (deja traitee plus haut).
  if ($Valeur -is [System.Collections.IEnumerable]) {
    $elements = @($Valeur)
    if ($elements.Count -eq 0) { return '[]' }
    $lignes = @($elements | ForEach-Object { $indentEnfant + (ConvertTo-SzhRapportJsonValeur -Valeur $_ -Niveau ($Niveau + 1)) })
    return "[`n" + ($lignes -join ",`n") + "`n" + $indentCourant + ']'
  }

  # Repli : tout le reste (rare -- un type non prevu ci-dessus) rendu comme chaine plutot que
  # de lever, D5 oblige.
  return (ConvertTo-SzhRapportJsonChaine ([string]$Valeur))
}

function ConvertTo-SzhRapportJsonTexte {
  param($Objet)

  return ((ConvertTo-SzhRapportJsonValeur -Valeur $Objet -Niveau 0) + "`n")
}

# =========================================================================================
# 7. Plafonds (equivalent JS : codesErreur.appliquerPlafonds) -- rend un NOUVEAU rapport,
#    ne modifie jamais celui qu'on lui passe.
# =========================================================================================
function Add-SzhRapportPlafonds {
  param($Rapport)

  $plafondMessage = 4000
  $plafondPile = 8000
  $plafondFichiers = 50
  $plafondConstats = 100
  $plafondJournalLignes = 200
  $plafondJournalCaracteres = 40000
  $plafondFichierOctets = 256 * 1024

  # Clone en profondeur par aller-retour JSON (comme le JSON.parse(JSON.stringify(...)) de
  # codesErreur.appliquerPlafonds) : l'objet recu n'est jamais modifie en place.
  $r = ($Rapport | ConvertTo-Json -Depth 20) | ConvertFrom-Json

  if (($null -ne $r.message) -and ($r.message.Length -gt $plafondMessage)) {
    $r.message = $r.message.Substring(0, $plafondMessage)
  }
  if (($null -ne $r.pile) -and ($r.pile.Length -gt $plafondPile)) {
    $r.pile = $r.pile.Substring(0, $plafondPile)
  }

  # Fichiers/constats : les PREMIERES entrees gardees (comme cote JS), pas les dernieres.
  if ($r.fichiers -and (@($r.fichiers).Count -gt $plafondFichiers)) {
    $r.fichiers = @(@($r.fichiers) | Select-Object -First $plafondFichiers)
  }
  if ($r.constats -and (@($r.constats).Count -gt $plafondConstats)) {
    $r.constats = @(@($r.constats) | Select-Object -First $plafondConstats)
  }

  if ($r.journal -and $r.journal.extrait) {
    $lignes = @($r.journal.extrait)
    $tronque = [bool]$r.journal.tronque
    if ($lignes.Count -gt $plafondJournalLignes) {
      $lignes = @($lignes | Select-Object -Last $plafondJournalLignes)
      $tronque = $true
    }
    while (($lignes.Count -gt 1) -and (($lignes -join "`n").Length -gt $plafondJournalCaracteres)) {
      $lignes = @($lignes | Select-Object -Skip 1)
      $tronque = $true
    }
    if (($lignes.Count -eq 1) -and ([string]$lignes[0]).Length -gt $plafondJournalCaracteres) {
      $texteUnique = [string]$lignes[0]
      $lignes = @($texteUnique.Substring($texteUnique.Length - $plafondJournalCaracteres))
      $tronque = $true
    }
    $r.journal.extrait = @($lignes)
    $r.journal.tronque = $tronque
  }

  # Plafond du fichier entier : mesure sur les octets REELS qui seront ecrits (apres
  # decodage des \uXXXX), pas sur la sortie brute de ConvertTo-Json -- sans quoi ce controle
  # se declencherait plus tot que cote JS des qu'un rapport contient des caracteres accentues.
  $tailleActuelle = [System.Text.Encoding]::UTF8.GetByteCount((ConvertTo-SzhRapportJsonTexte -Objet $r))
  if (($tailleActuelle -gt $plafondFichierOctets) -and $r.journal) {
    $r.journal.extrait = @()
    $r.journal.tronque = $true
  }

  return $r
}

# =========================================================================================
# 8. Validation legere contre le schema v1 (equivalent JS : codesErreur.validerRapport) --
#    ne leve jamais, rend la liste des ecarts (vide = conforme). Ne bloque l'ecriture que sur
#    des defauts structurels grossiers : mieux vaut un rapport imparfait qu'un rapport
#    silencieusement avale par une validation trop stricte.
# =========================================================================================
function Test-SzhRapportValide {
  param($Rapport)

  # ArrayList, jamais Generic.List[T] : verifie a l'execution qu'envelopper un
  # Generic.List[object]/[string] dans "@(...)" a l'interieur (ou en vue) d'un litteral de
  # hashtable declenche la meme exception .NET interne que le "$(if...)" documente plus haut
  # -- ArrayList (et un tableau PowerShell natif) n'a pas ce defaut.
  $ecarts = New-Object System.Collections.ArrayList
  if ($null -eq $Rapport) { [void]$ecarts.Add('le rapport doit etre un objet'); return @($ecarts) }

  $ordreAttendu = @('schema', 'id', 'horodatage', 'horodatageLocal', 'gravite', 'source', 'code',
    'signature', 'resume', 'etape', 'message', 'pile', 'poste', 'versions', 'produit', 'ancrage',
    'fichiers', 'journal', 'constats', 'environnement')
  $presentes = @($Rapport.PSObject.Properties.Name)
  # Separateur improbable dans un nom de champ (pas de ``u{} en PowerShell 5.1) plutot qu'un
  # simple ',' : suffisant pour comparer un ordre exact sans risque de collision.
  $separateurCompare = [string][char]1
  if (($presentes -join $separateurCompare) -ne ($ordreAttendu -join $separateurCompare)) {
    foreach ($cle in $ordreAttendu) {
      if ($presentes -notcontains $cle) { [void]$ecarts.Add('champ absent : ' + $cle) }
    }
    foreach ($cle in $presentes) {
      if ($ordreAttendu -notcontains $cle) { [void]$ecarts.Add('champ inconnu du schema v1 : ' + $cle) }
    }
    if ($ecarts.Count -eq 0) { [void]$ecarts.Add('les cles de premier niveau ne sont pas dans l''ordre du schema v1') }
  }

  if ($Rapport.schema -ne 'szh-rapport-erreur/1') { [void]$ecarts.Add('schema invalide : ' + $Rapport.schema) }
  if ((-not ($Rapport.id -match '^\d{8}-\d{6}-[A-Za-z0-9-]+-[0-9a-f]{6}$')) -or ([string]$Rapport.id).Length -gt 120) {
    [void]$ecarts.Add('id ne respecte pas le format attendu : ' + $Rapport.id)
  }
  if (@('erreur', 'echec-partiel') -notcontains $Rapport.gravite) { [void]$ecarts.Add('gravite hors enumeration : ' + $Rapport.gravite) }
  if (@('lanceur', 'maj', 'archivage', 'cockpit', 'chaine') -notcontains $Rapport.source) { [void]$ecarts.Add('source hors enumeration : ' + $Rapport.source) }
  if ((Get-SzhRapportCodesConnus) -notcontains $Rapport.code) { [void]$ecarts.Add('code inconnu de la table : ' + $Rapport.code) }

  return @($ecarts)
}

# =========================================================================================
# 9. Anti-inondation (docs/RAPPORTS-ERREUR.md §5, D6 : jour calendaire LOCAL) -- equivalent JS :
#    purgerCompteursRapports + decisionAntiInondation. Compteurs partages avec l'ecrivain JS
#    dans etat-utilisateur.json, cle "rapports" : reproduits ICI au signe pres.
# =========================================================================================

# etat-utilisateur.json est lu par Get-SzhEtatUtilisateur (szh-common.ps1) comme un
# PSCustomObject imbrique ; ce module manipule les compteurs comme une Hashtable (cles
# arbitraires = signatures) pour rester simple -- conversion aller-retour ici.
function ConvertTo-SzhRapportHashtable {
  param($Objet)

  $h = @{}
  if ($null -eq $Objet) { return $h }
  if ($Objet -is [System.Collections.IDictionary]) {
    foreach ($cle in $Objet.Keys) { $h[$cle] = $Objet[$cle] }
    return $h
  }
  if ($Objet.PSObject) {
    foreach ($p in $Objet.PSObject.Properties) { $h[$p.Name] = $p.Value }
  }
  return $h
}

# Rend { autorise; motif; rapports } -- "rapports" est TOUJOURS la valeur a reecrire dans
# etat-utilisateur.json (purge appliquee, compteur du jour a jour), que la decision
# autorise ou non l'ecriture (meme contrat que decisionAntiInondation cote JS).
function Get-SzhRapportDecisionAntiInondation {
  param($Rapports, [string]$Signature, [datetime]$MaintenantLocal, [datetime]$MaintenantUtc)

  $periodeHeures = 24
  $maxParJour = 20
  $purgeJours = 7

  $source = $Rapports
  if (-not $source) { $source = @{} }

  $jour = $MaintenantLocal.ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
  $seuilPurge = $MaintenantUtc.AddDays(-1 * $purgeJours)

  $purge = [ordered]@{}
  foreach ($cle in $source.Keys) {
    if (($cle -eq '_jour') -or ($cle -eq '_compte')) { continue }
    $valeurBrute = [string]$source[$cle]
    $instantCle = $null
    try {
      $instantCle = ([DateTimeOffset]::Parse($valeurBrute, [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::RoundtripKind)).UtcDateTime
    } catch { $instantCle = $null }
    if (($null -ne $instantCle) -and ($instantCle -ge $seuilPurge)) { $purge[$cle] = $valeurBrute }
  }

  $compteAvant = 0
  if ($source.Contains('_jour') -and ([string]$source['_jour'] -eq $jour)) {
    try { $compteAvant = [int]$source['_compte'] } catch { $compteAvant = 0 }
  }

  if ($purge.Contains($Signature)) {
    $instantDerniere = $null
    try {
      $instantDerniere = ([DateTimeOffset]::Parse([string]$purge[$Signature], [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::RoundtripKind)).UtcDateTime
    } catch { $instantDerniere = $null }
    if ($null -ne $instantDerniere) {
      $depuis = $MaintenantUtc - $instantDerniere
      if (($depuis.TotalHours -ge 0) -and ($depuis.TotalHours -lt $periodeHeures)) {
        $rapportsSortie = [ordered]@{}
        foreach ($cle in $purge.Keys) { $rapportsSortie[$cle] = $purge[$cle] }
        $rapportsSortie['_jour'] = $jour
        $rapportsSortie['_compte'] = $compteAvant
        return [pscustomobject]@{ autorise = $false; motif = 'signature-recente'; rapports = $rapportsSortie }
      }
    }
  }

  if ($compteAvant -ge $maxParJour) {
    $rapportsSortie = [ordered]@{}
    foreach ($cle in $purge.Keys) { $rapportsSortie[$cle] = $purge[$cle] }
    $rapportsSortie['_jour'] = $jour
    $rapportsSortie['_compte'] = $compteAvant
    return [pscustomobject]@{ autorise = $false; motif = 'plafond-jour'; rapports = $rapportsSortie }
  }

  $nouveau = [ordered]@{}
  foreach ($cle in $purge.Keys) { $nouveau[$cle] = $purge[$cle] }
  $nouveau['_jour'] = $jour
  $nouveau['_compte'] = $compteAvant + 1
  $nouveau[$Signature] = $MaintenantUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [System.Globalization.CultureInfo]::InvariantCulture)
  return [pscustomobject]@{ autorise = $true; motif = $null; rapports = $nouveau }
}

# =========================================================================================
# 10. Extrait de journal (equivalent JS : lireExtraitFichier)
# =========================================================================================
function Get-SzhRapportExtraitJournal {
  param([string]$Chemin)

  if (-not $Chemin) { return $null }
  $texte = $null
  try { $texte = [System.IO.File]::ReadAllText($Chemin, [System.Text.Encoding]::UTF8) } catch { return $null }
  if ($null -eq $texte) { return $null }

  $lignes = @([regex]::Split($texte, "`r`n|`r|`n"))
  if (($lignes.Count -gt 0) -and ($lignes[$lignes.Count - 1] -eq '')) {
    $lignes = @($lignes | Select-Object -First ($lignes.Count - 1))
  }
  return [pscustomobject]@{ chemin = $Chemin; lignes = @($lignes).Count; tronque = $false; extrait = @($lignes) }
}

# =========================================================================================
# 11. Champ generique d'un objet -- Hashtable OU PSCustomObject, pour laisser les accroches
#     (update.ps1, archive-revue.ps1, open-produit.ps1, open-md.ps1) passer -Produit et les
#     entrees de -Fichiers sous la forme la plus commode pour elles.
# =========================================================================================
function Get-SzhRapportChampObjet {
  param($Objet, [string]$Nom)

  if ($null -eq $Objet) { return $null }
  if ($Objet -is [System.Collections.IDictionary]) {
    if ($Objet.Contains($Nom)) { return $Objet[$Nom] }
    return $null
  }
  if ($Objet.PSObject -and $Objet.PSObject.Properties[$Nom]) { return $Objet.PSObject.Properties[$Nom].Value }
  return $null
}

# Chemin ABSOLU -> { chemin; relatifA } avec repli ancrage puis programData puis absolu
# masque (equivalent JS : cheminRelatifAvecRepli).
function ConvertTo-SzhRapportCheminAvecRepli {
  param([string]$CheminAbsolu, $Racines)

  $ancrage = $null
  $programData = $null
  if ($Racines) {
    if ($Racines.Contains('ancrage')) { $ancrage = $Racines['ancrage'] }
    if ($Racines.Contains('programData')) { $programData = $Racines['programData'] }
  }

  $r = ConvertTo-SzhRapportCheminRelatif -Chemin $CheminAbsolu -Racine $ancrage -Etiquette 'ancrage'
  if (($r.relatifA -eq 'absolu') -and $programData) {
    $r2 = ConvertTo-SzhRapportCheminRelatif -Chemin $CheminAbsolu -Racine $programData -Etiquette 'programdata'
    if ($r2.relatifA -ne 'absolu') { $r = $r2 }
  }
  if ($r.relatifA -eq 'absolu') {
    $r = [pscustomobject]@{ chemin = (Protect-SzhRapportTexte -Texte $r.chemin -Racines $Racines); relatifA = 'absolu' }
  }
  return $r
}

# =========================================================================================
# 12. Ecriture sur disque -- UTF-8 SANS BOM, indentee 2 espaces, nom <id>.json
# =========================================================================================
#
# Fichier temporaire puis renommage : une lecture concurrente (tableau de bord SharePoint,
# script de tri) ne voit jamais un fichier a moitie ecrit. Rend $true/$false, ne leve jamais
# -- c'est l'appelant (Write-SzhRapport) qui decide quoi faire d'un echec (repli sur la file
# d'attente, puis abandon silencieux).
function Write-SzhRapportSurDisque {
  param([string]$Dossier, [string]$Id, $Rapport)

  try {
    New-Item -ItemType Directory -Force -Path $Dossier -ErrorAction Stop | Out-Null
    $texteJson = ConvertTo-SzhRapportJsonTexte -Objet $Rapport
    $cible = Join-Path $Dossier ($Id + '.json')
    $tmp = $cible + ('.tmp-{0}-{1}' -f $PID, ([guid]::NewGuid().ToString('N')))
    [System.IO.File]::WriteAllText($tmp, $texteJson, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $cible -Force -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

# =========================================================================================
# 13. File d'attente hors ligne (docs/RAPPORTS-ERREUR.md §6) -- equivalent JS : listerFileAttente +
#     purgerFileAttente + viderFileAttente.
# =========================================================================================

# Dossier de la file d'attente : par compte, comme etat-utilisateur.json -- reutilise
# $script:SzhBaseUtilisateur (szh-common.ps1), deja teste et deja au bon endroit
# (%LOCALAPPDATA%\SZH, ou le repli par SID si LOCALAPPDATA manque).
function Get-SzhRapportDossierAttente {
  return (Join-Path $script:SzhBaseUtilisateur 'rapports-en-attente')
}

# Les fichiers .json de la file, du plus ancien au plus recent (mtime) -- dossier absent ou
# illisible : liste vide, jamais une exception (D5).
function Get-SzhRapportsEnAttenteListe {
  param([string]$Dossier)

  # ArrayList, jamais Generic.List[T] (voir la note de Test-SzhRapportValide plus haut).
  $fichiers = New-Object System.Collections.ArrayList
  try {
    foreach ($f in @(Get-ChildItem -LiteralPath $Dossier -Filter '*.json' -File -ErrorAction Stop)) {
      [void]$fichiers.Add([pscustomobject]@{ chemin = $f.FullName; nom = $f.Name; ecrit = $f.LastWriteTimeUtc })
    }
  } catch { return @() }
  return @($fichiers | Sort-Object ecrit)
}

# Applique les deux plafonds de la file (50 fichiers, 30 jours) : les fichiers de plus de 30
# jours sont effaces SANS etre transmis, puis, au-dela de 50 fichiers restants, les plus
# anciens sont effaces. Rend la liste (deja purgee) qui subsiste.
function Limit-SzhRapportsEnAttente {
  param([string]$Dossier, [datetime]$Maintenant = (Get-Date))

  $plafondFichiers = 50
  $plafondJours = 30
  $seuilAge = $Maintenant.ToUniversalTime().AddDays(-1 * $plafondJours)

  $fichiers = @(Get-SzhRapportsEnAttenteListe -Dossier $Dossier | Where-Object {
    if ($_.ecrit -lt $seuilAge) {
      try { Remove-Item -LiteralPath $_.chemin -Force -ErrorAction Stop } catch { }
      return $false
    }
    return $true
  })

  if (@($fichiers).Count -gt $plafondFichiers) {
    $enTrop = @($fichiers).Count - $plafondFichiers
    for ($i = 0; $i -lt $enTrop; $i++) {
      try { Remove-Item -LiteralPath $fichiers[$i].chemin -Force -ErrorAction Stop } catch { }
    }
    $fichiers = @($fichiers | Select-Object -Skip $enTrop)
  }
  return @($fichiers)
}

# Videe au demarrage du lanceur (open-produit.ps1), apres resolution de l'ancrage : chaque
# fichier restant apres les plafonds est deplace vers le vrai dossier de rapports ; un echec
# le laisse en place pour la prochaine tentative. D10 : $env:SZH_RAPPORTS, quand pose,
# l'emporte sur toute derivation depuis l'ancrage -- exactement comme pour Write-SzhRapport.
function Clear-SzhRapportsEnAttente {
  try {
    if ($env:SZH_LANCEUR_SIMULE -eq '1') { return }

    $dossierRapports = ''
    if ($env:SZH_RAPPORTS) {
      $dossierRapports = [string]$env:SZH_RAPPORTS
    } else {
      $ancrage = Resolve-SzhAncrage
      if (-not $ancrage.chemin) { return }
      $dossierRapports = Get-SzhDossierRapportsDepuisAncrage $ancrage.chemin
    }

    $dossierAttente = Get-SzhRapportDossierAttente
    $fichiers = Limit-SzhRapportsEnAttente -Dossier $dossierAttente
    $deplaces = 0
    foreach ($f in $fichiers) {
      try {
        New-Item -ItemType Directory -Force -Path $dossierRapports -ErrorAction Stop | Out-Null
        Move-Item -LiteralPath $f.chemin -Destination (Join-Path $dossierRapports $f.nom) -Force -ErrorAction Stop
        $deplaces++
      } catch { }
    }
    if (($deplaces -gt 0) -or (@($fichiers).Count -gt 0)) {
      try { Write-SzhLog ('szh-rapport : file d''attente -> {0}/{1} deplace(s).' -f $deplaces, @($fichiers).Count) } catch { }
    }
  } catch {
    try { Write-SzhLog ('szh-rapport : vidage de la file d''attente impossible -> ' + $_.Exception.Message) } catch { }
  }
}

# =========================================================================================
# 14. L'orchestrateur -- la seule fonction que les accroches appellent.
# =========================================================================================
#
# Ne leve JAMAIS (D5) : toute exception interne est avalee et journalisee localement.
# NO-OP silencieux en simulation (voir l'en-tete du fichier).
#
# D10 : $env:SZH_RAPPORTS, quand pose, nomme DIRECTEMENT le dossier de rapports -- il
# l'emporte sur toute derivation depuis l'ancrage. L'ancrage continue d'etre resolu pour le
# champ "ancrage" du JSON et pour la mise en chemin relatif / le masquage : lui seul ne
# decide plus OU le fichier atterrit quand SZH_RAPPORTS est present.
function Write-SzhRapport {
  param(
    [string]$Code = '',
    [string]$Gravite = 'erreur',
    [string]$Source = '',
    $Etape = $null,
    $Message = $null,
    $Pile = $null,
    $Journal = $null,
    [object[]]$Fichiers = @(),
    $Produit = $null
  )

  try {
    if (-not $Code) {
      try { Write-SzhLog 'Write-SzhRapport : appele sans code, rien n''est ecrit' } catch { }
      return
    }
    if (($env:SZH_LANCEUR_SIMULE -eq '1') -or ($env:SZH_OPENMD_SIMULE -eq '1')) {
      try { Write-SzhLog ('Write-SzhRapport : ' + $Code + ' non ecrit (mode simulation)') } catch { }
      return
    }

    $instant = [DateTime]::UtcNow
    $instantLocal = $instant.ToLocalTime()

    # ---- Ancrage : resolution PASSIVE deja posee et memoisee par szh-ancrage.ps1 ---------
    # Resolve-SzhAncrage (szh-ancrage.ps1, contrat fige) rend { chemin; origine } -- PAS de
    # propriete .trouve (a la difference de la forme JS { trouve, origine, chemin }) : lire
    # une propriete absente sur un pscustomobject rend $null SANS lever, et "$ancrage.trouve"
    # aurait donc toujours ete $false, meme ancrage trouve -- verifie a l'execution (D10,
    # scenario SZH_ANCRAGE seul). "trouve" se derive donc ici de $ancrage.chemin.
    $ancrage = Resolve-SzhAncrage
    $ancrageTrouve = [bool]$ancrage.chemin
    $racines = @{
      ancrage     = $ancrage.chemin
      userProfile = $env:USERPROFILE
      programData = $script:SzhBase
    }

    # ---- Poste et versions ---------------------------------------------------------------
    # Champs calcules en variables A PART, jamais en "$(if (...) { ... } else { $null })"
    # inline a l'interieur d'un littéral de hashtable : verifie a l'execution que cette forme
    # inline y declenche une vraie exception .NET interne au lieur dynamique de PowerShell 5.1
    # ("Argument types do not match" / PSToObjectArrayBinder) des que les deux branches n'ont
    # pas le même type apparent (chaine contre $null) -- defaut qui aurait fait echouer TOUT
    # rapport en silence (rattrape par le garde D5, mais aucun rapport n'aurait jamais ete
    # ecrit). Toujours affecter d'abord une variable simple, puis l'assigner telle quelle.
    $nomPoste = [string]$env:COMPUTERNAME
    if (-not $nomPoste) { $nomPoste = 'POSTE' }
    $utilisateurPoste = $null
    if ($env:USERNAME) { $utilisateurPoste = [string]$env:USERNAME }
    $langueInterface = $null
    try { if ($script:SzhLangue) { $langueInterface = $script:SzhLangue } } catch { $langueInterface = $null }
    $poste = [ordered]@{
      nom             = $nomPoste
      utilisateur     = $utilisateurPoste
      os              = [System.Environment]::OSVersion.Version.ToString()
      powershell      = $PSVersionTable.PSVersion.ToString()
      langueInterface = $langueInterface
    }

    $versionVscodium = $null
    try {
      $exeCodium = Get-VSCodiumExe
      if ($exeCodium -and (Test-Path -LiteralPath $exeCodium)) {
        $versionVscodium = (Get-Item -LiteralPath $exeCodium).VersionInfo.ProductVersion
      }
    } catch { $versionVscodium = $null }
    $versionToolkit = $null
    try { $vt = Get-SzhVersionInstallee; if ($vt) { $versionToolkit = $vt } } catch { $versionToolkit = $null }
    $versions = [ordered]@{
      toolkit  = $versionToolkit
      cockpit  = $null
      vscodium = $versionVscodium
    }

    # ---- id (D9 : fonde sur l'UTC) ---------------------------------------------------------
    $id = $null
    try { $id = Get-SzhRapportId -Horodatage $instant -Poste $nomPoste -AleatoireHex (New-SzhRapportAleatoireHex) }
    catch { $id = $null }
    if (-not $id) {
      try { Write-SzhLog ('Write-SzhRapport : ' + $Code + ' abandonne, id invalide') } catch { }
      return
    }

    # ---- message/pile masques, signature ---------------------------------------------------
    $messageMasque = $null
    if ($null -ne $Message) { $messageMasque = Protect-SzhRapportTexte -Texte $Message -Racines $racines }
    $pileMasquee = $null
    if ($null -ne $Pile) { $pileMasquee = Protect-SzhRapportTexte -Texte $Pile -Racines $racines }

    $produitNumero = $null
    if ($Produit) { $produitNumero = Get-SzhRapportChampObjet $Produit 'numero' }
    $messagePourSignature = ''
    if ($null -ne $messageMasque) { $messagePourSignature = $messageMasque }
    $signature = Get-SzhRapportSignature -Source $Source -Code $Code -Etape $Etape `
      -MessageMasque $messagePourSignature -ProduitNumero $produitNumero

    # ---- fichiers ---------------------------------------------------------------------------
    # ArrayList, jamais Generic.List[T] (voir la note de Test-SzhRapportValide plus haut) :
    # ici en particulier, envelopper un Generic.List[object] contenant des [ordered]@{...}
    # dans "@(...)" a l'interieur d'un litteral de hashtable plus bas fait lever une vraie
    # exception .NET interne au lieur dynamique de PowerShell 5.1 -- verifie a l'execution.
    $fichiersRapport = New-Object System.Collections.ArrayList
    foreach ($f in $Fichiers) {
      if ($null -eq $f) { continue }
      $cheminF = $null
      $roleF = $null
      if ($f -is [string]) { $cheminF = $f }
      else {
        $cheminF = Get-SzhRapportChampObjet $f 'chemin'
        $roleF = Get-SzhRapportChampObjet $f 'role'
      }
      if (-not $cheminF) { continue }
      $rel = ConvertTo-SzhRapportCheminAvecRepli -CheminAbsolu $cheminF -Racines $racines
      [void]$fichiersRapport.Add([ordered]@{ chemin = $rel.chemin; relatifA = $rel.relatifA; role = $roleF })
    }

    # ---- journal ----------------------------------------------------------------------------
    $journalRapport = $null
    if ($Journal) {
      $extrait = Get-SzhRapportExtraitJournal -Chemin $Journal
      if ($extrait) {
        $relJournal = ConvertTo-SzhRapportCheminAvecRepli -CheminAbsolu $Journal -Racines $racines
        $lignesMasquees = @($extrait.extrait | ForEach-Object { Protect-SzhRapportTexte -Texte $_ -Racines $racines })
        $journalRapport = [ordered]@{
          chemin   = $relJournal.chemin
          relatifA = $relJournal.relatifA
          lignes   = $extrait.lignes
          tronque  = $false
          extrait  = $lignesMasquees
        }
      }
    }

    # ---- produit ----------------------------------------------------------------------------
    $produitRapport = $null
    if ($Produit) {
      $produitRapport = [ordered]@{
        type        = Get-SzhRapportChampObjet $Produit 'type'
        numero      = Get-SzhRapportChampObjet $Produit 'numero'
        emplacement = Get-SzhRapportChampObjet $Produit 'emplacement'
      }
    }

    $ancrageChemin = $null
    if ($ancrage.chemin) { $ancrageChemin = $ancrage.chemin }
    $etapeChamp = $null
    if ($Etape) { $etapeChamp = [string]$Etape }

    $rapport = [ordered]@{
      schema          = 'szh-rapport-erreur/1'
      id              = $id
      horodatage      = $instant.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [System.Globalization.CultureInfo]::InvariantCulture)
      horodatageLocal = Get-SzhRapportHorodatageLocal -DateLocale $instantLocal
      gravite         = $Gravite
      source          = $Source
      code            = $Code
      signature       = $signature
      resume          = (Get-SzhRapportResume -Code $Code)
      etape           = $etapeChamp
      message         = $messageMasque
      pile            = $pileMasquee
      poste           = $poste
      versions        = $versions
      produit         = $produitRapport
      ancrage         = [ordered]@{ trouve = $ancrageTrouve; origine = $ancrage.origine; chemin = $ancrageChemin }
      fichiers        = @($fichiersRapport)
      journal         = $journalRapport
      constats        = @()
      environnement   = $null
    }

    $rapport = Add-SzhRapportPlafonds -Rapport $rapport

    $ecarts = Test-SzhRapportValide -Rapport $rapport
    if (@($ecarts).Count -gt 0) {
      try { Write-SzhLog ('Write-SzhRapport : ' + $Code + ' mal forme -> ' + ($ecarts -join ' ; ')) } catch { }
      return
    }

    # ---- anti-inondation (§4.3, D6 : jour calendaire LOCAL) --------------------------------
    # Les compteurs sont reecrits que la decision autorise ou non, pour que le prochain appel
    # voie l'etat a jour -- meme contrat que decisionAntiInondation cote JS.
    $etatAvant = Get-SzhEtatUtilisateur
    $rapportsAvant = @{}
    if ($etatAvant -and $etatAvant.PSObject.Properties['rapports']) {
      $rapportsAvant = ConvertTo-SzhRapportHashtable $etatAvant.rapports
    }
    $decision = Get-SzhRapportDecisionAntiInondation -Rapports $rapportsAvant -Signature $signature `
      -MaintenantLocal $instantLocal -MaintenantUtc $instant
    try {
      $etatNouveau = $etatAvant
      if (-not $etatNouveau) { $etatNouveau = New-Object psobject }
      if ($etatNouveau.PSObject.Properties['rapports']) { $etatNouveau.rapports = $decision.rapports }
      else { $etatNouveau | Add-Member -MemberType NoteProperty -Name 'rapports' -Value $decision.rapports }
      Save-SzhEtatUtilisateur $etatNouveau | Out-Null
    } catch { }

    if (-not $decision.autorise) {
      try { Write-SzhLog ('Write-SzhRapport : ' + $Code + ' etouffe par l''anti-inondation (' + $decision.motif + '), perdu') } catch { }
      return
    }

    # ---- ecriture : SZH_RAPPORTS (D10) d'abord, puis l'ancrage, puis la file d'attente -----
    $dossierRapportsDirect = ''
    if ($env:SZH_RAPPORTS) { $dossierRapportsDirect = [string]$env:SZH_RAPPORTS }

    if ($dossierRapportsDirect) {
      if (Write-SzhRapportSurDisque -Dossier $dossierRapportsDirect -Id $id -Rapport $rapport) {
        try { Write-SzhLog ('Write-SzhRapport : ' + $id + ' ecrit (' + $Code + '), SZH_RAPPORTS') } catch { }
        return
      }
      try { Write-SzhLog ('Write-SzhRapport : dossier SZH_RAPPORTS injoignable, mise en attente (' + $Code + ')') } catch { }
    } elseif ($ancrageTrouve) {
      $dossierRapports = Get-SzhDossierRapportsDepuisAncrage $ancrage.chemin
      if (Write-SzhRapportSurDisque -Dossier $dossierRapports -Id $id -Rapport $rapport) {
        try { Write-SzhLog ('Write-SzhRapport : ' + $id + ' ecrit (' + $Code + ')') } catch { }
        return
      }
      try { Write-SzhLog ('Write-SzhRapport : dossier de rapports injoignable, mise en attente (' + $Code + ')') } catch { }
    } else {
      try { Write-SzhLog ('Write-SzhRapport : aucun ancrage resolu, mise en attente (' + $Code + ')') } catch { }
    }

    $dossierAttente = Get-SzhRapportDossierAttente
    if (Write-SzhRapportSurDisque -Dossier $dossierAttente -Id $id -Rapport $rapport) {
      try { Write-SzhLog ('Write-SzhRapport : ' + $id + ' mis en attente') } catch { }
      try { Limit-SzhRapportsEnAttente -Dossier $dossierAttente | Out-Null } catch { }
    } else {
      # D5, la regle absolue : un echec d'ecriture ne produit PAS un second rapport (pas de
      # boucle sur RAPPORT-ECHEC-ECRITURE, jamais ecrit en JSON) -- seule cette ligne locale le dit.
      try { Write-SzhLog ('Write-SzhRapport : ' + $Code + ' abandonne, ecriture impossible meme en attente') } catch { }
    }
  } catch {
    # Garde absolue (D5) : quoi qu'il arrive, cette fonction ne leve jamais.
    try { Write-SzhLog ('Write-SzhRapport : echec interne inattendu -> ' + $_.Exception.Message) } catch { }
  }
}
