# Nettoyeur de manuscrit — ce qui reste

Points encore ouverts, repris tels quels de l'état de reprise du 22.09.2026 et du rapport du
lexique des noms (tous deux supprimés au nettoyage du 01.10.2026, lisibles dans l'historique
git). Le contrat est [`docs/ARCHITECTURE-nettoyeur-manuscrit.md`](../ARCHITECTURE-nettoyeur-manuscrit.md).

## Mesures et validation

- Mesure de faux positifs sur des versions publiées (dix numéros), lot C allemand, cas A réel.
- Divergence ouverte : `score.py` du harnais compte 22/34 faux titres rattrapés, le contrat dit
  25/34 (mesure directe `lire()+classer_titres()`, sans retrait d'en-tête) — méthode de comptage,
  à trancher avant de citer un chiffre.
- Reste signalé (22.09.2026) : 6 alertes d'alt sur une image liée à l'en-tête ; le filtre
  typographique de compilation pose une insécable dans un titre anglais de référence.

## Lexique des noms

- **La virgule « Nom, Prénom » ne vote pas** pour l'ordre du document. Décision de l'agent, dans
  le sens prudent ; à confirmer ou à renverser.
- **Le second banc « par document »** n'existe pas. Le corpus existe :
  `tmp/corpus-relecture/lot-A/` porte 11 manuscrits réels avec leur table d'attendus. C'est le
  seul banc qui mesurerait ce que la propagation apporte vraiment, et le seul qui dirait le vrai
  coût d'une inversion. À décider.
- **Les sources DE / AT / IT** n'ont pas été cherchées : si un jeu ouvert et pondéré existe pour
  l'un des trois, il s'ajoute au moissonneur en cinq lignes (une entrée dans `SOURCES`).
