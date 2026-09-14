<#
.SYNOPSIS
  Point d'entree du lanceur « Revue & Zeitschrift », appele par hidden.vbs, donc sans
  console. Enveloppe de quelques lignes : le raccourci du menu Demarrer
  (Get-SzhRaccourcisMenu, dans le socle) et le gestionnaire du protocole "szh:" (update.ps1)
  visent ce script par son nom, il reste donc le point d'entree -- toute la logique (fenetre
  a onglets, listes, « Nouveau... », reglages, selecteur de version) vit dans
  open-produit.ps1, commune aux trois produits.

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
  # L'onglet a ouvrir : « revue » ou « zeitschrift ». VIDE par defaut, et c'est tout le
  # changement -- le raccourci du menu Demarrer ne passe plus rien, et laisse donc le reglage
  # du compte decider quel onglet s'ouvre (Get-SzhOngletDefaut). Il y avait deux raccourcis
  # avant, chacun figeant le sien ; ceux d'entre eux qui sont restes epingles a une barre des
  # taches passent encore leur produit, et continuent d'ouvrir SON onglet.
  [string]$Produit = '',
  # Ouvre directement le selecteur de version, comme le bouton « Changer de version... » du
  # cockpit.
  [switch]$Versions
)

. "$PSScriptRoot\szh-common.ps1"

# Normalisation a la main : une valeur inattendue ne doit pas lever, le lanceur mourrait sans
# message. Tout ce qui n'est ni « revue » ni « zeitschrift » vaut « rien demande », et non
# plus « revue » -- c'est ce qui rend la main au reglage.
$produitFiltre = ([string]$Produit).ToLower()
if (($produitFiltre -ne 'revue') -and ($produitFiltre -ne 'zeitschrift')) { $produitFiltre = '' }

& (Join-Path $PSScriptRoot 'open-produit.ps1') -Produit $produitFiltre -Lien $Lien -Versions:$Versions
exit $LASTEXITCODE
