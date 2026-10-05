"""Événements pronto-moisson/1 : construction, validation, et traduction des lignes propres à chaque moissonneur.

Le contrat est décrit dans LISEZMOI.md ; le cockpit et console.py n'en lisent pas d'autre.
"""
import json
import math
import os
import re
import time

FORMAT = 'pronto-moisson/1'
MOISSONNEURS = ('parlement', 'recherche')
# Qui lance une passe (`--declencheur`) ; un import de l'export FNS se déclare `import-fns`.
APPELANTS = ('cockpit', 'raccourci', 'cli')
DECLENCHEURS = APPELANTS + ('import-fns',)
INTERROMPUS = ('budget', '403', 'arret')
ETATS_CRENEAU = ('pris', 'refuse', 'repris-perime', 'retire')
RAISONS_REFUS = ('deja-en-cours', 'budget-epuise', 'etat-absent', 'racine-absente', 'config-invalide',
                 'fichier-invalide')
CODES_MOISSONNEUR = (0, 1, 2, 3)
CODES_PASSE = (0, 1, 2, 3, 4, 5)
# Du moins grave au plus grave ; 4 ne vient que du créneau, avant toute passe.
GRAVITE = (0, 1, 3, 2, 5)
CITATION = 200


def _evt(type_, **champs):
    return {'format': FORMAT, 'type': type_, **champs}


def creneau(etat, poste, compte, debut):
    return _evt('creneau', etat=etat, poste=poste, compte=compte, debut=debut)


def debut(moissonneurs, estimation, declencheur, heure, budget_mois, racine_test):
    return _evt('debut', moissonneurs=list(moissonneurs), estimation=estimation, declencheur=declencheur,
                heure=heure, budget_mois=budget_mois, racine_test=bool(racine_test))


def etape(moissonneur, etape, requetes, budget, reste_s, fraction):
    return _evt('etape', moissonneur=moissonneur, etape=etape, requetes=requetes, budget=budget, reste_s=reste_s,
                fraction=fraction)


def attente(moissonneur, etape, secondes, motif, hote):
    return _evt('attente', moissonneur=moissonneur, etape=etape, secondes=secondes, motif=motif, hote=hote)


def avertissement(moissonneur, message):
    return _evt('avertissement', moissonneur=moissonneur, message=message)


def lot(moissonneur, chemin, propositions):
    return _evt('lot', moissonneur=moissonneur, chemin=chemin, propositions=propositions)


def moissonneur_fin(moissonneur, code, interrompu, sources_en_echec, purge, sources_desactivees=(),
                    plantage=False):
    return _evt('moissonneur_fin', moissonneur=moissonneur, code=code, interrompu=interrompu,
                sources_en_echec=list(sources_en_echec), purge=purge,
                sources_desactivees=list(sources_desactivees), plantage=bool(plantage))


def fin(code, duree_s):
    return _evt('fin', code=code, duree_s=duree_s)


def refus(raison, detail):
    return _evt('refus', raison=raison, detail=detail)


def plus_grave(codes):
    return max(codes, key=GRAVITE.index, default=0)


def code_de_passe(fin_moissonneur):
    """Ce qu'un `moissonneur_fin` pèse dans le code de la passe : un plantage vaut 5."""
    return 5 if fin_moissonneur['plantage'] else fin_moissonneur['code']


def citer(texte, n=CITATION):
    texte = ' '.join(str(texte).split())
    return texte if len(texte) <= n else texte[:n] + '…'


# --------------------------------------------------------------------------- validation

def _entier(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _nombre(v):
    return (isinstance(v, (int, float)) and not isinstance(v, bool)) and math.isfinite(v)


ISO = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')


def _v_texte(v):
    return isinstance(v, str) and v != ''


def _v_texte_nul(v):
    return v is None or isinstance(v, str)


def _v_positif(v):
    return _entier(v) and v >= 0


def _v_positif_nul(v):
    return v is None or _v_positif(v)


def _v_fraction(v):
    return v is None or (_nombre(v) and 0 <= v <= 1)


def _v_iso(v):
    return isinstance(v, str) and bool(ISO.match(v))


def _v_dans(valeurs):
    return lambda v: v in valeurs


def _v_objet(schema):
    def v(o):
        return isinstance(o, dict) and set(o) == set(schema) and all(f(o[k]) for k, f in schema.items())
    return v


def _v_table(schema):
    return lambda o: isinstance(o, dict) and all(isinstance(k, str) and _v_objet(schema)(x) for k, x in o.items())


def _v_liste(f):
    return lambda o: isinstance(o, list) and all(f(x) for x in o)


def _v_chemin_relatif(v):
    return (_v_texte(v) and not v.startswith(('/', '\\')) and not re.match(r'^[A-Za-z]:', v)
            and '..' not in re.split(r'[\\/]', v))


_ESTIMATION = {'requetes': _v_positif_nul, 'delai_s': lambda v: v is None or (_nombre(v) and v >= 0),
               'budget': _v_positif_nul}
_BUDGET_MOIS = {'budget': _v_positif_nul, 'marge': _v_positif, 'somme': _v_positif, 'plafond': _v_positif_nul}
_ECHEC = {'source': _v_texte, 'raison': _v_texte_nul}

TYPES = {
    'creneau': {'etat': _v_dans(ETATS_CRENEAU), 'poste': _v_texte, 'compte': _v_texte, 'debut': _v_iso},
    'debut': {'moissonneurs': _v_liste(_v_texte), 'estimation': _v_table(_ESTIMATION),
              'declencheur': _v_dans(DECLENCHEURS), 'heure': _v_iso, 'budget_mois': _v_table(_BUDGET_MOIS),
              'racine_test': lambda v: isinstance(v, bool)},
    'etape': {'moissonneur': _v_texte, 'etape': _v_texte, 'requetes': _v_positif, 'budget': _v_positif_nul,
              'reste_s': _v_positif_nul, 'fraction': _v_fraction},
    'attente': {'moissonneur': _v_texte, 'etape': _v_texte, 'secondes': _v_positif, 'motif': _v_texte_nul,
                'hote': _v_texte_nul},
    'avertissement': {'moissonneur': _v_texte_nul, 'message': _v_texte},
    'lot': {'moissonneur': _v_texte, 'chemin': _v_chemin_relatif, 'propositions': _v_positif},
    'moissonneur_fin': {'moissonneur': _v_texte, 'code': _v_dans(CODES_MOISSONNEUR),
                        'interrompu': lambda v: v is None or v in INTERROMPUS,
                        'sources_en_echec': _v_liste(_v_objet(_ECHEC)),
                        'purge': _v_objet({'lots': _v_positif, 'decisions': _v_positif}),
                        'sources_desactivees': _v_liste(_v_texte), 'plantage': lambda v: isinstance(v, bool)},
    'fin': {'code': _v_dans(CODES_PASSE), 'duree_s': lambda v: _nombre(v) and v >= 0},
    'refus': {'raison': _v_dans(RAISONS_REFUS), 'detail': _v_texte},
}


def valider(evt):
    """Liste des écarts au contrat (vide si l'événement est conforme)."""
    if not isinstance(evt, dict):
        return ['pas un objet JSON']
    ecarts = []
    if evt.get('format') != FORMAT:
        ecarts.append(f'format attendu {FORMAT}')
    schema = TYPES.get(evt.get('type'))
    if schema is None:
        return ecarts + [f"type inconnu : {evt.get('type')!r}"]
    for champ, f in schema.items():
        if champ not in evt:
            ecarts.append(f'champ manquant : {champ}')
        elif not f(evt[champ]):
            ecarts.append(f'valeur hors contrat : {champ} = {evt[champ]!r}')
    for champ in set(evt) - set(schema) - {'format', 'type'}:
        ecarts.append(f'champ hors contrat : {champ}')
    return ecarts


# --------------------------------------------------------------------------- traduction

def estimation_de(ligne):
    """{requetes, delai_s, budget} tiré de la ligne `estimer` ; `requetes_prevues` est le nom réel des deux."""
    vide = {'requetes': None, 'delai_s': None, 'budget': None}
    if not isinstance(ligne, dict):
        return vide
    req = ligne.get('requetes')
    if not _v_positif(req):
        req = ligne.get('requetes_prevues')
    budget = ligne.get('budget')
    delai = ligne.get('delai_s')
    return {'requetes': req if _v_positif(req) else None,
            'delai_s': delai if _nombre(delai) and delai >= 0 else None,
            'budget': budget if _v_positif(budget) and budget > 0 else None}


def avertissements_estimation(ligne):
    if not isinstance(ligne, dict) or not isinstance(ligne.get('avertissements'), list):
        return []
    return [citer(a) for a in ligne['avertissements'] if str(a).strip()]


# Par moissonneur : l'étape réelle d'une ligne `progression` → le champ qui en nomme le libellé
# (None : l'étape elle-même) ; et les autres types de ligne reconnus.
TABLES = {
    'recherche': {
        'progression': {'moisson': 'source', 'propositions': None, 'purge': None},
        'autres': {'attente': 'attente', 'avertissement': 'avertissement'},
        # La recherche annonce elle-même un 403, avec le nom lisible de la source : l'échec n'est que noté.
        'avertit_403': True,
    },
    'parlement': {
        'progression': {'restauration': None, 'import-affaires': None, 'import-documents': 'corps', 'import': None,
                        'mensuelle': None, 'moisson': 'corps', 'recherche': 'source', 'criblage': None, 'titres': None,
                        'textes': None,
                        'classement': None, 'liste': None, 'propositions': None, 'controle-noms': None,
                        'finesse': None, 'purge': None, 'sauvegarde': None},
        # Sorties des sous-commandes `compteur`, `mensuelle` et `importer` : une étape nommée par le type.
        'autres': {'compteur': 'etape', 'mensuelle': 'etape', 'import': 'etape'},
    },
}
GENRE = {'source': 'source', 'corps': 'corps'}
STATUTS_SANS_ALERTE = ('ok', 'budget', 'plafond', 'arret')


def lisible(code):
    """`site:phbern` → `phbern` : le moissonneur appelle les sites un par un."""
    return code[5:] if code.startswith('site:') else code


def _compte(v):
    if isinstance(v, list):
        return len(v)
    return v if _v_positif(v) else 0


class Traducteur:
    """Traduit le flux d'un moissonneur en événements pronto-moisson/1, et calcule le temps restant.

    `estimation` porte `budget` = le plafond de cette passe ; le temps restant part du délai de politesse, puis suit
    la vitesse mesurée dès trois requêtes, arrêtée à la dernière requête comptée : une étape hors ligne ne la
    fausse pas."""

    def __init__(self, moissonneur, estimation, horloge=time.monotonic, a_blanc=False):
        self.m = moissonneur
        est = estimation or {}
        self.prevues, self.delai, self.budget = est.get('requetes'), est.get('delai_s'), est.get('budget')
        self.horloge = horloge
        self.t0 = self.t_mesure = horloge()
        self.a_blanc = a_blanc
        self.requetes = 0
        self.resume = None
        self.echecs = []
        self.table = TABLES.get(moissonneur, {'progression': {}, 'autres': {}})

    def _avert(self, message):
        return avertissement(self.m, message)

    def _inconnue(self, texte):
        return [self._avert(f'ligne non reconnue · {citer(texte)}')]

    def ligne(self, texte):
        texte = texte.strip()
        if not texte:
            return []
        try:
            obj = json.loads(texte)
        except ValueError:
            return self._inconnue(texte)
        if not isinstance(obj, dict):
            return self._inconnue(texte)
        t = obj.get('type')
        if t == 'progression' and obj.get('etape') in self.table['progression']:
            return self._progression(obj)
        if t == 'resume':
            return self._resume(obj)
        if self.table['autres'].get(t) == 'attente' and _v_positif(obj.get('secondes')):
            return [attente(self.m, lisible(str(obj.get('source') or 'attente')), obj['secondes'],
                            obj.get('motif') if isinstance(obj.get('motif'), str) else None,
                            obj.get('hote') if isinstance(obj.get('hote'), str) else None)]
        if self.table['autres'].get(t) == 'avertissement' and isinstance(obj.get('message'), str) and obj['message']:
            return [self._avert(citer(obj['message']))]
        if self.table['autres'].get(t) == 'etape':
            self._compter(obj)
            return [self._etape(t)]
        return self._inconnue(texte)

    def _compter(self, obj):
        if _v_positif(obj.get('requetes')) and obj['requetes'] != self.requetes:
            self.requetes, self.t_mesure = obj['requetes'], self.horloge()
        if _v_positif(obj.get('budget')) and obj['budget'] > 0:
            self.budget = obj['budget']

    def _progression(self, obj):
        nom = obj['etape']
        self._compter(obj)
        champ = self.table['progression'][nom]
        if champ and isinstance(obj.get(champ), str) and obj[champ]:
            libelle = lisible(obj[champ])
        else:
            champ, libelle = None, nom
        if isinstance(obj.get('detail'), str):
            return [self._avert(f'{libelle} · {citer(obj["detail"])}')]
        statut = obj.get('statut', 'ok')
        raison = citer(obj.get('raison') or '') or 'raison inconnue'
        if statut == 'echec':
            if champ == 'source':
                self.echecs.append({'source': libelle, 'raison': raison})
                if raison == '403':
                    if self.table.get('avertit_403'):
                        return []
                    return [self._avert(f'{libelle} a refusé l’accès (403)')]
            quoi = f'{GENRE[champ]} {libelle}' if champ else f'étape {libelle}'
            return [self._avert(f'{quoi} en échec ({raison})')]
        sortie = [self._etape(libelle)]
        if statut not in STATUTS_SANS_ALERTE:
            sortie.append(self._avert(f'{libelle} · {statut} ({raison})'))
        return sortie

    def _resume(self, obj):
        self.resume = obj
        self._compter(obj)
        sortie = []
        if obj.get('interrompu') == 'configuration' or obj.get('erreur'):
            sortie.append(self._avert(f"configuration invalide · {citer(obj.get('erreur') or 'sans détail')}"))
        nom = os.path.basename(str(obj.get('lot') or '').replace('\\', '/'))
        n = _compte(obj.get('propositions_ecrites'))
        if nom and self.a_blanc:
            sortie.append(self._avert(f'à blanc · aurait déposé {self.m}/{nom}, {n} propositions'))
        elif nom:
            sortie.append(lot(self.m, f'{self.m}/{nom}', n))
        return sortie

    def _reste(self):
        e, b, r = self.prevues, self.budget, self.requetes
        cible = None if e is None else (e if b is None else min(e, b))
        if cible is None or r > cible:
            cible = b if (b is not None and r <= b) else None
        if not cible:
            return None, None
        fraction = min(r / cible, 1.0)
        ecoule = self.t_mesure - self.t0
        if r >= 3 and ecoule > 0:
            par_requete = ecoule / r
        elif self.delai is not None:
            par_requete = self.delai
        else:
            return None, fraction
        return math.ceil((cible - r) * par_requete), fraction

    def _etape(self, libelle):
        reste, fraction = self._reste()
        return etape(self.m, libelle, self.requetes, self.budget, reste, fraction)

    def terminer(self, code, force_arret=False):
        """Le `moissonneur_fin`, d'après le résumé s'il est venu et le code de sortie de l'enfant."""
        r = self.resume or {}
        if force_arret:
            code, interrompu = 3, 'arret'
        else:
            code = code if code in CODES_MOISSONNEUR else 1
            interrompu = r.get('interrompu') if r.get('interrompu') in INTERROMPUS else None
        echecs = r.get('sources_en_echec') if isinstance(r.get('sources_en_echec'), list) else self.echecs
        echecs = [{'source': lisible(str(e.get('source') or e.get('corps') or '?')),
                   'raison': None if e.get('raison') is None else citer(e['raison'])}
                  for e in echecs if isinstance(e, dict)]
        purge = r.get('purge') if isinstance(r.get('purge'), dict) else {}
        desactivees = r.get('sources_desactivees') if isinstance(r.get('sources_desactivees'), list) else []
        desactivees = [d.get('source') if isinstance(d, dict) else d for d in desactivees]
        return [moissonneur_fin(self.m, code, interrompu, echecs,
                                {'lots': _compte(purge.get('lots')), 'decisions': _compte(purge.get('decisions'))},
                                [lisible(str(s)) for s in desactivees if s],
                                plantage=(code == 1 and self.resume is None and not force_arret))]
