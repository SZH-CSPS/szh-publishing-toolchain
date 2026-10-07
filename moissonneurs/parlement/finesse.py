"""Finesse du tri (docs/FORMAT-PROPOSITIONS.md) : score 0-100 par bandes, catégorie, termes avec `note_sans`, crans par langue.

Le score ne dépend que de la bande (la catégorie du classement) et d'une modulation à l'intérieur de la bande : aucun
hasard, aucun recouvrement entre bandes. `note_calibree` n'est jamais écrit : la note n'est pas calibrée sur des jugements.
"""
import bisect
import contextlib
import copy
import dataclasses
import datetime
import json
import os
import re

from . import classement, correspondances as corr, lexique, reference
from .lexique import normaliser
from .stockage import avant_date_min

# --- Poids (tout ce qui règle le score est ici) --------------------------------------------------------------------
BANDES = {1: (80, 100), 2: (60, 79), 3: (40, 59), 4: (20, 39), 5: (5, 19), 6: (0, 4.99)}
JETONS = {1: 'titre', 2: 'texte-dense', 3: 'signal-faible', 4: 'ecole', 5: 'theme', 6: 'texte-large'}
# Modulation dans la bande : somme pondérée de composantes entre 0 et 1 (les poids de chaque bande font 1).
POIDS = {
    1: {'forts_titre': 0.30, 'occurrences': 0.25, 'densite': 0.15, 'titre_et_texte': 0.30},
    2: {'forts_texte': 0.30, 'occurrences': 0.40, 'densite': 0.30},
    3: {'ambigus_titre': 0.35, 'forts_extrait': 0.30, 'forts_texte': 0.20, 'occurrences': 0.15},
    4: {'termes_ecole': 0.50, 'texte_faible': 0.30, 'theme_aussi': 0.20},
    5: {'themes': 0.50, 'termes_theme': 0.50},
    6: {'forts_texte': 0.50, 'occurrences': 0.50},       # vivier élargi : sous le thème, jamais « retenu »
}
SATURATION = {'forts_titre': 3, 'forts_texte': 5, 'occurrences': 20, 'densite': 5.0, 'ambigus_titre': 2, 'forts_extrait': 3,
              'termes_ecole': 3, 'texte_faible': 4, 'theme_aussi': 3, 'themes': 3, 'termes_theme': 4}
# Crans : 10 par langue ; une langue sous 200 propositions sur 12 mois, ou à plus de 3 crans identiques, prend le commun.
NB_CRANS = 10
VERSION = 5      # version de la note : les crans figés d'une autre version sont recalculés (5 : pas de volume réguliers entre les crans)
PROFIL = 'lineaire'  # profil des volumes entre les crans 2 et 10 ([finesse] profil : lineaire | geometrique)
RAPPEL_STRICT = 20   # cible du cran 10 : au plus 20 fiches de référence ([finesse] rappel_strict)
MIN_PROPOSITIONS = 200
MAX_IDENTIQUES = 3
# ----------------------------------------------------------------------------------------------------------------------


def categorie_de(raison):
    """Numéro de catégorie (1 à 5) d'après la raison du classement."""
    r = raison or ''
    if r.startswith(classement.PREFIXE_VIVIER):
        return 6
    if r.startswith('ancrage dans le titre'):
        return 1
    if r.startswith('ancrage dans le texte'):
        return 2
    if r.startswith('école ordinaire'):
        return 4
    if r.startswith('thématique'):
        return 5
    return 3          # ancrage ambigu au titre, extrait de recherche


def _sat(nom, valeur):
    return min(valeur, SATURATION[nom]) / SATURATION[nom]


def composantes(cat, d, lex, titre):
    n_occ = d.get('occurrences_fortes', 0)
    dens = 1000.0 * n_occ / max(d.get('longueur_texte', 0), 1)
    forts_t, forts_x = d.get('titre_forts', []), d.get('texte_forts', [])
    if cat == 1:
        return {'forts_titre': _sat('forts_titre', len(forts_t)), 'occurrences': _sat('occurrences', n_occ),
                'densite': _sat('densite', dens), 'titre_et_texte': 1.0 if forts_t and forts_x else 0.0}
    if cat == 6:
        return {'forts_texte': _sat('forts_texte', len(forts_x)), 'occurrences': _sat('occurrences', n_occ)}
    if cat == 2:
        return {'forts_texte': _sat('forts_texte', len(forts_x)), 'occurrences': _sat('occurrences', n_occ),
                'densite': _sat('densite', dens)}
    if cat == 3:
        return {'ambigus_titre': _sat('ambigus_titre', len(d.get('titre_faibles', []))),
                'forts_extrait': _sat('forts_extrait', len(forts_x)) if d.get('extrait') else 0.0,
                'forts_texte': _sat('forts_texte', len(forts_x)) if not d.get('extrait') else 0.0,
                'occurrences': _sat('occurrences', n_occ)}
    if cat == 4:
        return {'termes_ecole': _sat('termes_ecole', len({t.terme.texte for t in lex.ecole_generale_dans(titre)})),
                'texte_faible': _sat('texte_faible', len(d.get('texte_faibles', []))),
                'theme_aussi': _sat('theme_aussi', len(lex.themes_dans(titre)))}
    th = d.get('themes', [])
    return {'themes': _sat('themes', len(th)), 'termes_theme': _sat('termes_theme', sum(len(t['termes']) for t in th))}


def score_de(cat, comp):
    bas, haut = BANDES[cat]
    m = sum(POIDS[cat][k] * comp.get(k, 0.0) for k in POIDS[cat])
    return round(bas + m * (haut - bas), 2)


def sans_terme(lex, terme):
    """Copie du lexique privée de `terme` (ancrages, école, thèmes), pour la note sans ce terme."""
    n = normaliser(terme)
    v = copy.copy(lex)
    v.termes = [t for t in lex.termes if normaliser(t.texte) != n]
    v.ecole_generale = [t for t in lex.ecole_generale if normaliser(t.texte) != n]
    v.themes = [dataclasses.replace(x, termes=[t for t in x.termes if normaliser(t.texte) != n]) for x in lex.themes]
    return v


def _classer(lex, a, texte, extrait, config):
    cl = config.get('classement', {})
    return classement.classer(lex, a, texte, candidat=True, extrait=extrait,
                              ecole_generale=bool(cl.get('ecole_generale', False)),
                              themes_elargis=bool(cl.get('themes_elargis', False)),
                              vivier_large=bool(cl.get('vivier_large', False)))


# Actif dans `une_seule_fois()` : {fonction: (lexique, réglages, arguments, résultat)} du dernier appel.
_dernier = None


@contextlib.contextmanager
def une_seule_fois():
    """Dans ce bloc, un classement ou un relevé de termes redemandé tel quel n'est pas recalculé : `finesse_de` et
    `evaluer` classent le même texte, avec le même lexique (comparé par identité : `sans_terme` en fait une copie)."""
    global _dernier
    ancien, _dernier = _dernier, {}
    try:
        yield
    finally:
        _dernier = ancien


def _une_fois(nom, lex, config, args, calcul):
    if _dernier is None:
        return calcul()
    vu = _dernier.get(nom)
    if vu is not None and vu[0] is lex and vu[1] is config and vu[2] == args:
        return vu[3]
    resultat = calcul()
    _dernier[nom] = (lex, config, args, resultat)
    return resultat


def _evaluer(lex, a, texte, extrait, config):
    """(Resultat, score, catégorie) ; score 0 et catégorie 0 si la proposition n'en est plus une."""
    return _une_fois('evaluer', lex, config, (a, texte, extrait), lambda: _evaluer_calcul(lex, a, texte, extrait, config))


def _evaluer_calcul(lex, a, texte, extrait, config):
    res = _classer(lex, a, texte, extrait, config)
    if res.verdict == 'ecarte':
        return res, 0.0, 0
    cat = categorie_de(res.raison)
    if cat == 5 and config.get('classement', {}).get('ecole_generale') and lex.ecole_generale_dans(a['title'])             and not lex.abaissements(a['title'] + ' ' + texte[:20000]):
        cat = 4      # plusieurs catégories : la plus haute bande ; le thème ne fait plus que moduler (le verdict ne change pas)
    d = dict(res.details, extrait=extrait)
    return res, score_de(cat, composantes(cat, d, lex, a['title'])), cat


def termes_de(lex, a, texte, extrait, cat):
    """[(terme, langue, role, ou)] de la proposition, un terme une seule fois à son emplacement le plus fort."""
    return _une_fois('termes', lex, None, (a, texte, extrait, cat), lambda: _termes_calcul(lex, a, texte, extrait, cat))


def _termes_calcul(lex, a, texte, extrait, cat):
    titre = a['title']
    trouves = {}
    ordre = {'titre': 0, 'texte': 1, 'extrait': 1}

    def ajouter(t, role, ou):
        cle = (t.texte, t.langue)
        if cle not in trouves or ordre[ou] < ordre[trouves[cle][2]]:
            trouves[cle] = (t.texte, t.langue, ou, role)

    if cat == 6:
        for x in lex.ancrages(texte):
            if not x.terme.titre_seul and not x.terme.ambigu:
                ajouter(x.terme, 'ancrage', 'texte')
    elif cat in (1, 2, 3):
        for x in lex.ancrages(titre):
            ajouter(x.terme, 'ambigu' if x.terme.ambigu else 'ancrage', 'titre')
        if texte:
            ou = 'extrait' if extrait else 'texte'
            for x in lex.ancrages(texte):
                if x.terme.titre_seul:
                    continue
                if extrait and normaliser(x.terme.texte) in lex.hors_extrait:
                    continue
                ajouter(x.terme, 'ambigu' if x.terme.ambigu else 'ancrage', ou)
    elif cat == 4:
        for x in lex.ecole_generale_dans(titre):
            ajouter(x.terme, 'ecole', 'titre')
        for _, touches in lex.themes_dans(titre):
            for x in touches:
                ajouter(x.terme, 'theme', 'titre')
    elif cat == 5:
        for _, touches in lex.themes_dans(titre):
            for x in touches:
                ajouter(x.terme, 'theme', 'titre')
    return [(t, lg, role, ou) for (t, lg), (_, _, ou, role) in sorted(trouves.items())]


def evaluer(lex, config, base, a):
    """Champs de finesse d'une proposition : {'score', 'categorie', 'termes'} ou None si le classement ne la garde plus.

    `a` : ligne `affaires` (dict). Entrée de classement identique à celle de `classer_base`."""
    entree, texte, extrait = classement.entree_de_base(base, a)
    res, score, cat = _evaluer(lex, entree, texte, extrait, config)
    if not cat:
        return None
    termes = []
    for t, lg, role, ou in termes_de(lex, entree, texte, extrait, cat):
        _, s, _ = _evaluer(sans_terme(lex, t), entree, texte, extrait, config)
        termes.append({'terme': t, 'langue': lg, 'role': role, 'ou': ou, 'note_sans': s})
    ordre = {'titre': 0, 'texte': 1, 'extrait': 2}
    termes.sort(key=lambda t: (ordre[t['ou']], t['note_sans'], t['terme']))      # le plus décisif en premier
    return {'score': score, 'categorie': JETONS[cat], 'termes': termes}


# -- langues, fenêtre, crans -------------------------------------------------------------------------------------------

def langues_de(config, base, a, brut):
    """Langues des vues où la proposition apparaît : fr ET de pour une affaire multilingue, sinon une seule (TI : fr)."""
    t = (brut or {}).get('title')
    if corr.titres_multilingues(a['body_key'], t):
        return ('fr', 'de')
    docs = base.c.execute('SELECT langue FROM documents WHERE body_key=? AND id_api=? ORDER BY doc_id',
                          (a['body_key'], a['id_api'])).fetchall()
    titre = re.sub(r'\s+', ' ', a['title'] or '').strip()
    langue = corr.langue_proposition(a['body_key'], corr.canton_de(a['body_key'], config), t if t else titre,
                                     docs[0]['langue'] if docs else '')[0]
    return (langue or 'de',)


def fenetre(aujourdhui):
    """(du, au) : les 12 derniers mois complets avant `aujourdhui` (date ISO), du premier jour au dernier."""
    j = datetime.date.fromisoformat(aujourdhui[:10])
    fin = j.replace(day=1) - datetime.timedelta(days=1)
    a, m = fin.year, fin.month
    for _ in range(11):
        m -= 1
        if m == 0:
            a, m = a - 1, 12
    return datetime.date(a, m, 1).isoformat(), fin.isoformat()


def trimestre(jour):
    return f"{jour[:4]}-T{(int(jour[5:7]) - 1) // 3 + 1}"


def _echelle(normales, vivier, t10, profil=None):
    """Seuils des 10 crans. Cran 1 = 0 ; cran 2 = le plus bas score du réglage normal (avec vivier élargi ; sinon la 2e valeur) ;
    cran 10 = `t10` ; crans 3 à 9 : on vise des pas de VOLUME réguliers entre le volume du cran 2 et celui du cran 10 (profil
    `lineaire` : pas égaux ; `geometrique` : rapport constant), puis chaque cible est ramenée à la valeur DISTINCTE de score
    dont le volume est le plus proche ; en cas de collision avec le cran précédent, on avance à la valeur distincte suivante.
    Chaque seuil est un score existant et strictement plus haut que le précédent : chaque cran change l'ensemble visible."""
    profil = profil or PROFIL
    d = sorted(set(normales))
    if not d:
        return {k: 0 for k in range(1, NB_CRANS + 1)}
    tri = sorted(normales)
    n = len(tri)
    volume = [n - bisect.bisect_left(tri, v) for v in d]            # objets visibles pour chaque seuil distinct (décroissant)
    i2 = 0 if vivier else min(1, len(d) - 1)
    i10 = max(next((i for i, v in enumerate(d) if v >= t10), len(d) - 1) if t10 is not None else len(d) - 1, i2)
    v2, v10 = volume[i2], volume[i10]
    sortie = {1: 0, 2: d[i2], 10: d[i10]}
    prec = i2
    for k in range(3, NB_CRANS):
        t = (k - 2) / (NB_CRANS - 2)
        cible = (v2 * (v10 / v2) ** t) if (profil == 'geometrique' and v2 > 0 and v10 > 0) else v2 + (v10 - v2) * t
        # indice le plus proche dans (prec, i10) ; les volumes décroissent avec l'indice
        reste = list(range(prec + 1, i10))
        if not reste:
            idx = min(prec + 1, i10)
        else:
            idx = min(reste, key=lambda i: (abs(volume[i] - cible), i))
        sortie[k] = d[idx]
        prec = idx
    return dict(sorted(sortie.items()))


def seuil_strict(normales, refs_scores, cible):
    """Cran 10 : le plus bas score du réglage normal qui laisse au plus `cible` fiches de référence (None : trop peu de fiches)."""
    scores = sorted((r for r in refs_scores if r is not None), reverse=True)
    d = sorted(set(normales))
    if len(scores) <= cible or not d:
        return None
    limite = scores[cible]             # la (cible+1)-ième fiche : le seuil doit être strictement au-dessus
    return next((v for v in d if v > limite), d[-1])


def _deciles(scores):
    s = sorted(scores)
    n = len(s)
    return {k: (0 if k == 1 else (s[min(int((k - 1) / NB_CRANS * n), n - 1)] if n else 0)) for k in range(1, NB_CRANS + 1)}


def _egalites(scores, seuil):
    """Ex aequo qui restent à ce cran : objets pile au seuil, groupes d'égalité parmi les visibles, plus grand groupe."""
    visibles = [s for s in scores if s >= seuil]
    comptes = {}
    for s in visibles:
        comptes[s] = comptes.get(s, 0) + 1
    groupes = [n for n in comptes.values() if n > 1]
    return {'objets': sum(1 for s in scores if s == seuil), 'groupes': len(groupes), 'plus_grand': max(groupes, default=0)}


def table_crans(scores, seuils, refs_scores, nb_mois=12):
    """10 entrées de cran. `refs_scores` : score de chaque fiche de référence de la langue (None : non retrouvée)."""
    sortie, prec = [], None
    for k in range(1, NB_CRANS + 1):
        t = seuils[k]
        n = sum(1 for s in scores if s >= t)
        sortie.append({'cran': k, 'seuil': round(t, 2), 'par_mois': round(n / nb_mois, 1),
                       'rappel': sum(1 for r in refs_scores if r is not None and r >= t), 'rappel_sur': len(refs_scores),
                       'identique_au_cran_precedent': prec == n, 'egalites': _egalites(scores, t)})
        prec = n
    return sortie


def calculer_crans(population, refs, aujourdhui, rappel_strict=RAPPEL_STRICT, profil=None):
    """Crans par langue et leur source. `population` : [(score, langues, mois AAAA-MM, vivier)] des propositions (retenu ou
    à relire). `refs` : [(langue de la fiche, score ou None)]. Rend (crans, crans_source, cran_defaut).

    Cran 10 : le plus bas score du réglage normal qui laisse au plus `rappel_strict` fiches de référence de la langue
    (`[finesse] rappel_strict`). Une langue sans assez de fiches (fr) prend le seuil de de, ramené à sa plus proche valeur
    de score. Le commun sert de repli (moins de 200 propositions normales, ou plus de 3 crans identiques)."""
    du, au = fenetre(aujourdhui)
    fen = [(p[0], p[1], bool(p[3]) if len(p) > 3 else False) for p in population if du[:7] <= p[2] <= au[:7]]
    vivier = any(large for _, _, large in fen)
    # Réglage normal = tout sauf le vivier élargi (texte-large) : c'est lui qui donne les seuils et le cran par défaut.
    normales_communes = [s for s, _, large in fen if not large]
    t10_commun = seuil_strict(normales_communes, [sc for _, sc in refs], rappel_strict)
    seuils_communs = _echelle(normales_communes, vivier, t10_commun, profil)
    crans, source, t10_de = {}, {}, None
    for lg in ('de', 'fr'):
        propre = [(s, large) for s, langues, large in fen if lg in langues]
        normales = [s for s, large in propre if not large]
        tous = [s for s, _ in propre]
        refs_lg = [sc for l, sc in refs if l == lg]
        t10 = seuil_strict(normales, refs_lg, rappel_strict)
        if t10 is None:
            t10 = t10_de                                  # repli : le seuil de de (nearest ≥ dans `_echelle`)
        else:
            t10_de = t10 if t10_de is None else t10_de
        seuils = _echelle(normales, vivier, t10, profil)
        table = table_crans(tous, seuils, refs_lg)
        identiques = sum(1 for e in table if e['identique_au_cran_precedent'])
        if len(normales) < MIN_PROPOSITIONS or identiques > MAX_IDENTIQUES:
            table = table_crans(tous, seuils_communs, refs_lg)
            source[lg] = 'commun'
        else:
            source[lg] = 'langue'
        crans[lg] = table
    return {lg: crans[lg] for lg in ('fr', 'de')}, {lg: source[lg] for lg in ('fr', 'de')}, (2 if vivier else 1)


def crans_figes(chemin, calcul, aujourdhui):
    """Crans figés par trimestre : relus dans `chemin` s'ils datent du même trimestre, sinon recalculés (`calcul()`) et écrits."""
    if chemin and os.path.exists(chemin):
        try:
            with open(chemin, encoding='utf-8') as f:
                gele = json.load(f)
            if gele.get('version') == VERSION and trimestre(gele['crans_calcules_le']) == trimestre(aujourdhui):
                return gele
        except (ValueError, KeyError, OSError):
            pass
    resultat = calcul()
    crans, source = resultat[0], resultat[1]
    du, au = fenetre(aujourdhui)
    nouveau = {'version': VERSION, 'crans': crans, 'crans_source': source, 'crans_calcules_le': aujourdhui[:10], 'crans_fenetre': {'du': du, 'au': au}}
    if len(resultat) > 2 and resultat[2] != 1:
        nouveau['cran_defaut'] = resultat[2]       # sans vivier élargi : omis (le cran 1 est le réglage normal)
    if chemin:
        os.makedirs(os.path.dirname(chemin) or '.', exist_ok=True)
        tmp = chemin + '.tmp'
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(nouveau, f, ensure_ascii=False, indent=1)
        os.replace(tmp, chemin)
    return nouveau


def termes_etat(objets, refs_termes):
    """`etat.termes` : [{terme, langue, role, ref, ref_seul}] de tous les termes des propositions, avec leurs fiches de référence.

    `objets` : [[(terme, langue, role)]] par proposition ; `refs_termes` : [[(terme, langue, role)]] par fiche retrouvée."""
    clefs = {c for termes in objets for c in termes}
    ref, seul = {}, {}
    for termes in refs_termes:
        for c in set(termes):
            ref[c] = ref.get(c, 0) + 1
            if len({t[:2] for t in termes}) == 1:
                seul[c] = seul.get(c, 0) + 1
    return [{'terme': t, 'langue': lg, 'role': role, 'ref': ref.get(c, 0), 'ref_seul': seul.get(c, 0)}
            for c in sorted(clefs) for t, lg, role in [c]]


def finesse_de(config, base, lex, a):
    """{score, langues, mois, vivier, termes} d'une ligne `affaires` retenue ou à relire, ou None si le classement ne la
    garde plus. Ce que les crans et `etat.termes` lisent d'elle ; le poste de développement le fige pour le partage."""
    entree, texte, extrait = classement.entree_de_base(base, a)
    res, score, cat = _evaluer(lex, entree, texte, extrait, config)
    if not cat:
        return None
    brut = base.brut(f"affaire:{a['body_key']}:{a['external_id']}", a['empreinte']) or {}
    mois = (a['date_depot'] or '')[:7]
    return {'score': score, 'langues': list(langues_de(config, base, a, brut)),
            'mois': mois if len(mois) == 7 else '0000-00', 'vivier': cat == 6,
            'termes': [[t, lg, role] for t, lg, role, _ in termes_de(lex, entree, texte, extrait, cat)]}


def collecter(config, base, lex):
    """(population, objets, refs_scores, refs_termes, nb de fiches) : tout ce qu'il faut pour les crans et `etat.termes`.

    Une affaire figée (table `finesse`) est lue telle que le poste de développement l'a calculée ; les fiches de
    référence déjà appariées là-bas (`refs` figé) gardent leur affaire."""
    mini = config['criblage'].get('date_min_fiche', '')
    par_cle = {}
    for r in base.c.execute("""SELECT a.*, v.verdict FROM verdicts v JOIN affaires a ON a.body_key=v.body_key
                               AND a.external_id=v.external_id WHERE v.verdict IN ('retenu','a-relire')"""):
        a = dict(r)
        if avant_date_min(a['date_depot'], mini):
            continue
        f = base.donnees_figees('finesse', a['body_key'], a['external_id'])
        if f is None:
            f = finesse_de(config, base, lex, a)
        if f is not None:
            par_cle[(a['body_key'], a['external_id'])] = f
    for r in base.c.execute('SELECT body_key, external_id, donnees FROM finesse'):
        par_cle.setdefault((r['body_key'], r['external_id']), json.loads(r['donnees']))
    population = [(f['score'], tuple(f['langues']), f['mois'], f['vivier']) for f in par_cle.values()]
    objets = [[tuple(t) for t in f['termes']] for f in par_cle.values()]
    refs = reference.lire_reference(config['bibliotheque']['fiches'])
    figees = base.fige('refs') or {}
    appar = reference.apparier(refs, base, config)
    refs_scores, refs_termes = [], []
    for ref, a, _ in appar:
        cle_ref = f"{ref['slug']}|{ref['langue']}"
        cle = tuple(figees[cle_ref]) if figees.get(cle_ref) else ((a['body_key'], a['external_id']) if a else None)
        got = par_cle.get(cle) if cle else None
        refs_scores.append((ref['langue'], got['score'] if got else None))
        if got:
            refs_termes.append([tuple(t) for t in got['termes']])
    return population, objets, refs_scores, refs_termes, len(refs)


def etat(config, base, lex, aujourdhui, chemin_figes=None, figes=None):
    """Bloc `etat.json` de la finesse : crans, crans_source, crans_calcules_le, crans_fenetre, termes, rappel_sur.

    `figes` : crans publiés par le poste de développement, repris tels quels (une passe mensuelle ne recalibre pas)."""
    population, objets, refs_scores, refs_termes, nb_refs = collecter(config, base, lex)
    cfg = config.get('finesse', {})

    def calcul():
        return calculer_crans(population, refs_scores, aujourdhui, int(cfg.get('rappel_strict', RAPPEL_STRICT)),
                              cfg.get('profil', PROFIL))
    gele = figes if figes is not None else crans_figes(chemin_figes, calcul, aujourdhui)
    gele = {k: v for k, v in gele.items() if k != 'version'}
    return {**gele, 'termes': termes_etat(objets, refs_termes), 'rappel_sur': nb_refs}
