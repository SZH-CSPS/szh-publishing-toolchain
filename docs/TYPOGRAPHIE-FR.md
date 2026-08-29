# Typographie – ce que la chaîne corrige toute seule

Pour la rédaction francophone de la *Revue suisse de pédagogie spécialisée*.

Vous n’avez rien à taper de particulier. Écrivez au kilomètre, avec l’apostrophe et les
guillemets de votre clavier : la chaîne pose la bonne typographie à la compilation, dans
la langue déclarée de l’article.

**Votre fichier n’est jamais modifié.** La correction a lieu au moment où le PDF se
fabrique. Le Markdown reste exactement ce que vous avez écrit – lisible, comparable d’une
version à l’autre – et c’est la sortie qui est composée dans les règles.

> Les règles viennent du *Guide du typographe*, le code romand publié par le Groupe de
> Lausanne de l’Association suisse des typographes, confronté aux 421 articles déjà
> publiés sur ojs.szh.ch. Le détail des mesures est dans [TYPOGRAPHIE.md](TYPOGRAPHIE.md).

---

## Les douze règles

Chaque règle porte un code. Il sert à en parler sans la décrire, et c’est celui qu’affiche
`python3 test/typo-check.py --liste`.

### A – Apostrophes et guillemets

| Code | Vous écrivez | Vous obtenez |
|---|---|---|
| **A1** | `l'enfant d'ici` | l’enfant d’ici |
| **A2** | `"une citation"` | «&nbsp;une citation&nbsp;» |
| **A3** | `"un 'mot' cité"` | «&nbsp;un ‹&nbsp;mot&nbsp;› cité&nbsp;» |

**A1** – l’apostrophe droite devient l’apostrophe typographique `’` dans toutes les
élisions.

**A2** – les guillemets, quels qu’ils soient (`"`, `“ ”`, `„ “`), deviennent des chevrons
`« »`. C’est le guillemet de la revue, en français comme en allemand.

**A3** – une citation dans une citation prend les chevrons simples `‹ ›`.

### E – Espaces

| Code | Vous écrivez | Vous obtenez |
|---|---|---|
| **E1** | `« mot »` ou `«mot»` | «&nbsp;mot&nbsp;» |
| **E2** | `la suite : ainsi` ou `la suite: ainsi` | la suite&nbsp;: ainsi |
| **E3** | `80 %` ou `80%` | 80&nbsp;% |
| **E4** | `p. ex.`, `p. 202`, `n° 3` | p.&nbsp;ex., p.&nbsp;202, n°&nbsp;3 |

C’est la famille qui distingue le plus le français de l’allemand : **le français sépare, à
l’espace insécable ; l’allemand colle.** Une espace insécable retient les deux mots
ensemble – le deux-points ne peut pas se retrouver seul en début de ligne.

**E2** vaut pour les quatre signes doubles : `;` `:` `!` `?`. La règle ne s’applique qu’en
fin de mot, ce qui laisse tranquilles `https://…`, `10:30` et les codes.

### T – Tirets

| Code | Vous écrivez | Vous obtenez |
|---|---|---|
| **T1** | `un mot --- une incise --- la suite` | un mot&nbsp;– une incise&nbsp;– la suite |
| **T2** | `pp. 12-25` | pp.&nbsp;12–25 |

**T1** – le tiret de la revue est le **demi-cadratin** `–`, jamais le cadratin `—`. Il est
précédé d’une insécable pour qu’il ne commence pas une ligne.

**T2** – seules les plages de **pages** passent au demi-cadratin : c’est le `p.` ou le `pp.`
qui les rend reconnaissables. `2020-2021` et `COVID-19` gardent leur trait d’union.

### S – Signes

| Code | Vous écrivez | Vous obtenez |
|---|---|---|
| **S1** | `et ainsi de suite...` | et ainsi de suite… |
| **S2** | `la 2ème fois` | la 2e fois |

**S2** – la forme correcte est `1er`, `1re`, `2e`, `3e` ; `2ème` est fautif.

---

## Ce qui vous est signalé, mais jamais corrigé

Ces deux-là demandent votre jugement : la machine ne peut pas trancher à votre place. Ils
apparaissent dans **Contrôles** après la compilation.

| Code | Ce qui est signalé | Pourquoi vous seul pouvez décider |
|---|---|---|
| **C1** | un `ß` dans un article allemand | « Klauß » n’est pas « Klauss » : un nom propre et une citation gardent leur orthographe |
| **C2** | des guillemets droits `"` non appariés | rien ne dit lequel ouvre et lequel ferme |

---

## Ce à quoi la chaîne ne touche pas

- **Le contenu des `blocs de code`** et des passages entre accents graves. Un chemin, une
  clé, une commande n’ont pas de typographie.
- **Les libellés composés par la maquette** – le `« Figure 1 — Légende »`, le `« Source : »`
  d’un crédit. Ce sont des décisions de composition, pas des fautes de frappe.
- **Les séparateurs de milliers**, les dates et les identifiants. `2026-08-29`,
  `10.57161/r2026-03-01` et `12000` restent tels quels.

---

## Si quelque chose ne va pas

Le résultat se voit dans l’aperçu, à droite de l’éditeur : il passe par les mêmes règles
que le PDF. Si une correction vous paraît fausse, c’est un défaut du filtre et non de votre
texte – signalez-le, avec le code de la règle.

Les règles sont vérifiées à chaque relecture du programme :

```sh
python3 test/typo-articles.py    # les douze règles, sur du vrai pandoc
python3 test/typo-check.py       # les mêmes règles, sur l'interface du cockpit
```

Version allemande de cette note : [TYPOGRAPHIE-DE.md](TYPOGRAPHIE-DE.md).
