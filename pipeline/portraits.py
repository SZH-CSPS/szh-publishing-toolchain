#!/usr/bin/env python3
# portraits.py — traite les photos d'autrices et d'auteurs.
#
#   /opt/portraits/bin/python portraits.py <dossier_sortie> [<slug> <image-source>]...
#
# Pour chaque paire <slug> <image-source>, écrit dans <dossier_sortie> deux PNG de
# 400 x 400 en niveaux de gris (mode PIL 'LA') : <slug>.avec-fond.png et
# <slug>.sans-fond.png, dont le fond est supprimé. La photo déposée est écrite par le
# cockpit, pas ici : ce script ne fait que lire l'image source qu'on lui passe.
#
# Sortie : une ligne JSON par image sur stdout, dans l'ordre des arguments —
#   {"slug": ..., "ok": bool, "visage": bool, "recadre": bool,
#    "fichiers": {"avec_fond": ..., "sans_fond": ...} | null, "erreur": null | str}
# "recadre" : le cadre visé ne tenait pas dans la photo et a été réduit.
# Code retour : 0 si toutes les images passent, 1 si au moins un échec, 2 si l'invocation
# est malformée. Les messages de progression vont sur stderr, stdout restant du JSON pur.
#
# Chaîne de traitement : Pillow (ouverture et rotation EXIF), détection de visage OpenCV
# YuNet, cadre de sortie carré (hauteur du visage ~ FACE_PERCENT % du côté, visage centré
# horizontalement et un peu au-dessus du centre vertical), rembg (u2net_human_seg, session
# unique), puis LANCZOS 400 x 400, convert('LA') et écriture atomique.
# Si le cadre déborde de la photo source — un portrait cadré serré n'a pas de place sous le
# menton — il est ramené dans l'image, et réduit s'il le faut : jamais de bord répliqué, qui
# se voyait comme une coulure de pixels étirés sous le visage. "recadre": true le signale.
# Sans visage détecté : crop carré centré et "visage": false, mais jamais d'échec.
#
# Modèles embarqués dans le rootfs par image/Containerfile, aucun téléchargement au
# runtime :
#   /opt/portraits/models/face_detection_yunet_2023mar.onnx   (surcharge : SZH_YUNET)
#   /opt/portraits/models/u2net_human_seg.onnx                (surcharge : U2NET_HOME)
#
# Dépendances : venv /opt/portraits (rembg, onnxruntime, opencv-python-headless, pillow,
# numpy — pins dans image/requirements-portraits.txt).

import json
import os
import sys
import time

# U2NET_HOME doit être posé avant l'import de rembg, c'est là qu'il cherche ses modèles ;
# on ne l'écrase pas s'il est déjà dans l'environnement (tests hors rootfs).
os.environ.setdefault("U2NET_HOME", "/opt/portraits/models")

import cv2                      # noqa: E402 (l'env doit précéder les imports)
import numpy as np              # noqa: E402
from PIL import Image, ImageOps # noqa: E402
from rembg import new_session, remove  # noqa: E402

# --- Constantes de cadrage ---------------------------------------------------
TAILLE_SORTIE   = 400    # côté des PNG produits
FACE_PERCENT    = 40     # hauteur du visage ~ 40 % du côté du cadre
CENTRE_VERTICAL = 0.45   # centre du visage à 45 % de la hauteur du cadre depuis
                         # le haut (légèrement au-dessus du centre : portrait)
DETECTION_MAX   = 1024   # côté max de l'image passée au détecteur (perf)
MARGE_DETECTION = 0.4    # 2e passe : marge répliquée autour d'une photo très
                         # serrée (visage plein cadre) que YuNet rate sinon
SEUIL_SCORE     = 0.65   # score minimal YuNet pour retenir un visage

MODELE_YUNET = os.environ.get(
    "SZH_YUNET", "/opt/portraits/models/face_detection_yunet_2023mar.onnx"
)


def progression(message):
    """Trace lisible sur stderr (stdout est réservé au JSON)."""
    print(message, file=sys.stderr, flush=True)


def aplatir_en_rgb(img):
    """RGB systématique ; une éventuelle transparence est aplatie sur blanc."""
    if img.mode == "RGB":
        return img
    if "A" in img.getbands() or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        fond = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(fond, rgba).convert("RGB")
    return img.convert("RGB")


def creer_detecteur():
    """Instancie YuNet une seule fois (la taille d'entrée est reposée par image)."""
    if not os.path.isfile(MODELE_YUNET):
        raise FileNotFoundError(
            f"modèle YuNet introuvable : {MODELE_YUNET} (surcharge : env SZH_YUNET)"
        )
    return cv2.FaceDetectorYN.create(MODELE_YUNET, "", (320, 320), SEUIL_SCORE, 0.3, 5000)


def _detecter(img, detecteur):
    """Une passe YuNet sur `img` (RGB). Retourne (x, y, l, h) du plus grand
    visage en pixels de `img`, ou None. Réduit l'image pour la détection si
    elle dépasse DETECTION_MAX, puis re-projette les coordonnées."""
    largeur, hauteur = img.size
    echelle = 1.0
    img_det = img
    if max(largeur, hauteur) > DETECTION_MAX:
        echelle = DETECTION_MAX / max(largeur, hauteur)
        img_det = img.resize(
            (max(1, round(largeur * echelle)), max(1, round(hauteur * echelle))),
            Image.BILINEAR,
        )
    # PIL (RGB) -> tableau BGR contigu, ce qu'attend OpenCV.
    bgr = np.ascontiguousarray(np.asarray(img_det)[:, :, ::-1])
    detecteur.setInputSize((bgr.shape[1], bgr.shape[0]))
    _, visages = detecteur.detect(bgr)
    if visages is None or len(visages) == 0:
        return None
    v = max(visages, key=lambda f: float(f[2]) * float(f[3]))   # le plus grand
    return tuple(float(c) / echelle for c in v[:4])


def detecter_visage(img, detecteur):
    """Détection en deux passes. La seconde sert les photos cadrées très serré (visage
    plein cadre), que YuNet rate en l'état : on réplique une marge tout autour, on
    redétecte, puis on re-projette dans l'image d'origine. La boîte peut alors déborder de
    l'image, le cadrage la rattrape par padding."""
    boite = _detecter(img, detecteur)
    if boite is not None:
        return boite
    largeur, hauteur = img.size
    marge_l = round(largeur * MARGE_DETECTION)
    marge_h = round(hauteur * MARGE_DETECTION)
    tableau = np.pad(
        np.asarray(img), ((marge_h, marge_h), (marge_l, marge_l), (0, 0)), mode="edge"
    )
    boite = _detecter(Image.fromarray(tableau), detecteur)
    if boite is None:
        return None
    x, y, l, h = boite
    return (x - marge_l, y - marge_h, l, h)


def cadrer_visage(img, boite):
    """Cadre carré autour du visage. Formules :
         côté  = hauteur_visage * 100 / FACE_PERCENT
         x0    = centre_visage_x - côté / 2            (centré horizontalement)
         y0    = centre_visage_y - côté * CENTRE_VERTICAL

       Le cadre déborde souvent de la photo — un portrait cadré serré n'a pas de place
       sous le menton. On ne réplique PLUS le bord dans ce cas : la dernière ligne de
       pixels étirée sur un dixième de la hauteur se voyait comme une coulure sous chaque
       visage. On ramène le cadre dans l'image :
         1. on le translate du strict nécessaire, ce qui décentre un peu le visage ;
         2. s'il est encore trop grand, on réduit son côté jusqu'à ce qu'il tienne, en
            gardant le centre du visage aussi près que possible de sa place. Le visage
            occupe alors une part plus grande du cadre que FACE_PERCENT — un cadrage plus
            serré, mais fait de vrais pixels.
       Retourne (image carrée, cadre_reduit)."""
    x, y, l, h = boite
    largeur, hauteur = img.size
    cote = h * 100.0 / FACE_PERCENT
    centre_x = x + l / 2.0
    centre_y = y + h / 2.0

    # Un carré ne peut pas dépasser le petit côté de la photo.
    cote_max = float(min(largeur, hauteur))
    reduit = cote > cote_max
    cote = max(1, int(round(min(cote, cote_max))))

    # Position voulue, puis ramenée dans l'image : le visage se décentre plutôt que la
    # photo ne s'étire.
    gauche = int(round(centre_x - cote / 2.0))
    haut = int(round(centre_y - cote * CENTRE_VERTICAL))
    gauche = max(0, min(gauche, largeur - cote))
    haut = max(0, min(haut, hauteur - cote))
    return img.crop((gauche, haut, gauche + cote, haut + cote)), reduit


def cadrer_centre(img):
    """Repli sans visage : carré centré, côté = min(largeur, hauteur)."""
    largeur, hauteur = img.size
    cote = min(largeur, hauteur)
    gauche = (largeur - cote) // 2
    haut = (hauteur - cote) // 2
    return img.crop((gauche, haut, gauche + cote, haut + cote))


def ecrire_atomique(img, chemin):
    """PNG écrit dans un temporaire du dossier cible puis os.replace : le
    fichier final n'est jamais visible à moitié écrit (OneDrive, cockpit)."""
    dossier = os.path.dirname(chemin) or "."
    tmp = os.path.join(dossier, f".~{os.path.basename(chemin)}.{os.getpid()}.tmp")
    try:
        with open(tmp, "wb") as flux:
            img.save(flux, format="PNG")
        os.replace(tmp, chemin)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def traiter(slug, source, dossier, detecteur, session):
    """Toute la chaîne pour une image ; ne lève jamais (résultat JSON-isable)."""
    resultat = {
        "slug": slug,
        "ok": False,
        "visage": False,
        "recadre": False,
        "fichiers": None,
        "erreur": None,
    }
    try:
        with Image.open(source) as brut:
            img = ImageOps.exif_transpose(brut)
            img.load()
        img = aplatir_en_rgb(img)

        boite = detecter_visage(img, detecteur)
        if boite is not None:
            resultat["visage"] = True
            carre, reduit = cadrer_visage(img, boite)
            resultat["recadre"] = reduit
        else:
            progression(f"[portraits] {slug} : aucun visage détecté -> carré centré")
            carre = cadrer_centre(img)

        carre = carre.resize((TAILLE_SORTIE, TAILLE_SORTIE), Image.LANCZOS)
        avec_fond = carre.convert("LA")
        sans_fond = remove(carre, session=session).convert("LA")

        chemin_avec = os.path.join(dossier, f"{slug}.avec-fond.png")
        chemin_sans = os.path.join(dossier, f"{slug}.sans-fond.png")
        ecrire_atomique(avec_fond, chemin_avec)
        ecrire_atomique(sans_fond, chemin_sans)
        resultat["fichiers"] = {"avec_fond": chemin_avec, "sans_fond": chemin_sans}
        resultat["ok"] = True
    except Exception as exc:                          # jamais de traceback en sortie
        resultat["erreur"] = f"{type(exc).__name__}: {exc}"
        progression(f"[portraits] {slug} : ÉCHEC — {resultat['erreur']}")
    return resultat


def principal(argv):
    if len(argv) < 2 or len(argv) % 2 != 0:
        progression("usage : portraits.py <dossier_sortie> [<slug> <image-source>]...")
        return 2
    dossier = argv[1]
    paires = list(zip(argv[2::2], argv[3::2]))
    if not paires:
        return 0

    debut = time.monotonic()
    try:
        os.makedirs(dossier, exist_ok=True)
        detecteur = creer_detecteur()
        # Une seule session rembg pour toute l'invocation : le chargement du modèle
        # u2net_human_seg est le poste le plus coûteux.
        session = new_session("u2net_human_seg")
    except Exception as exc:
        # Environnement inutilisable (modèle absent…) : une ligne JSON par slug demandé,
        # pour que l'appelant sache quoi rattacher à quoi.
        erreur = f"{type(exc).__name__}: {exc}"
        progression(f"[portraits] initialisation impossible — {erreur}")
        for slug, _ in paires:
            print(json.dumps({
                "slug": slug, "ok": False, "visage": False, "recadre": False,
                "fichiers": None, "erreur": erreur,
            }, ensure_ascii=False), flush=True)
        return 1

    echecs = 0
    for slug, source in paires:
        progression(f"[portraits] traite {slug} ({source})")
        resultat = traiter(slug, source, dossier, detecteur, session)
        print(json.dumps(resultat, ensure_ascii=False), flush=True)
        if not resultat["ok"]:
            echecs += 1
    progression(
        f"[portraits] terminé : {len(paires) - echecs}/{len(paires)} image(s) "
        f"en {time.monotonic() - debut:.1f} s"
    )
    return 1 if echecs else 0


if __name__ == "__main__":
    sys.exit(principal(sys.argv))
