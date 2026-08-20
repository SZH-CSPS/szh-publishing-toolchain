<#
.SYNOPSIS
  Prépare l'e-mail « Envoyer pour traduction » : brouillon Outlook portant le lien szh://
  en hyperlien, rédigé dans la langue de la personne qui traduira et adressé à la
  rédaction concernée.

    powershell -ExecutionPolicy Bypass -File mail-traduction.ps1 -Lien "szh://traduction/revue/2026-01"

.DESCRIPTION
  Un script plutôt qu'un `mailto:`, parce qu'un corps `mailto:` est du texte brut et
  qu'aucun client ne rend cliquable un schéma inconnu : seul un corps HTML donne un vrai
  <a href>, ce qui passe par l'objet mail d'Outlook, d'où le repli `mailto:` sans lui.

  La langue de l'e-mail est celle de la cible, pas celle de l'expéditeur : une Zeitschrift
  part vers le français, une Revue vers l'allemand. Les gabarits vivent donc ici et non
  dans la traduction du cockpit, qui suit l'interface.

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Lien
)

. "$PSScriptRoot\szh-common.ps1"

# Échappe ce qui part dans le corps HTML : les valeurs viennent du lien, dont les
# alphabets sont stricts, mais on n'injecte pas sans échapper.
function Protect-SzhHtml([string]$Texte) {
  return ([string]$Texte).Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
}

try {
  $cible = Get-SzhLien $Lien
  if (-not $cible) { throw ('lien invalide : ' + $Lien) }

  # Sens de la traduction, destinataire, langue de l'e-mail : tout découle du produit.
  $langue = Get-SzhLangueTraduction $cible.produit          # 'fr' pour une Zeitschrift
  $destinataire = Get-SzhMailTraduction $cible.produit
  $quoi = $cible.numero
  if ($cible.article) { $quoi = $quoi + ' / ' + $cible.article }

  $g = Get-SzhGabaritTraduction $langue
  $sujet = ($g.sujet -f $quoi)
  $lienHtml = Protect-SzhHtml $Lien
  $corpsHtml = ($g.html -f (Protect-SzhHtml $quoi), $lienHtml)
  $corpsTexte = ($g.texte -f $quoi, $Lien)

  # ---- Brouillon Outlook, le seul chemin qui donne un hyperlien ----
  # Sauf si le poste a demandé le contraire : « "mailTraduction": "mailto" » dans
  # config.json ouvre le client par défaut, au prix d'un lien inerte.
  $fait = $false
  if ((Get-SzhModeMailTraduction) -eq 'mailto') {
    Write-SzhLog 'mail-traduction : mode mailto demande par config.json'
  } else {
    try {
      $outlook = New-Object -ComObject Outlook.Application
      $mail = $outlook.CreateItem(0)                        # 0 = olMailItem
      $mail.To = $destinataire
      $mail.Subject = $sujet
      $mail.HTMLBody = $corpsHtml
      $mail.Display($false)                                 # affiche le brouillon, n'envoie rien
      $fait = $true
      Write-SzhLog ('mail-traduction : brouillon Outlook prepare (' + $langue + ' -> ' + $destinataire + ')')
    } catch {
      Write-SzhLog ('mail-traduction : Outlook indisponible (' + $_.Exception.Message + ') -> repli mailto')
    }
  }

  # ---- Repli : mailto, texte brut, lien sur sa propre ligne ----
  if (-not $fait) {
    $uri = ('mailto:{0}?subject={1}&body={2}' -f $destinataire,
      [Uri]::EscapeDataString($sujet), [Uri]::EscapeDataString($corpsTexte))
    Start-Process $uri
    Write-SzhLog ('mail-traduction : mailto ouvert (' + $langue + ' -> ' + $destinataire + ')')
  }
  exit 0
} catch {
  $souci = $_.Exception.Message
  try { Write-SzhLog ('mail-traduction ERREUR : ' + $souci) } catch { }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($souci, 'Revues SZH',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Warning)
  } catch { }
  exit 1
}
