# Ecrivain PowerShell des rapports d'erreur automatiques (docs/RAPPORTS-ERREUR.md).
# Construit un rapport conforme au schema v1 et l'ecrit, ou n'ecrit rien, sans jamais
# lever. Dot-source par szh-common.ps1, apres szh-ancrage.ps1 (Resolve-SzhAncrage,
# Get-SzhDossierRapportsDepuisAncrage).
#
# Compatibilite : Windows PowerShell 5.1.
#
# Equivalent JavaScript : vscodium-extension/szh-cockpit/lib/rapport-erreur.js et
# lib/codes-erreur.js. Schema, masquage, signature, format d'id et plafonds doivent etre
# identiques : les deux ecrivains partagent l'anti-inondation (etat-utilisateur.json, cle
# "rapports"). Chaque fonction nomme son equivalent JS.
#
# En simulation ($env:SZH_LANCEUR_SIMULE ou $env:SZH_OPENMD_SIMULE a '1', poses par les
# tests de open-revue.ps1 et open-md.ps1), Write-SzhRapport et Clear-SzhRapportsEnAttente
# ne font rien.

# =========================================================================================
# 1. Masquage (docs/RAPPORTS-ERREUR.md ; equivalent JS : codesErreur.masquer)
# =========================================================================================
#
# Sept regles, dans cet ordre : 1 ancrage -> 2 %USERPROFILE% -> 3 ProgramData ->
# 4 mot-cle+valeur -> 5b JWT complet -> 5a secret nu -> 6 courriel. La fonction ne depend
# d'aucune variable de script : le test l'extrait seule.
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

  # 1-2-3 : racines connues, la plus specifique d'abord (voir codes-erreur.js).
  $s = Remove-SzhRapportRacineLocale $s $ancrage ''
  $s = Remove-SzhRapportRacineLocale $s $userProfile '~\'
  $s = Remove-SzhRapportRacineLocale $s $programData ''

  # 4 : mot-cle de secret + le jeton qui suit, rien de plus (le reste de la ligne survit).
  $motif4 = '\b(api[-_ ]?key|token|secret|authorization|bearer|deepl|password|mot de passe|pwd)(\s*[:=]\s*|\s+)(\S+)'
  $s = [regex]::Replace($s, $motif4,
    { param($m) $m.Groups[1].Value + $m.Groups[2].Value + '***' },
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

  # 5b : un JWT complet (en-tete.charge-utile.signature), avant 5a, qui ne masquerait que
  # les segments assez longs.
  $motif5b = 'eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_.-]+)+'
  $s = [regex]::Replace($s, $motif5b, '***')

  # 5a : secret nu de 32 caracteres ou plus, melant majuscules, minuscules et chiffres. Ni
  # chemin (« / » exclu), ni empreinte hexadecimale, ni GUID.
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
# Rend { chemin; relatifA }, sans masquer : pour un chemin hors de toute racine connue,
# Write-SzhRapport applique ensuite Protect-SzhRapportTexte, comme cote JS
# (cheminRelatifAvecRepli).
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
# 200 premiers caracteres du message deja masque | produit.numero), champ manquant = ''.
# Les deux ecrivains doivent produire ce texte au caractere pres, separateur ' | ' compris.
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
# L'horodatage est en UTC : l'heure locale reculerait au changement d'heure et casserait le
# tri alphabetique.
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
# poste, decalage inclus. Pour la lecture, pas pour le tri.
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
# 5. Table des codes et resumes FR/DE (equivalent JS : codesErreur.CODES). Les textes
#    doivent rester identiques a ceux du JS (test/js/codes-erreur.test.js le verifie).
# =========================================================================================
function Get-SzhRapportResume {
  param([string]$Code)

  # Chaque apostrophe typographique ’ est doublee (’’) : PowerShell 5.1 la traite comme un
  # delimiteur de chaine, au meme titre que '. Doublee, elle donne une seule apostrophe,
  # comme dans szh-textes.ps1.
  $table = @{
    'LANCEUR-TRAP' = @{ fr = 'Une erreur inattendue est survenue à l’’ouverture du lanceur ; ce rapport en garde la trace pour le diagnostic.'; de = 'Beim Öffnen des Starters ist ein unerwarteter Fehler aufgetreten; dieser Bericht hält ihn zur Diagnose fest.' }
    'LANCEUR-CODIUM-ABSENT' = @{ fr = 'VSCodium est introuvable au démarrage du lanceur ; l’’éditeur ne peut pas s’’ouvrir tant qu’’il n’’est pas réinstallé.'; de = 'VSCodium wurde beim Start des Starters nicht gefunden; der Editor kann erst nach einer Neuinstallation geöffnet werden.' }
    'ACCUEIL-COCKPIT-ABSENT' = @{ fr = 'L’’extension du cockpit manque sur ce poste, ou elle est trop ancienne pour ouvrir l’’Accueil ; « Pronto (Updater) » la remet à jour.'; de = 'Die Cockpit-Erweiterung fehlt auf diesem Computer oder ist zu alt, um die Startseite zu öffnen; «Pronto (Updater)» bringt sie auf den neuesten Stand.' }
    'ANCRAGE-INTROUVABLE' = @{ fr = 'Aucun dossier SharePoint n’’a pu être identifié, ni automatiquement ni par la personne consultée ; les produits restent introuvables jusqu’’à ce qu’’il soit indiqué.'; de = 'Es konnte kein SharePoint-Ordner gefunden werden, weder automatisch noch durch Rückfrage; die Produkte bleiben unauffindbar, bis er angegeben wird.' }
    'MAJ-ETAPE-ECHEC' = @{ fr = 'Une étape de la mise à jour a échoué, mais les suivantes ont continué ; ce rapport précise laquelle.'; de = 'Ein Schritt der Aktualisierung ist fehlgeschlagen, die übrigen wurden trotzdem fortgesetzt; dieser Bericht nennt den betroffenen Schritt.' }
    'MAJ-ECHEC' = @{ fr = 'La mise à jour s’’est arrêtée avant la fin ; le poste garde la version qu’’il avait avant l’’essai.'; de = 'Die Aktualisierung wurde vorzeitig abgebrochen; der Rechner behält die Version, die er vor dem Versuch hatte.' }
    'ARCHIVAGE-ECHEC' = @{ fr = 'Le déplacement d’’un numéro ou d’’un livre vers les archives n’’a pas abouti ; rien n’’a été perdu, il reste à l’’endroit où il était.'; de = 'Das Verschieben einer Ausgabe oder eines Buches ins Archiv ist nicht gelungen; nichts ist verloren gegangen, es bleibt an seinem bisherigen Ort.' }
    'COMPIL-ECHEC' = @{ fr = 'La compilation s’’est arrêtée sans produire de résultat exploitable ; le journal de la tâche en donne le détail.'; de = 'Die Kompilierung wurde beendet, ohne ein brauchbares Ergebnis zu liefern; das Aufgabenprotokoll enthält die Einzelheiten.' }
    'COCKPIT-EXCEPTION' = @{ fr = 'Une erreur inattendue est survenue dans l’’extension du cockpit ; VSCodium reste ouvert, seule une fonctionnalité peut être affectée.'; de = 'In der Cockpit-Erweiterung ist ein unerwarteter Fehler aufgetreten; VSCodium bleibt geöffnet, nur eine einzelne Funktion kann betroffen sein.' }
    'NETTOYEUR-ECHEC' = @{ fr = 'Le nettoyeur de manuscrit s’’est arrêté sur un défaut du logiciel, sans rapport avec le contenu du manuscrit ; ce rapport n’’en garde que la nature et l’’endroit, jamais le texte.'; de = 'Der Manuskript-Bereiniger wurde durch einen Softwarefehler angehalten, der nichts mit dem Inhalt des Manuskripts zu tun hat; dieser Bericht hält nur Art und Ort fest, nie den Text.' }
    'RAPPORT-ECHEC-ECRITURE' = @{ fr = 'L’’écriture d’’un rapport d’’erreur a elle-même échoué ; par construction, cet échec n’’est jamais transformé en nouveau rapport, seul le journal local le garde.'; de = 'Das Schreiben eines Fehlerberichts ist selbst fehlgeschlagen; dieser Fehler wird bewusst nicht erneut als Bericht erzeugt, nur das lokale Protokoll hält ihn fest.' }
    'LANCEUR-SIGNALEMENT' = @{ fr = 'Une personne a signalé elle-même un problème depuis l’’onglet « Journal » du lanceur ; le message est celui qu’’elle a écrit, et le journal joint celui qu’’elle a choisi.'; de = 'Eine Person hat ein Problem selbst über die Registerkarte «Protokoll» des Starters gemeldet; die Meldung ist ihr eigener Text, das beigefügte Protokoll das von ihr gewählte.' }
    'COCKPIT-SIGNALEMENT' = @{ fr = 'Une personne a signalé elle-même un défaut depuis une carte de contrôle du cockpit ; le rapport nomme le contrôle et l’’article, et joint la fin du journal de compilation.'; de = 'Eine Person hat einen Fehler selbst über eine Prüfkarte des Cockpits gemeldet; der Bericht nennt die Prüfung und den Artikel und fügt das Ende des Kompilierprotokolls bei.' }
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
    'MAJ-ECHEC', 'ARCHIVAGE-ECHEC', 'COMPIL-ECHEC', 'COCKPIT-EXCEPTION', 'RAPPORT-ECHEC-ECRITURE',
    'LANCEUR-SIGNALEMENT', 'NETTOYEUR-ECHEC', 'COCKPIT-SIGNALEMENT', 'ACCUEIL-COCKPIT-ABSENT')
}

# =========================================================================================
# 6. Serialisation JSON UTF-8 sans BOM, indentee 2 espaces (equivalent JS :
#    JSON.stringify(rapport, null, 2))
# =========================================================================================
#
# Serialiseur ecrit a la main : sous Windows PowerShell 5.1, ConvertTo-Json indente de 4
# espaces et ecrit « "cle":  "valeur" », sans parametre pour changer cela. Celui-ci
# reproduit JSON.stringify(valeur, null, 2) de Node : deux espaces par niveau, « : » suivi
# d'un espace, "{}" et "[]" pour les vides, caracteres non ASCII ecrits tels quels.
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
      # Non ASCII : ecrit tel quel, comme Node.
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

  # Objet : IDictionary (litteral @{} ou [ordered]@{}) ou PSCustomObject (issu de
  # ConvertFrom-Json, comme dans Add-SzhRapportPlafonds).
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

  # Tout autre type est rendu comme chaine, sans lever.
  return (ConvertTo-SzhRapportJsonChaine ([string]$Valeur))
}

function ConvertTo-SzhRapportJsonTexte {
  param($Objet)

  return ((ConvertTo-SzhRapportJsonValeur -Valeur $Objet -Niveau 0) + "`n")
}

# =========================================================================================
# 7. Plafonds (equivalent JS : codesErreur.appliquerPlafonds). Rend un nouveau rapport,
#    sans modifier celui qu'on lui passe.
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

  # Copie profonde par aller-retour JSON, comme cote JS.
  $r = ($Rapport | ConvertTo-Json -Depth 20) | ConvertFrom-Json

  if (($null -ne $r.message) -and ($r.message.Length -gt $plafondMessage)) {
    $r.message = $r.message.Substring(0, $plafondMessage)
  }
  if (($null -ne $r.pile) -and ($r.pile.Length -gt $plafondPile)) {
    $r.pile = $r.pile.Substring(0, $plafondPile)
  }

  # Fichiers et constats : on garde les premieres entrees, comme cote JS.
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

  # Plafond du fichier entier, mesure sur les octets qui seront ecrits (comme cote JS), pas
  # sur la sortie de ConvertTo-Json qui echappe les accents.
  $tailleActuelle = [System.Text.Encoding]::UTF8.GetByteCount((ConvertTo-SzhRapportJsonTexte -Objet $r))
  if (($tailleActuelle -gt $plafondFichierOctets) -and $r.journal) {
    $r.journal.extrait = @()
    $r.journal.tronque = $true
  }

  return $r
}

# =========================================================================================
# 8. Validation legere contre le schema v1 (equivalent JS : codesErreur.validerRapport).
#    Rend la liste des ecarts (vide : conforme), sans lever. Elle ne controle que la
#    structure : mieux vaut un rapport imparfait qu'aucun rapport.
# =========================================================================================
function Test-SzhRapportValide {
  param($Rapport)

  # ArrayList plutot que Generic.List[T] : sous PowerShell 5.1, un Generic.List enveloppe
  # dans « @(...) » pres d'un litteral de hashtable leve une exception .NET interne.
  $ecarts = New-Object System.Collections.ArrayList
  if ($null -eq $Rapport) { [void]$ecarts.Add('le rapport doit etre un objet'); return @($ecarts) }

  $ordreAttendu = @('schema', 'id', 'horodatage', 'horodatageLocal', 'gravite', 'source', 'code',
    'signature', 'resume', 'etape', 'message', 'pile', 'poste', 'versions', 'produit', 'ancrage',
    'fichiers', 'journal', 'constats', 'environnement')
  $presentes = @($Rapport.PSObject.Properties.Name)
  # Separateur [char]1, absent de tout nom de champ, pour comparer l'ordre exact des cles.
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
# 9. Anti-inondation (docs/RAPPORTS-ERREUR.md ; jour calendaire local). Equivalent JS :
#    purgerCompteursRapports + decisionAntiInondation. Les compteurs, partages avec
#    l'ecrivain JS dans etat-utilisateur.json (cle "rapports"), suivent les memes regles.
# =========================================================================================

# Convertit un PSCustomObject (lu par Get-SzhEtatUtilisateur) en Hashtable : les compteurs
# ont pour cles des signatures arbitraires.
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

# Rend { autorise; motif; rapports }. "rapports" est la valeur a reecrire dans
# etat-utilisateur.json (purge faite, compteur du jour a jour), que l'ecriture soit
# autorisee ou non, comme decisionAntiInondation cote JS.
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
# 11. Champ d'un objet, Hashtable ou PSCustomObject : les appelants passent -Produit et les
#     entrees de -Fichiers sous l'une ou l'autre forme.
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

# Chemin absolu -> { chemin; relatifA } : relatif a l'ancrage, sinon a programData, sinon
# absolu masque (equivalent JS : cheminRelatifAvecRepli).
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
# 12. Ecriture sur disque : UTF-8 sans BOM, indentee 2 espaces, nom <id>.json
# =========================================================================================
#
# Fichier temporaire puis renommage : un lecteur concurrent ne voit jamais un fichier a
# moitie ecrit. Rend $true ou $false sans lever ; Write-SzhRapport decide de la suite (file
# d'attente, puis abandon silencieux).
#
# Le temporaire porte le prefixe "~$", que OneDrive ne synchronise pas (comme ecrireAtomique
# de lib/yaml.js et Write-SzhCheckinCsv), et le finally le supprime en cas d'echec. Son nom
# ne finit pas par ".json" : Get-SzhRapportsEnAttenteListe et son equivalent JS l'ignorent.
function Write-SzhRapportSurDisque {
  param([string]$Dossier, [string]$Id, $Rapport)

  $tmp = ''
  try {
    New-Item -ItemType Directory -Force -Path $Dossier -ErrorAction Stop | Out-Null
    $texteJson = ConvertTo-SzhRapportJsonTexte -Objet $Rapport
    $cible = Join-Path $Dossier ($Id + '.json')
    $tmp = Join-Path $Dossier ('~$' + $Id + '.json.' + $PID + '.' +
      ([guid]::NewGuid().ToString('N').Substring(0, 8)))
    [System.IO.File]::WriteAllText($tmp, $texteJson, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $cible -Force -ErrorAction Stop
    return $true
  } catch {
    return $false
  } finally {
    if ($tmp) {
      try { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue } } catch { }
    }
  }
}

# =========================================================================================
# 13. File d'attente hors ligne (docs/RAPPORTS-ERREUR.md). Equivalent JS : listerFileAttente
#     + purgerFileAttente + viderFileAttente.
# =========================================================================================

# Dossier de la file d'attente, propre au compte : sous $script:SzhBaseUtilisateur
# (szh-common.ps1), comme etat-utilisateur.json.
function Get-SzhRapportDossierAttente {
  return (Join-Path $script:SzhBaseUtilisateur 'rapports-en-attente')
}

# Les fichiers .json de la file, du plus ancien au plus recent. Dossier absent ou illisible :
# liste vide, sans lever.
function Get-SzhRapportsEnAttenteListe {
  param([string]$Dossier)

  # ArrayList plutot que Generic.List[T] (voir Test-SzhRapportValide).
  $fichiers = New-Object System.Collections.ArrayList
  try {
    foreach ($f in @(Get-ChildItem -LiteralPath $Dossier -Filter '*.json' -File -ErrorAction Stop)) {
      [void]$fichiers.Add([pscustomobject]@{ chemin = $f.FullName; nom = $f.Name; ecrit = $f.LastWriteTimeUtc })
    }
  } catch { return @() }
  return @($fichiers | Sort-Object ecrit)
}

# Applique les plafonds de la file : les fichiers de plus de 30 jours sont effaces sans
# etre transmis, puis, au-dela de 50, les plus anciens. Rend la liste restante.
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

# Vide la file au demarrage (Invoke-SzhTachesDemarrage), apres la resolution de l'ancrage :
# chaque fichier part vers le dossier de rapports ; un echec le laisse pour la prochaine
# fois. $env:SZH_RAPPORTS, s'il est pose, remplace le dossier tire de l'ancrage, comme dans
# Write-SzhRapport.
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
# 14. Write-SzhRapport, seule fonction que les autres scripts appellent.
# =========================================================================================
#
# Ne leve jamais : toute exception interne est journalisee localement. Ne fait rien en
# simulation (voir l'en-tete).
#
# $env:SZH_RAPPORTS, s'il est pose, nomme directement le dossier de rapports. L'ancrage
# reste resolu pour le champ "ancrage" du JSON, les chemins relatifs et le masquage.
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

    # ---- Ancrage : resolution passive, memorisee par szh-ancrage.ps1 ----------------------
    # Resolve-SzhAncrage rend { chemin; origine }, sans propriete .trouve (contrairement a
    # la forme JS) : "trouve" se deduit de $ancrage.chemin.
    $ancrage = Resolve-SzhAncrage
    $ancrageTrouve = [bool]$ancrage.chemin
    $racines = @{
      ancrage     = $ancrage.chemin
      userProfile = $env:USERPROFILE
      programData = $script:SzhBase
    }

    # ---- Poste et versions ---------------------------------------------------------------
    # Chaque champ passe par une variable simple avant le litteral de hashtable : sous
    # PowerShell 5.1, un "$(if (...) { ... } else { $null })" place dans le litteral leve
    # « Argument types do not match » quand les branches n'ont pas le meme type.
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

    # ---- id (en UTC) -------------------------------------------------------------------------
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
    # ArrayList plutot que Generic.List[T] (voir Test-SzhRapportValide) : la liste est
    # enveloppee dans « @(...) » dans le litteral de hashtable plus bas.
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

    # ---- anti-inondation (jour calendaire local) ---------------------------------------------
    # Les compteurs sont reecrits dans tous les cas, comme cote JS.
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

    # ---- ecriture : SZH_RAPPORTS, sinon l'ancrage, sinon la file d'attente ------------------
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
      # Un echec d'ecriture ne produit pas de second rapport : seul le journal local le note.
      try { Write-SzhLog ('Write-SzhRapport : ' + $Code + ' abandonne, ecriture impossible meme en attente') } catch { }
    }
  } catch {
    # Cette fonction ne leve jamais.
    try { Write-SzhLog ('Write-SzhRapport : echec interne inattendu -> ' + $_.Exception.Message) } catch { }
  }
}
