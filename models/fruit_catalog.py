"""Single source of truth for fruit sizes, growth habits, and pinhole-distance math.

Distance formula (from CLAUDE.md):
    distance_cm = (FOCAL_LENGTH_PX * real_diameter_cm) / object_diameter_pixels

FOCAL_LENGTH_PX = 1850 is the approximate Tello focal length for the
960x720 stream (82.6 degree FOV). real_diameter_cm varies by fruit and
ripeness stage, looked up from FRUIT_CATALOG below.
"""

FOCAL_LENGTH_PX = 1850
DEFAULT_DIAMETER_CM = 6.5

RIPENESS_STAGES = ("ripe", "unripe", "overripe")

# For each fruit: real diameter in cm per ripeness stage, and growth habit.
# habit is one of: "tree" | "bush" | "vine" | "ground"
# Unripe sizes are roughly 75-80% of ripe; overripe roughly 100-110%.
FRUIT_CATALOG = {
    "apple":      {"habit": "tree",   "diameter_cm": {"ripe": 7.5,  "unripe": 5.5,  "overripe": 7.0}},
    "banana":     {"habit": "tree",   "diameter_cm": {"ripe": 3.5,  "unripe": 3.0,  "overripe": 4.0}},
    "mango":      {"habit": "tree",   "diameter_cm": {"ripe": 8.0,  "unripe": 6.0,  "overripe": 8.5}},
    "orange":     {"habit": "tree",   "diameter_cm": {"ripe": 7.5,  "unripe": 6.0,  "overripe": 7.9}},
    "pear":       {"habit": "tree",   "diameter_cm": {"ripe": 7.0,  "unripe": 5.5,  "overripe": 7.4}},
    "peach":      {"habit": "tree",   "diameter_cm": {"ripe": 7.0,  "unripe": 5.5,  "overripe": 7.4}},
    "plum":       {"habit": "tree",   "diameter_cm": {"ripe": 5.0,  "unripe": 4.0,  "overripe": 5.3}},
    "cherry":     {"habit": "tree",   "diameter_cm": {"ripe": 2.5,  "unripe": 2.0,  "overripe": 2.6}},
    "lemon":      {"habit": "tree",   "diameter_cm": {"ripe": 6.0,  "unripe": 4.8,  "overripe": 6.3}},
    "blueberry":  {"habit": "bush",   "diameter_cm": {"ripe": 1.5,  "unripe": 1.2,  "overripe": 1.6}},
    "raspberry":  {"habit": "bush",   "diameter_cm": {"ripe": 2.0,  "unripe": 1.6,  "overripe": 2.1}},
    "blackberry": {"habit": "bush",   "diameter_cm": {"ripe": 2.2,  "unripe": 1.7,  "overripe": 2.3}},
    "strawberry": {"habit": "ground", "diameter_cm": {"ripe": 3.5,  "unripe": 2.7,  "overripe": 3.7}},
    "grape":      {"habit": "vine",   "diameter_cm": {"ripe": 2.0,  "unripe": 1.5,  "overripe": 2.1}},
    "tomato":     {"habit": "ground", "diameter_cm": {"ripe": 6.5,  "unripe": 5.0,  "overripe": 6.8}},
    "watermelon": {"habit": "ground", "diameter_cm": {"ripe": 25.0, "unripe": 19.0, "overripe": 26.5}},
    "pineapple":  {"habit": "ground", "diameter_cm": {"ripe": 12.0, "unripe": 9.5,  "overripe": 12.5}},
}

# Canopy/foliage width assumptions (cm) for plant landmarks located by
# LocateAnything, used with the same pinhole formula to estimate distance.
PLANT_WIDTH_CM = {
    "tree": 250.0,
    "bush": 100.0,
    "plant": 40.0,
}


def get_real_diameter_cm(fruit_type, ripeness="ripe"):
    """Real-world diameter (cm) for a fruit at a given ripeness stage."""
    fruit = FRUIT_CATALOG.get((fruit_type or "").strip().lower())
    if not fruit:
        return DEFAULT_DIAMETER_CM
    diameters = fruit["diameter_cm"]
    return diameters.get((ripeness or "ripe").strip().lower(), diameters["ripe"])


def get_growth_habit(fruit_type):
    """Growth habit ("tree" | "bush" | "vine" | "ground") for a fruit."""
    fruit = FRUIT_CATALOG.get((fruit_type or "").strip().lower())
    return fruit["habit"] if fruit else "tree"


def _pinhole_distance_cm(pixel_diameter, real_diameter_cm):
    if not pixel_diameter or pixel_diameter <= 0:
        return None
    return round((FOCAL_LENGTH_PX * real_diameter_cm) / pixel_diameter, 1)


def calculate_distance_cm(bbox_w, bbox_h, fruit_type="apple", ripeness="ripe"):
    """Estimate drone-to-fruit distance (cm) from a bbox via the pinhole model."""
    real_cm = get_real_diameter_cm(fruit_type, ripeness)
    pixel_diameter = max(bbox_w or 0, bbox_h or 0)
    return _pinhole_distance_cm(pixel_diameter, real_cm)


def plant_kind_from_label(label):
    """Map a free-form landmark label to "tree" | "bush" | "plant" (or None)."""
    words = set(
        (label or "").strip().lower().replace("_", " ").replace("-", " ").split()
    )
    if words & {"tree", "trees"}:
        return "tree"
    if words & {"bush", "bushes", "shrub", "shrubs"}:
        return "bush"
    if words & {"plant", "plants", "vine", "vines"}:
        return "plant"
    return None


def calculate_plant_distance_cm(bbox_w, bbox_h, label):
    """Estimate drone-to-plant distance (cm) using canopy-width assumptions."""
    kind = plant_kind_from_label(label) or "plant"
    real_cm = PLANT_WIDTH_CM[kind]
    # Canopy width is the better size cue; fall back to height if missing.
    pixel_diameter = bbox_w or bbox_h or 0
    return _pinhole_distance_cm(pixel_diameter, real_cm)
