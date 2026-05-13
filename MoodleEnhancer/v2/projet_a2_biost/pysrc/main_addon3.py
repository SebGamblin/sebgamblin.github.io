import pygame
import random
import math

import physics
from main_addon import draw_arrow, draw_debug_info, draw_rosace, draw_vector, get_input_direction

# ===============================
#           CONSTANTES
# ===============================

# --- MÉTÉORITES ---
METEOR_MIN_SPEED = 40.0        # px/s
METEOR_MAX_SPEED = 150.0       # px/s
METEOR_MIN_R, METEOR_MAX_R = 10, 32
METEOR_SPAWN_INTERVAL = 1.8    # s
METEOR_MAX_COUNT = 24
SAFE_SPAWN_DISTANCE = 150.0

# --- MISSILES (NOUVEAU) ---
MISSILE_SPEED = 500.0          # px/s
MISSILE_RADIUS = 4             # px
MISSILE_LIFETIME = 1.25        # s
FIRE_COOLDOWN = 2           # s (intervalle mini entre 2 tirs)
ARROW_TIP_OFFSET = 40 + MISSILE_RADIUS + 2  # départ du missile au bout de la flèche


# ===============================
#     MÉTÉORITES : MODÈLE + VUE
# ===============================

def spawn_meteorite(meteorites: list[dict[str, float]],
                    player_x: float, player_y: float,
                    width: int, height: int) -> None:
    """Crée une météorite sur un bord, direction rentrante."""
    if len(meteorites) >= METEOR_MAX_COUNT:
        return

    side = random.randint(0, 3)
    margin = 0  # bord exact

    if side == 0:   # haut
        x = random.uniform(0, width);  y = margin
        base_angle = math.radians(90)   # vers le bas
    elif side == 1: # droite
        x = width - margin; y = random.uniform(0, height)
        base_angle = math.radians(180)  # vers la gauche
    elif side == 2: # bas
        x = random.uniform(0, width);  y = height - margin
        base_angle = math.radians(-90)  # vers le haut
    else:           # gauche
        x = margin; y = random.uniform(0, height)
        base_angle = 0.0                # vers la droite

    jitter = random.uniform(-math.pi/6, math.pi/6)
    angle = base_angle + jitter
    speed = random.uniform(METEOR_MIN_SPEED, METEOR_MAX_SPEED)
    vx = speed * math.cos(angle)
    vy = speed * math.sin(angle)
    r  = random.randint(METEOR_MIN_R, METEOR_MAX_R)

    # Sécurité : éviter spawn trop proche du joueur
    if (x - player_x) ** 2 + (y - player_y) ** 2 < SAFE_SPAWN_DISTANCE ** 2:
        x = (x + SAFE_SPAWN_DISTANCE) % width
        y = (y + SAFE_SPAWN_DISTANCE) % height

    meteorites.append({"x": x, "y": y, "vx": vx, "vy": vy, "r": r})


def update_meteorites(meteorites: list[dict[str, float]], dt: float,
                      width: int, height: int) -> None:
    """Fait avancer les météorites et applique le wrap toroïdal."""
    for m in meteorites:
        m["x"] = (m["x"] + m["vx"] * dt) % width
        m["y"] = (m["y"] + m["vy"] * dt) % height


def draw_meteorites(surface: pygame.Surface, meteorites: list[dict[str, float]]) -> None:
    """Dessine les météorites (disques gris foncé + liseré)."""
    for m in meteorites:
        pygame.draw.circle(surface, (120, 120, 120), (int(m["x"]), int(m["y"])), m["r"])
        pygame.draw.circle(surface, (60, 60, 60), (int(m["x"]), int(m["y"])), m["r"], width=2)


def player_collision_with_meteorites(px: float, py: float, player_radius: float,
                                     meteorites: list[dict[str, float]]) -> bool:
    """Collision si distance^2 <= (r_player + r_meteor)^2."""
    for m in meteorites:
        dx = px - m["x"]; dy = py - m["y"]
        rr = (player_radius + m["r"]) ** 2
        if dx * dx + dy * dy <= rr:
            return True
    return False


# ===============================
#           MISSILES
# ===============================

def spawn_missile(bullets: list[dict[str, float]],
                  ship_x: float, ship_y: float, angle_control: float) -> None:
    """Crée un missile partant du bout de la flèche, dans la direction de contrôle."""
    x0 = ship_x + ARROW_TIP_OFFSET * math.cos(angle_control)
    y0 = ship_y + ARROW_TIP_OFFSET * math.sin(angle_control)
    vx = MISSILE_SPEED * math.cos(angle_control)
    vy = MISSILE_SPEED * math.sin(angle_control)
    bullets.append({"x": x0, "y": y0, "vx": vx, "vy": vy, "life": MISSILE_LIFETIME})


def update_missiles(bullets: list[dict[str, float]], dt: float,
                    width: int, height: int) -> None:
    """Fait avancer les missiles, décrémente la vie, wrap, et supprime ceux expirés."""
    alive_bullets = []
    for b in bullets:
        b["x"] = (b["x"] + b["vx"] * dt) % width
        b["y"] = (b["y"] + b["vy"] * dt) % height
        b["life"] -= dt
        if b["life"] > 0:
            alive_bullets.append(b)
    bullets[:] = alive_bullets


def draw_missiles(surface: pygame.Surface, bullets: list[dict[str, float]]) -> None:
    """Dessine les missiles comme de petits disques blancs."""
    for b in bullets:
        pygame.draw.circle(surface, (240, 240, 255), (int(b["x"]), int(b["y"])), MISSILE_RADIUS)


def resolve_bullet_meteor_collisions(bullets: list[dict[str, float]],
                                     meteorites: list[dict[str, float]]) -> int:
    """
    Détecte et résout les collisions missiles ↔ météorites.
    Supprime les deux en cas d'impact.
    Retourne le nombre de météorites détruites.
    """
    to_remove_bullets = set()
    to_remove_meteors = set()
    destroyed = 0

    for i, b in enumerate(bullets):
        bx, by = b["x"], b["y"]
        for j, m in enumerate(meteorites):
            dx = bx - m["x"]; dy = by - m["y"]
            rr = (MISSILE_RADIUS + m["r"]) ** 2
            if dx * dx + dy * dy <= rr:
                to_remove_bullets.add(i)
                to_remove_meteors.add(j)
                destroyed += 1
                break  # on passe au missile suivant

    if to_remove_bullets:
        bullets[:] = [b for k, b in enumerate(bullets) if k not in to_remove_bullets]
    if to_remove_meteors:
        meteorites[:] = [m for k, m in enumerate(meteorites) if k not in to_remove_meteors]

    return destroyed


# ===============================
#             JEU
# ===============================

def main():
    pygame.init()
    WIDTH, HEIGHT = 900, 600
    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption("Simulation inertielle — v3 (tirs)")
    clock = pygame.time.Clock()

    # --- ÉTAT INITIAL JOUEUR ---
    x, y = WIDTH / 4, HEIGHT / 4
    vx, vy = 150.0, 150.0
    angle_control = math.pi / 4
    angle_velocity = angle_control
    PLAYER_RADIUS = 16  # rayon collision du vaisseau

    # --- MÉTÉORITES & SCORE ---
    meteorites: list[dict[str, float]] = []
    spawn_timer = 0.0
    alive = False
    survival_time = 0.0
    best_time = 0.0
    destroyed_count = 0  # (NOUVEAU)

    # --- MISSILES ---
    bullets: list[dict[str, float]] = []
    fire_cooldown = 0.0  # (NOUVEAU)

    font = pygame.font.SysFont("consolas", 22)

    running = True
    while running:
        dt_seconds = clock.tick(60) / 1000.0  # delta‑temps réel (s), max 60 FPS

        # --- Événements ---
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

        keys = pygame.key.get_pressed()

        # --- Jeu en cours ---
        if alive:
            # Rotation
            if keys[pygame.K_LEFT]:
                angle_control -= physics.TURN_SPEED * dt_seconds
            if keys[pygame.K_RIGHT]:
                angle_control += physics.TURN_SPEED * dt_seconds
            angle_control %= (2 * math.pi)

            # Physique joueur
            x, y, vx, vy, angle_velocity = physics.update_physics(
                x, y, vx, vy, angle_control, bool(keys[pygame.K_UP]), dt_seconds
            )
            x %= WIDTH; y %= HEIGHT  # wrap

            # Tir (avec cooldown)
            fire_cooldown = max(0.0, fire_cooldown - dt_seconds)
            if keys[pygame.K_SPACE] and fire_cooldown <= 0.0:
                spawn_missile(bullets, x, y, angle_displayed)
                fire_cooldown = FIRE_COOLDOWN

            # Mise à jour missiles & météorites
            update_missiles(bullets, dt_seconds, WIDTH, HEIGHT)

            spawn_timer += dt_seconds
            if spawn_timer >= METEOR_SPAWN_INTERVAL:
                spawn_timer = 0.0
                spawn_meteorite(meteorites, x, y, WIDTH, HEIGHT)

            update_meteorites(meteorites, dt_seconds, WIDTH, HEIGHT)

            # Collisions
            if player_collision_with_meteorites(x, y, PLAYER_RADIUS, meteorites):
                alive = False
                best_time = max(best_time, survival_time)

            destroyed_count += resolve_bullet_meteor_collisions(bullets, meteorites)

            # Temps de survie
            survival_time += dt_seconds

        else:
            # Game over : restart sur R
            if keys[pygame.K_r]:
                # Reset complet
                x, y = WIDTH / 4, HEIGHT / 4
                vx, vy = 150.0, 150.0
                angle_control = math.pi / 4
                angle_velocity = angle_control
                meteorites.clear()
                bullets.clear()
                spawn_timer = 0.0
                survival_time = 0.0
                destroyed_count = 0
                fire_cooldown = 0.0
                alive = True

        # --- Vue : angle affiché ---
        angle_displayed = physics.lerp_angle(
            angle_control, angle_velocity if alive else angle_control, physics.ANGLE_BLEND
        )

        # --- Rendu ---
        screen.fill((30, 30, 30))
        draw_arrow(screen, x, y, angle_displayed, (0, 255, 0) if fire_cooldown <= 0 else None)
        draw_meteorites(screen, meteorites)
        draw_missiles(screen, bullets)  # (NOUVEAU)

        # Rosace, debug, vecteur vitesse
        input_angle = get_input_direction(keys, angle_control)
        draw_rosace(screen, WIDTH - 120, HEIGHT - 120, angle_displayed, input_angle)
        draw_debug_info(screen, vx, vy, angle_displayed, angle_control)
        draw_vector(screen, x, y, vx, vy, (0, 255, 0))

        # HUD
        hud_text = f"Temps: {survival_time:5.2f}s  Record: {best_time:5.2f}s   Tirs OK: {max(0.0, fire_cooldown):.2f}s   Météorites détruites: {destroyed_count}"
        screen.blit(font.render(hud_text, True, (255, 255, 255)), (20, HEIGHT - 40))

        if not alive:
            go_surf = font.render("Collision ! Appuyez sur R pour recommencer", True, (255, 120, 120))
            screen.blit(go_surf, (WIDTH // 2 - go_surf.get_width() // 2, 20))

        pygame.display.flip()

    pygame.quit()


if __name__ == "__main__":
    main()