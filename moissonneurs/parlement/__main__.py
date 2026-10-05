"""Point d'entrée : python3 -B -m parlement, lancé depuis moissonneurs/."""
import sys

from .cli import main

sys.exit(main())
