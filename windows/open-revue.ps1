<#
.SYNOPSIS
  Lanceur du menu Demarrer (« Revues SZH », « Zeitschriften SZH »), appele par hidden.vbs,
  donc sans console. Enveloppe de quelques lignes : les raccourcis du menu Demarrer
  (Get-SzhRaccourcisMenu, dans le socle) et le gestionnaire du protocole "szh:" (update.ps1)
  visent ce script par son nom, il reste donc le point d'entree -- toute la logique (fenetre,
  listes, "Nouvelle revue...", selecteur de version) vit maintenant dans open-produit.ps1,
  commune aux trois produits du lanceur.

    powershell -ExecutionPolicy Bypass -File open-revue.ps1
    powershell -ExecutionPolicy Bypass -File open-revue.ps1 -Versions   # selecteur de version seul

  Compatibilite : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  # Lien « szh://... » passe par le gestionnaire de protocole Windows : ouvre directement le
  # numero vise. Positionnel, parce que hidden.vbs requote chacun de ses arguments et qu'un
  # « %1 » requote se lie a un parametre positionnel.
  [Parameter(Position = 0)][string]$Lien,
  # « revue » (defaut) ou « zeitschrift » : ce qui distingue les deux raccourcis du menu
  # Demarrer. Pas de valeur « tout » : une liste melangee montrerait une Zeitschrift parmi les
  # revues, et « Nouvelle revue... » ne saurait pas quel produit creer.
  [string]$Produit = 'revue',
  # Ouvre directement le selecteur de version, comme le bouton « Changer de version... » du
  # cockpit.
  [switch]$Versions
)

. "$PSScriptRoot\szh-common.ps1"

# Normalisation a la main, comme avant l'unification : une valeur inattendue ne doit pas
# lever, le lanceur mourrait sans message. Tout sauf « zeitschrift » vaut « revue ».
$produitFiltre = ([string]$Produit).ToLower()
if ($produitFiltre -ne 'zeitschrift') { $produitFiltre = 'revue' }

& (Join-Path $PSScriptRoot 'open-produit.ps1') -Produit $produitFiltre -Lien $Lien -Versions:$Versions
exit $LASTEXITCODE
