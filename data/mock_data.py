"""
Mock orchard data for UI development.
Toggle USE_MOCK_DATA in app.py to switch between this and the real DB.

Layout (all positions in cm from mission pad):
  Row A  x = -300   trees at z = 160, 480, 800
  Row B  x =  300   trees at z = 160, 480, 800
  Rocks / standalone located items scattered off-row.
"""

import math

MOCK_SESSION_ID = "mock-session-001"

MOCK_SESSIONS = [
    {
        "sessionId": MOCK_SESSION_ID,
        "startTime": "2026-06-09 10:00:00",
        "totalDetections": 38,
    }
]

TREE_CENTERS = {
    "A1": (-300, 160),
    "A2": (-300, 480),
    "A3": (-300, 800),
    "B1": (300, 160),
    "B2": (300, 480),
    "B3": (300, 800),
}

TREE_DISTANCES = {
    "A1": 310,
    "A2": 290,
    "A3": 285,
    "B1": 275,
    "B2": 285,
    "B3": 270,
}

_GOLDEN_ANGLE = math.pi * 2 * (1 - 1 / ((1 + math.sqrt(5)) / 2))
_CANOPY_HEIGHTS = [176, 198, 216, 188, 228, 164, 206, 184]


def _slot_from_uid(uid):
    try:
        return max(0, int(uid.rsplit("-", 1)[1]) - 1)
    except (IndexError, ValueError):
        h = 2166136261
        for ch in uid:
            h ^= ord(ch)
            h = (h * 16777619) & 0xFFFFFFFF
        return h % 8


def _fruit_on_canopy_edge(tree_id, uid):
    if tree_id not in TREE_CENTERS:
        return None

    cx, cz = TREE_CENTERS[tree_id]
    slot = _slot_from_uid(uid)
    angle = slot * _GOLDEN_ANGLE + (0.22 if tree_id.startswith("B") else 0.0)
    radius = 82 + (slot % 4) * 8
    x = round(cx + math.cos(angle) * radius)
    z = round(cz + math.sin(angle) * radius)
    y = _CANOPY_HEIGHTS[slot % len(_CANOPY_HEIGHTS)]
    return x, y, z


# ── Fruit detections ─────────────────────────────────────────────────────────
# Each detection needs: id, image, fruitType, ripeness, confidence,
#   isUncertain, classification, treeId, position {x, y, z}, distanceCm

def _det(uid, image, fruit, ripeness, conf, tree_id, x, y, z, dist, uncertain=False):
    """
    Known tree IDs ignore legacy x/y/z and place fruit on a balanced outer
    canopy shell, keeping row centers aligned while apples sit on leaf edges.
    """
    canopy_pos = _fruit_on_canopy_edge(tree_id, uid)
    if canopy_pos:
        x, y, z = canopy_pos
    else:
        y = y + 85 if y < 130 else y

    return {
        "id": uid,
        "image": image,
        "fruitType": fruit,
        "ripeness": ripeness,
        "confidence": conf,
        "isUncertain": uncertain,
        "classification": ("possible-" if uncertain else "") + f"{fruit}-{ripeness}",
        "treeId": tree_id,
        "position": {"x": x, "y": y, "z": z},
        "distanceCm": dist,
    }

MOCK_DETECTIONS = [
    # ── Tree A1  (Row A, z≈150) ───────────────────────────────────────────────
    _det("a1-1",  "mock_A1.jpg", "apple", "ripe",     0.91, "A1", -250,  95,  130, 310),
    _det("a1-2",  "mock_A1.jpg", "apple", "ripe",     0.88, "A1", -265,  80,  155, 295),
    _det("a1-3",  "mock_A1.jpg", "apple", "unripe",   0.74, "A1", -235, 110,  170, 320),
    _det("a1-4",  "mock_A1.jpg", "apple", "ripe",     0.85, "A1", -255,  70,  145, 305),
    _det("a1-5",  "mock_A1.jpg", "apple", "overripe", 0.67, "A1", -245, 100,  160, 315),
    _det("a1-6",  "mock_A1.jpg", "apple", "ripe",     0.79, "A1", -260,  85,  140, 300, uncertain=True),

    # ── Tree A2  (Row A, z≈450) ───────────────────────────────────────────────
    _det("a2-1",  "mock_A2.jpg", "apple", "ripe",     0.93, "A2", -248,  90,  430, 290),
    _det("a2-2",  "mock_A2.jpg", "apple", "ripe",     0.90, "A2", -255, 115,  455, 275),
    _det("a2-3",  "mock_A2.jpg", "apple", "ripe",     0.86, "A2", -240,  75,  470, 285),
    _det("a2-4",  "mock_A2.jpg", "apple", "unripe",   0.72, "A2", -262, 105,  440, 300),
    _det("a2-5",  "mock_A2.jpg", "apple", "unripe",   0.68, "A2", -252,  68,  460, 295),
    _det("a2-6",  "mock_A2.jpg", "apple", "overripe", 0.61, "A2", -245,  95,  445, 310),
    _det("a2-7",  "mock_A2.jpg", "apple", "ripe",     0.82, "A2", -258, 120,  435, 280),
    _det("a2-8",  "mock_A2.jpg", "apple", "ripe",     0.77, "A2", -243,  82,  465, 292, uncertain=True),

    # ── Tree A3  (Row A, z≈750) ───────────────────────────────────────────────
    _det("a3-1",  "mock_A3.jpg", "apple", "overripe", 0.84, "A3", -252,  88,  730, 285),
    _det("a3-2",  "mock_A3.jpg", "apple", "overripe", 0.78, "A3", -245, 112,  755, 295),
    _det("a3-3",  "mock_A3.jpg", "apple", "ripe",     0.65, "A3", -260,  72,  740, 300, uncertain=True),
    _det("a3-4",  "mock_A3.jpg", "apple", "unripe",   0.59, "A3", -238, 100,  765, 312),
    _det("a3-5",  "mock_A3.jpg", "apple", "overripe", 0.71, "A3", -255,  65,  745, 290),

    # ── Tree B1  (Row B, z≈150) ───────────────────────────────────────────────
    _det("b1-1",  "mock_B1.jpg", "apple", "ripe",     0.95, "B1",  248,  92,  135, 275),
    _det("b1-2",  "mock_B1.jpg", "apple", "ripe",     0.92, "B1",  258, 118,  150, 265),
    _det("b1-3",  "mock_B1.jpg", "apple", "ripe",     0.89, "B1",  242,  78,  165, 280),
    _det("b1-4",  "mock_B1.jpg", "apple", "ripe",     0.86, "B1",  252, 105,  145, 270),
    _det("b1-5",  "mock_B1.jpg", "apple", "unripe",   0.71, "B1",  260,  70,  155, 285),
    _det("b1-6",  "mock_B1.jpg", "apple", "ripe",     0.83, "B1",  245,  96,  160, 278),
    _det("b1-7",  "mock_B1.jpg", "apple", "unripe",   0.66, "B1",  255,  85,  140, 272),

    # ── Tree B2  (Row B, z≈450) ───────────────────────────────────────────────
    _det("b2-1",  "mock_B2.jpg", "apple", "ripe",     0.88, "B2",  250,  98,  435, 280),
    _det("b2-2",  "mock_B2.jpg", "apple", "unripe",   0.75, "B2",  242,  73,  450, 295),
    _det("b2-3",  "mock_B2.jpg", "apple", "unripe",   0.69, "B2",  260, 114,  465, 290),
    _det("b2-4",  "mock_B2.jpg", "apple", "ripe",     0.81, "B2",  248,  87,  445, 285, uncertain=True),
    _det("b2-5",  "mock_B2.jpg", "apple", "overripe", 0.64, "B2",  255, 102,  440, 300),

    # ── Tree B3  (Row B, z≈750) ───────────────────────────────────────────────
    _det("b3-1",  "mock_B3.jpg", "apple", "ripe",     0.90, "B3",  252,  91,  740, 270),
    _det("b3-2",  "mock_B3.jpg", "apple", "ripe",     0.87, "B3",  245, 116,  755, 282),
    _det("b3-3",  "mock_B3.jpg", "apple", "ripe",     0.84, "B3",  260,  76,  745, 275),
    _det("b3-4",  "mock_B3.jpg", "apple", "overripe", 0.73, "B3",  248, 108,  760, 288),
    _det("b3-5",  "mock_B3.jpg", "apple", "unripe",   0.62, "B3",  255,  69,  735, 295, uncertain=True),
    _det("b3-6",  "mock_B3.jpg", "apple", "ripe",     0.79, "B3",  242,  94,  750, 280),
    _det("b3-7",  "mock_B3.jpg", "apple", "ripe",     0.76, "B3",  258, 122,  770, 268),
]

# ── Located trees & rocks ─────────────────────────────────────────────────────
# Each item needs: id, image, label, confidence,
#   bbox {x, y, w, h}, position {x, y, z}, distanceCm

def _loc(uid, label, conf, x, z, dist, image="mock_locate.jpg"):
    tree_id = uid.replace("loc-", "", 1)
    if tree_id in TREE_CENTERS:
        x, z = TREE_CENTERS[tree_id]
        dist = TREE_DISTANCES.get(tree_id, dist)

    return {
        "id": uid,
        "image": image,
        "label": label,
        "confidence": conf,
        "bbox": {"x": 480.0, "y": 360.0, "w": 120.0, "h": 140.0},
        "position": {"x": x, "y": 0.0, "z": z},
        "distanceCm": dist,
    }

MOCK_TREES = [
    # Trees confirmed by the locator pass (will merge with detection clusters)
    _loc("loc-A1", "apple-tree", 0.91, -300, 160, 310),
    _loc("loc-A2", "apple-tree", 0.87, -300, 480, 290),
    _loc("loc-A3", "apple-tree", 0.88, -300, 800, 285),
    _loc("loc-B1", "apple-tree", 0.94,  300, 160, 275),
    _loc("loc-B2", "apple-tree", 0.86,  300, 480, 285),
    _loc("loc-B3", "apple-tree", 0.89,  300, 800, 270),

    # Standalone located items — no fruit cluster nearby
    _loc("loc-bush-1", "bush",  0.76,   30, 300, 340),
    _loc("loc-bush-2", "bush",  0.71, -100, 600, 380),

    # Rocks — rendered as standalone located items
    _loc("loc-rock-1", "rock",  0.83,  120, 200, 320, "mock_rock1.jpg"),
    _loc("loc-rock-2", "rock",  0.79, -180, 550, 360, "mock_rock2.jpg"),
    _loc("loc-rock-3", "rock",  0.68,   60, 820, 410, "mock_rock3.jpg"),
]
