# Logos

- `edition-szh-csps.svg`, `edition-szh-csps-symbole.svg` : logo de l'Edition SZH/CSPS
  (page de titre des livres, couvertures).
- `leichte-sprache.svg` : logo « Leichte Sprache » des livres FALC (couvertures).
- `cc-*.svg` : boutons de licence Creative Commons, posés sous la phrase de licence de
  l'impressum des livres en maquette normal (`livre-assembler.py`, `LICENCES`).

## Boutons Creative Commons

Boutons officiels au format « 88x31 » normal, en SVG, téléchargés le 03.10.2026 depuis la
page <https://creativecommons.org/mission/downloads/> (redirection de
<https://creativecommons.org/about/downloads/>), et versés **sans modification** : le
fichier est octet pour octet celui de la source. Le dessin ne porte pas de version : le même
bouton sert à la 4.0. `test/js/livre-structure.test.js` vérifie chaque empreinte.

| Fichier | Source | sha256 |
|---|---|---|
| `cc-by-4.0.svg` | https://mirrors.creativecommons.org/presskit/buttons/88x31/svg/by.svg | `952c4b353b604aafc1e7ed35c1334aa30d8c3ba06ee21beb091ca9c1b83a21c5` |
| `cc-by-sa-4.0.svg` | https://mirrors.creativecommons.org/presskit/buttons/88x31/svg/by-sa.svg | `563ad4d85acbbe874a6e18c09f5ade965a38f19940d4a8245effcd915138b7eb` |
| `cc-by-nc-4.0.svg` | https://mirrors.creativecommons.org/presskit/buttons/88x31/svg/by-nc.svg | `9015e777669583962c5ee91a05b786beca73792e340b8def3bb801d68648d3dd` |
| `cc-by-nc-nd-4.0.svg` | https://mirrors.creativecommons.org/presskit/buttons/88x31/svg/by-nc-nd.svg | `b4c5015c7099cec4f0b37d844952f6922ba3cdd8bfebf3b03867addb54032952` |

Conditions d'usage, d'après la *Trademark Policy* de Creative Commons
(<https://creativecommons.org/policies/#trademark>, lue le 03.10.2026) :

- les boutons sont des marques de Creative Commons ; on les télécharge directement depuis
  son site ;
- un bouton ne sert qu'à décrire la licence Creative Commons qui s'applique à l'œuvre, et
  s'accompagne, d'une manière raisonnable pour le support, de l'URI de l'acte (*Commons
  deed*) de cette licence ;
- aucune version modifiée n'est permise (seule la couleur du logo CC et de son fond peut
  changer, avec un contraste d'au moins 3:1) ;
- l'usage ne doit pas laisser croire à un soutien de Creative Commons ou à une association
  avec elle.

Un nouveau bouton se télécharge de la même page, sans retouche, et sa ligne s'ajoute
ci-dessus.
