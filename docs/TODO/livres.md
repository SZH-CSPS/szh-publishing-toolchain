# Livres — ce qui reste

Restes du chantier livres, réduits au nettoyage du 01.10.2026 aux points encore ouverts ;
pour la conception, lire [ARCHITECTURE-LIVRES.md](../ARCHITECTURE-LIVRES.md), qui reste la
référence. Quand une tâche est terminée et constatée, la supprimer d’ici.

---

### 2.4 Livres à produire

- Le **deuxième livre FALC**, l'allemand, dans
  `C:\Users\robin\OneDrive - SZH CSPS\Revues-TESTING\Books`, par le
  lanceur et l'interface, pas à la main. (Chemin mis à jour le 15.09.2026 : les livres
  vivent désormais dans notre propre arbre, `docs/EMPLACEMENTS.md` §1.)

- **Hagmann-von Arx, « Diagnostische Reisen »**, depuis l'export docx Adobe rangé dans
  `tmp/book/BU01_Auflagen finale/Buecher_2025/2025-B330-Hagmann-von Arx/Ebook`. La
  couverture ne sera pas juste, c'est attendu ; le reste doit l'être, et se vérifie contre
  le PDF d'origine.

⚠ Le nom du dossier d'un livre **ne doit pas contenir d'espace** : les fonctions de chemin
de make découpent sur les blancs. Un garde-fou refuse déjà le cas, mais il faut le savoir
en nommant.

### 2.5 Défauts connus, non corrigés

- **`--fond-perdu` n'est pas branché.** Dans `pipeline/styles/livre/imprimeur.css`, c'est
  une valeur par défaut figée ; elle devrait venir de `impression.fond-perdu-mm` de
  `buch.yaml`.

**Piste non prise.** Convertir les `.emf` automatiquement à l’import demanderait un moteur EMF
dans le rootfs — or aucun paquet Linux ne rend correctement l’EMF+ (GDI+), et seul Windows
le sait. La conversion resterait donc à faire côté cockpit, en PowerShell. Non fait : cela
change le geste de compilation pour tout le monde, et c’est un arbitrage à poser à Robin.

### 2.6 CMJN

⚠ **À reconfirmer auprès de l'imprimerie**, comme `docs/ARCHITECTURE-LIVRES.md` (§4.3) le
rappelle : « le profil ICC est une décision d'imprimeur, pas de logiciel ». FOGRA52 est le
standard actuel du non couché (ISO 12647-2:2013, encrage maximal 300 %) ; si l'imprimeur en
demande un autre, seules les lignes `ARG` du Containerfile changent. Et rien ne presse : le
PDF imprimeur sort aujourd'hui en RVB avec fond perdu et traits de coupe, ce que beaucoup
d'imprimeries acceptent — et qui vaut mieux qu'un CMJN faux.

---

## 3. Comment vérifier

```
node --test "test/js/*.test.js"      # depuis la racine du dépôt
test/build-render.sh                 # banc complet : compile les livres, exige PDF/UA-1
python3 test/typo-check.py           # typographie des textes visibles
python3 test/apca-check.py           # contrastes de la palette
```

Deux pièges qui ont déjà coûté du temps :

- **Le toolkit déployé n'est pas le dépôt.** Il vit dans `C:\ProgramData\SZH\toolkit`. Une
  correction de la chaîne ou d'un filtre n'a aucun effet sur un vrai livre tant qu'elle
  n'est pas redéployée, et un fichier périmé y survit à sa suppression du dépôt.

  ⚠ **Ce piège s'est refermé le 31.08, et il a coûté une fausse alerte.** Le toolkit était
  resté en `2026.08.63` quand le dépôt était en `v2026.08.66` — dix commits de retard. Il lui
  manquait `szh-sauts-uniques.lua` et `szh-attributs-sains.lua`, et sa `styles/livre/falc.css`
  était celle d'avant l'alignement : **tout le travail de maquette FALC du 30.08 n'avait
  jamais atteint la production**, et le livre B329 se recompilait à 62 pages au lieu de 47.
  Les tags `.64`, `.65` et `.66` étaient pourtant bien poussés : c'est la mise à jour du poste
  qui n'avait pas été lancée. Corrigé le 31.08 par
  `powershell.exe -ExecutionPolicy Bypass -File windows\update.ps1` (PowerShell **5.1**, pour
  lequel le script est écrit). **Avant de mesurer quoi que ce soit sur un vrai livre, vérifier
  `cat C:\ProgramData\SZH\toolkit\VERSION` contre `git describe --tags`.**

- **Lire le verdict veraPDF sur l'ABSENCE de `FAIL`**, jamais sur la présence de `PASS` :
  un PDF sans arbre de structure ne produit ni l'un ni l'autre, et passerait pour conforme.
