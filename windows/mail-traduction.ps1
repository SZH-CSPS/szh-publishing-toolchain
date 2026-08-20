<#
.SYNOPSIS
  Prépare l'e-mail « Envoyer pour traduction » (D127) : brouillon Outlook avec le lien
  szh:// en VRAI HYPERLIEN, rédigé DANS LA LANGUE de la personne qui va traduire, et
  adressé à la rédaction concernée.

    powershell -ExecutionPolicy Bypass -File mail-traduction.ps1 -Lien "szh://traduction/revue/2026-01"

.DESCRIPTION
  POURQUOI un script et pas un `mailto:` depuis l'extension : un corps `mailto:` est du
  TEXTE BRUT, et aucun client ne rend cliquable un schéma qu'il ne connaît pas — le lien
  szh:// arrivait donc inerte. Seul un corps HTML donne un vrai <a href>, et cela passe
  par l'objet mail d'Outlook. Repli `mailto:` si Outlook est absent : le lien y est alors
  sur sa propre ligne, à copier-coller.

  LA LANGUE DE L'E-MAIL EST CELLE DE LA CIBLE, pas celle de l'expéditeur ni de son
  interface : une Zeitschrift (allemand) part à traduire vers le français, donc l'e-mail
  est en français ; une Revue (français) part vers l'allemand, donc l'e-mail est en
  allemand. Les gabarits vivent ici, pas dans l'i18n du cockpit, précisément pour cette
  raison — ils ne doivent PAS suivre la langue de l'interface.

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Lien
)

. "$PSScriptRoot\szh-common.ps1"

# Échappe ce qui part dans le corps HTML. Les valeurs viennent du lien (alphabets
# stricts) mais on n'injecte jamais sans échapper : la règle vaut aussi ici.
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

  # ---- Brouillon Outlook (le seul chemin qui donne un hyperlien) -------------------
  # Sauf si le poste a demandé le contraire (D130) : « "mailTraduction": "mailto" » dans
  # config.json ouvre le client par défaut — le nouvel Outlook, typiquement — en
  # acceptant un lien inerte.
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
      $mail.Display($false)                                 # AFFICHE le brouillon, n'envoie rien
      $fait = $true
      Write-SzhLog ('mail-traduction : brouillon Outlook prepare (' + $langue + ' -> ' + $destinataire + ')')
    } catch {
      Write-SzhLog ('mail-traduction : Outlook indisponible (' + $_.Exception.Message + ') -> repli mailto')
    }
  }

  # ---- Repli : mailto (texte brut, lien sur sa propre ligne) ----------------------
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
