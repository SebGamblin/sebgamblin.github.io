
import matplotlib.pyplot as plt
import math
import physics
import pygame


def main1():
    # État initial
    x, y = 0.0, 0.0
    vx, vy = 0.0, 0.0

    # "Haut-gauche" maintenu (UP+LEFT) = -135° = -3π/4
    angle_control = -3 * math.pi / 4

    # Une itération de mise à jour
    x, y, vx, vy, ang_v, = physics.update_physics(
        x, y, vx, vy, angle_control, True, 0.02
    )
    
    print(x, y, vx, vy, ang_v)
    

def main2():
    x, y = 0.0, 0.0
    vx, vy = 150.0, 100.0     # vitesse initiale, vers la droite
    angle_control = -3 * math.pi / 4  # déplacement dans cette direction : bas à gauche

    positions_x = []
    positions_y = []
    for _ in range(50):
        x, y, vx, vy, ang_v = physics.update_physics(
            x, y, vx, vy, angle_control, True, 0.02
        )
        
        positions_x.append(x)
        positions_y.append(y)
    
    # ----------------------------
    # VISUALISATION
    # ----------------------------
    plt.figure(figsize=(7, 5))
    plt.plot([positions_x[0]], [positions_y[0]], 'o', markersize=4, color="r")
    plt.plot(positions_x, positions_y, '-o', markersize=2)
    plt.title("Simulation d'une trajectoire inertielle")
    plt.xlabel("x (pixels)")
    plt.ylabel("y (pixels)")
    plt.grid(True)
    plt.axis("equal")
    plt.show()



def draw_arrow(surface: pygame.Surface, x: float, y: float, angle: float) -> None:
    """
    Affiche une flèche triangulaire orientée selon l'angle donné.
    """
    L, W = 40, 20
    px = x + L * math.cos(angle); py = y + L * math.sin(angle)
    lx = x + W * math.cos(angle + 2.5); ly = y + W * math.sin(angle + 2.5)
    rx = x + W * math.cos(angle - 2.5); ry = y + W * math.sin(angle - 2.5)
    pygame.draw.polygon(surface, (255, 220, 0), [(px, py), (lx, ly), (rx, ry)])


def main():
    pygame.init()
    WIDTH, HEIGHT = 900, 600                             # Dimensions souhaitées de la fenêtre, en pixels
    screen = pygame.display.set_mode((WIDTH, HEIGHT))    # Initialisation de la fenêtre
    pygame.display.set_caption("Simulation inertielle")  # Titre de la page 
    clock = pygame.time.Clock()                          # Horloge du jeu : permet la mise à jour et l'utilisation de dt

    # --- ETAT INITIAL
    x, y = WIDTH / 4, HEIGHT / 4   # Position initiale 
    vx, vy = 150.0, 150.0          # Vitesse initiale
    angle_control = math.pi / 4  # Direction : à droite 

    running = True               # Condition d'arrêt de la boucle événementielle
    while running:
        dt_seconds = clock.tick(60) / 1000.0  # delta‑temps réel entre deux frames (en secondes), basé sur un framerate max de 60 FPS

        # --- RECUPERATION DES ÉVÉNEMENTS
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

        # --- CONTRÔLE UTILISATEUR
        keys = pygame.key.get_pressed() # Récupération des touches utilisées
        if keys[pygame.K_LEFT]:         # L'utilisateur appuie sur <- : rotation à gauche
            angle_control -= physics.TURN_SPEED * dt_seconds
        if keys[pygame.K_RIGHT]:        # L'utilisateur appuie sur -> : rotation à droite
            angle_control += physics.TURN_SPEED * dt_seconds

        # --- MODÈLE PHYSIQUE
        x, y, vx, vy, angle_velocity = physics.update_physics(
            x, y, vx, vy, angle_control, bool(keys[pygame.K_UP]), dt_seconds
        )

        # --- VUE : ANGLE AFFICHÉ
        angle_displayed = physics.lerp_angle(
            angle_control, angle_velocity, physics.ANGLE_BLEND
        )

        # --- RENDU
        screen.fill((30, 30, 30))
        draw_arrow(screen, x, y, angle_displayed)
        pygame.display.flip()

    pygame.quit()

if __name__ == "__main__":
    main()