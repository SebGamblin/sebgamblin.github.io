import math
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation


def vitesse_perihelie(planete):
    """
    Calcule la vitesse à la périhélie à partir des paramètres orbitaux.
    """
    e = planete["excentricite"]
    a = planete["demi_axe"]
    return math.sqrt(G * MASSE_SOLEIL * (1 + e) / (a * (1 - e)))


def methode_euler(perihelie, vitesse_initiale, nb_steps=3650, delta_t=8640):
    """
    Méthode d'Euler classique pour l'orbite d'une planète autour du Soleil.
    return : liste des positions successives [x, y]
    """
    position = [perihelie, 0.0]
    vitesse = [0.0, vitesse_initiale]

    positions = [position.copy()]

    for _ in range(nb_steps):
        r = math.hypot(position[0], position[1])
        coeff = -G * MASSE_SOLEIL / r**3

        acceleration = [position[0] * coeff, position[1] * coeff]

        position = [
            position[i] + vitesse[i] * delta_t
            for i in range(2)
        ]

        vitesse = [
            vitesse[i] + acceleration[i] * delta_t
            for i in range(2)
        ]

        positions.append(position.copy())

    return positions


def methode_euler_asymetrique(perihelie, vitesse_initiale, nb_steps=3650, delta_t=8640):
    """
    Méthode d'Euler asymétrique (semi-implicite) pour le mouvement
    d'une planète autour du Soleil.

    Principe :
    - on met à jour la position avec la vitesse courante
    - on recalcule l'accélération à partir de la nouvelle position
    - on met à jour la vitesse avec cette accélération

    Cette méthode conserve beaucoup mieux l'énergie que l'Euler classique.

    :param perihelie: distance initiale à la périhélie (m)
    :param vitesse_initiale: vitesse initiale à la périhélie (m/s)
    :param nb_steps: nombre de pas de temps
    :param delta_t: durée d'un pas de temps (s)
    :return: liste des positions successives [x, y]
    """

    # État initial (plan orbital 2D)
    position = [perihelie, 0.0]
    vitesse = [0.0, vitesse_initiale]

    positions = [position.copy()]

    for _ in range(nb_steps):
        # Étape 1 — mise à jour de la position
        position = [
            position[i] + vitesse[i] * delta_t
            for i in range(2)
        ]

        # Étape 2 — calcul de l'accélération à la nouvelle position
        r = math.hypot(position[0], position[1])
        coeff = -G * MASSE_SOLEIL / r**3
        acceleration = [
            position[0] * coeff,
            position[1] * coeff
        ]

        # Étape 3 — mise à jour de la vitesse
        vitesse = [
            vitesse[i] + acceleration[i] * delta_t
            for i in range(2)
        ]

        positions.append(position.copy())

    return positions



def energie_mecanique(position, vitesse, masse):
    """
    Énergie mécanique totale : Ec + Ep
    """
    r = math.hypot(position[0], position[1])
    v2 = vitesse[0]**2 + vitesse[1]**2

    Ec = 0.5 * masse * v2
    Ep = -G * MASSE_SOLEIL * masse / r

    return Ec + Ep


def show_trajectoires(trajectoires):
    # Affichage des trajectoires
        
    plt.figure(figsize=(6, 6))

    for nom, positions in trajectoires.items():
        X = [p[0] for p in positions]
        Y = [p[1] for p in positions]
        plt.plot(X, Y, label=nom)

    plt.scatter(0, 0, color="yellow", s=200, label="Soleil")
    plt.axis("equal")
    plt.legend()
    plt.title("Trajectoires planétaires — Méthode d'Euler")
    plt.show()
    

def show_energy(energies):
    # Affichage de l'energie
    plt.figure(figsize=(10, 5))

    for nom, e in energies.items():
        plt.plot(e, label=nom)

    plt.xlabel("Pas de temps")
    plt.ylabel("Énergie mécanique (J)")
    plt.title("Conservation de l'énergie — Méthode d'Euler")
    plt.legend()
    plt.grid()
    plt.show()

    
def anime_trajectoires(trajectoires, interval_ms=10):
    """
    Anime le mouvement de plusieurs trajectoires déjà calculées.

    :param trajectoires: dictionnaire {nom: [[x, y], ...]}
    :param interval_ms: durée entre deux images (ms)
    """
    import matplotlib.pyplot as plt
    from matplotlib.animation import FuncAnimation

    # ----------------------------
    # Préparation des données
    # ----------------------------
    noms = list(trajectoires.keys())
    couleurs = ["green", "blue", "red", "orange"]

    X_all = {nom: [p[0] for p in traj] for nom, traj in trajectoires.items()}
    Y_all = {nom: [p[1] for p in traj] for nom, traj in trajectoires.items()}

    nb_frames = min(len(traj) for traj in X_all.values())

    # Limites d'affichage
    all_x = [x for X in X_all.values() for x in X]
    all_y = [y for Y in Y_all.values() for y in Y]

    # ----------------------------
    # Figure et axes
    # ----------------------------
    fig, ax = plt.subplots(figsize=(6, 6))
    ax.set_xlim(min(all_x) * 1.1, max(all_x) * 1.1)
    ax.set_ylim(min(all_y) * 1.1, max(all_y) * 1.1)
    ax.set_aspect("equal")
    ax.set_title("Animation des trajectoires planétaires")

    # Soleil
    soleil = plt.Circle((0, 0), 1e10, color="yellow", label="Soleil")
    ax.add_patch(soleil)

    # ----------------------------
    # Tracé des trajectoires + points mobiles
    # ----------------------------
    points = []

    for i, nom in enumerate(noms):
        ax.plot(X_all[nom], Y_all[nom],
                color=couleurs[i % len(couleurs)],
                alpha=0.3,
                label=f"Trajectoire {nom}")

        point, = ax.plot([], [], "o",
                          color=couleurs[i % len(couleurs)],
                          label=nom)
        points.append(point)

    ax.legend()

    # ----------------------------
    # Animation
    # ----------------------------
    def update(frame):
        for i, nom in enumerate(noms):
            points[i].set_data([X_all[nom][frame]], [Y_all[nom][frame]])
        return points

    anim = FuncAnimation(
        fig,
        update,
        frames=nb_frames,
        interval=interval_ms,
        blit=True
    )

    plt.show()
    

if __name__ == "__main__":
    # Constantes physiques
    G = 6.674184e-11           # constante gravitationnelle (m^3 kg^-1 s^-2)
    MASSE_SOLEIL = 1.9884e30   # masse du Sol


    # Données des planètes
    PLANETES = [
        {"nom": "Mercure", "masse": 3.3e23,   "perihelie": 4.7e10,  "excentricite": 0.20563069, "demi_axe": 5.7909227e10},
        {"nom": "Venus",   "masse": 4.9e24,   "perihelie": 1.1e11,  "excentricite": 0.00677323, "demi_axe": 1.08209475e11},
        {"nom": "Terre",   "masse": 5.9722e24,"perihelie": 1.47e11, "excentricite": 0.01671022, "demi_axe": 1.495978875e11},
        {"nom": "Mars",    "masse": 0.642e24, "perihelie": 2.06e11, "excentricite": 0.09341233, "demi_axe": 2.279392e11},
    ]

    trajectoires = {}
    energies = {}

    for p in PLANETES:
        v0 = vitesse_perihelie(p)
        # positions = methode_euler(p["perihelie"], v0)
        positions = methode_euler_asymetrique(p["perihelie"], v0)

        trajectoires[p["nom"]] = positions

        # Calcul énergie associée
        energie = []
        vitesse = [0.0, v0]

        for pos in positions:
            energie.append(energie_mecanique(pos, vitesse, p["masse"]))

        energies[p["nom"]] = energie
    
    show_trajectoires(trajectoires)
    
    show_energy(energies)
    
    anime_trajectoires(trajectoires)

    
    