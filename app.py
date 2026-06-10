from flask import Flask, abort, jsonify, send_from_directory
from flask_cors import CORS
import sys
import os
import math
import struct

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from database.db_setup import FruitDatabase

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": ["http://localhost:3000", "http://127.0.0.1:3000"]}})

# ── Mock-data toggle ──────────────────────────────────────────────────────────
# Set to True to use hardcoded orchard data (trees, rocks, fruit) for UI dev.
# Set to False (or USE_MOCK_DATA=false env var) to use the real database.
USE_MOCK_DATA = os.environ.get("USE_MOCK_DATA", "false").lower() not in ("false", "0", "no")

if USE_MOCK_DATA:
    import sys as _sys
    _sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
    from mock_data import MOCK_SESSIONS, MOCK_DETECTIONS, MOCK_TREES, MOCK_SESSION_ID
    print("⚠️  Mock data mode ON — real database is not used")

db = FruitDatabase()

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_IMAGE_SIZE = (960, 720)
DEFAULT_FOCAL_PX = 1850
CANOPY_MIN_CM = 145.0
CANOPY_MAX_CM = 235.0
_IMAGE_SIZE_CACHE = {}


def _read_image_size(path):
    """Read PNG/JPEG dimensions without requiring Pillow at runtime."""
    with open(path, "rb") as f:
        header = f.read(24)
        if header.startswith(b"\x89PNG\r\n\x1a\n") and len(header) >= 24:
            return struct.unpack(">II", header[16:24])

        if not header.startswith(b"\xff\xd8"):
            return None

        f.seek(2)
        while True:
            marker_start = f.read(1)
            if not marker_start:
                return None
            if marker_start != b"\xff":
                continue

            marker = f.read(1)
            while marker == b"\xff":
                marker = f.read(1)
            if not marker:
                return None

            marker_code = marker[0]
            if marker_code in (0xD8, 0xD9):
                continue

            length_bytes = f.read(2)
            if len(length_bytes) != 2:
                return None
            segment_length = struct.unpack(">H", length_bytes)[0]

            if marker_code in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                segment = f.read(5)
                if len(segment) != 5:
                    return None
                height, width = struct.unpack(">HH", segment[1:5])
                return width, height

            f.seek(segment_length - 2, os.SEEK_CUR)


def get_image_size(image_file):
    if not image_file:
        return DEFAULT_IMAGE_SIZE
    if image_file in _IMAGE_SIZE_CACHE:
        return _IMAGE_SIZE_CACHE[image_file]

    candidates = []
    if os.path.isabs(image_file):
        candidates.append(image_file)
    else:
        candidates.extend([
            os.path.join(PROJECT_ROOT, "data", "captures", image_file),
            os.path.join(PROJECT_ROOT, "data", "test", image_file),
            os.path.join(PROJECT_ROOT, "data", image_file),
            os.path.join(PROJECT_ROOT, image_file),
        ])

    size = None
    for path in candidates:
        if os.path.exists(path):
            try:
                size = _read_image_size(path)
            except OSError:
                size = None
            if size:
                break

    _IMAGE_SIZE_CACHE[image_file] = size or DEFAULT_IMAGE_SIZE
    return _IMAGE_SIZE_CACHE[image_file]


def _fallback_canopy_y(index):
    steps = 6
    return CANOPY_MIN_CM + (index % (steps + 1)) * ((CANOPY_MAX_CM - CANOPY_MIN_CM) / steps)


def fruit_y_from_bbox(bbox_y, image_h, index):
    if bbox_y is None or not image_h:
        return _fallback_canopy_y(index)

    norm_y = max(0.0, min(1.0, float(bbox_y) / float(image_h)))
    return CANOPY_MAX_CM - norm_y * (CANOPY_MAX_CM - CANOPY_MIN_CM)


def project_horizontal_position(image_file, bbox_x, distance_cm):
    image_w, _ = get_image_size(image_file)
    center_x = image_w / 2.0
    focal_px = DEFAULT_FOCAL_PX * (image_w / DEFAULT_IMAGE_SIZE[0])
    return ((bbox_x - center_x) / focal_px) * distance_cm

@app.route('/api/session/<session_id>/stats', methods=['GET'])
def get_session_stats(session_id):
    """Get overall session statistics"""
    try:
        if USE_MOCK_DATA:
            dets = MOCK_DETECTIONS
            fruit_counts = {}
            ripeness_dist = {'Ripe': 0, 'Unripe': 0, 'Overripe': 0}
            uncertain_count = 0
            for d in dets:
                fruit_counts[d['fruitType']] = fruit_counts.get(d['fruitType'], 0) + 1
                if d['isUncertain']:
                    uncertain_count += 1
                else:
                    k = d['ripeness'].capitalize()
                    if k in ripeness_dist:
                        ripeness_dist[k] += 1
            return jsonify({
                'sessionId': session_id,
                'fruitCounts': [{'name': k.capitalize(), 'value': v} for k, v in fruit_counts.items()],
                'ripenessDistribution': [{'name': k, 'value': v} for k, v in ripeness_dist.items()],
                'uncertainDetections': [],
                'sessionStats': {
                    'totalScanned': len(dets),
                    'totalDetected': len(dets),
                    'uncertainCount': uncertain_count,
                },
            })

        stats = db.get_session_stats_with_uncertainty(session_id)
        
        # Process stats into structured format
        fruit_counts = {}
        ripeness_distribution = {'Ripe': 0, 'Unripe': 0, 'Overripe': 0}
        uncertain_count = 0
        
        for fruit_type, ripeness, is_uncertain, count, avg_conf in stats:
            # Count by fruit type
            if fruit_type not in fruit_counts:
                fruit_counts[fruit_type] = 0
            fruit_counts[fruit_type] += count
            
            # Count ripeness (only certain detections)
            if not is_uncertain:
                ripeness_key = ripeness.capitalize()
                if ripeness_key in ripeness_distribution:
                    ripeness_distribution[ripeness_key] += count
            
            # Count uncertain
            if is_uncertain:
                uncertain_count += count
        
        # Format for frontend
        fruit_counts_list = [
            {'name': fruit.capitalize(), 'value': count}
            for fruit, count in fruit_counts.items()
        ]
        
        ripeness_list = [
            {'name': key, 'value': value}
            for key, value in ripeness_distribution.items()
        ]
        
        # Get uncertain detections
        uncertain_detections = db.get_uncertain_detections_detailed(session_id)
        uncertain_list = [
            {
                'id': str(i),
                'image': img,
                'primaryClass': final_class,
                'confidence': conf
            }
            for i, (img, final_class, conf, _) in enumerate(uncertain_detections)
        ]
        
        # Calculate total detected
        total_detected = sum(fruit_counts.values())
        
        return jsonify({
            'sessionId': session_id,
            'fruitCounts': fruit_counts_list,
            'ripenessDistribution': ripeness_list,
            'uncertainDetections': uncertain_list,
            'sessionStats': {
                'totalScanned': total_detected,  # You might want to track this differently
                'totalDetected': total_detected,
                'uncertainCount': uncertain_count
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/fruit/<fruit_type>/ripeness', methods=['GET'])
def get_fruit_ripeness(fruit_type):
    """Get ripeness breakdown for a specific fruit"""
    try:
        results = db.get_ripeness_distribution(fruit_type.lower())
        
        ripeness_data = {
            'ripe': 0,
            'unripe': 0,
            'overripe': 0,
            'total': 0
        }
        
        for ripeness, count, avg_conf in results:
            ripeness_data[ripeness] = count
            ripeness_data['total'] += count
        
        return jsonify(ripeness_data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    """Get all sessions"""
    try:
        if USE_MOCK_DATA:
            return jsonify(MOCK_SESSIONS)
        sessions = db.get_all_sessions()
        sessions_list = [
            {
                'sessionId': session_id,
                'startTime': start_time,
                'totalDetections': total_detections
            }
            for session_id, start_time, total_detections in sessions
        ]
        return jsonify(sessions_list)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/session/<session_id>/detections', methods=['GET'])
def get_session_detections(session_id):
    if USE_MOCK_DATA:
        return jsonify({'detections': MOCK_DETECTIONS})

    GOLDEN_ANGLE = math.pi * 2 * (1 - 2 / (1 + math.sqrt(5)))

    try:
        detections = db.get_detections_for_session(session_id)
        result = []
        for i, (det_id, img, fruit, ripeness, conf, uncertain, classification,
                bx, by, bw, bh, dist) in enumerate(detections):
            # treeId: use image filename stem so all detections from the same
            # capture are grouped under one tree.
            tree_id = img.rsplit('.', 1)[0] if img else f'tree-{i // 4}'

            # 3D position relative to mission pad (cm).
            # If we have bbox + distance, project x via pinhole math.
            # The scene's y axis is ground-relative height, so bbox_y is
            # mapped into the procedural tree foliage band.
            # Otherwise fall back to a stable golden-angle spiral so the map
            # always renders something non-overlapping.
            if bx is not None and bw is not None and dist:
                _, image_h = get_image_size(img)
                x_cm = project_horizontal_position(img, bx, dist)
                y_cm = fruit_y_from_bbox(by, image_h, i)
                z_cm = float(dist)
            else:
                angle = i * GOLDEN_ANGLE
                radius = 80 + (i % 6) * 30
                x_cm = radius * math.cos(angle)
                y_cm = _fallback_canopy_y(i)
                z_cm = radius * math.sin(angle) + 250

            result.append({
                'id': det_id or f'det-{i}',
                'image': img,
                'fruitType': fruit,
                'ripeness': ripeness,
                'confidence': conf,
                'isUncertain': bool(uncertain),
                'classification': classification,
                'treeId': tree_id,
                'position': {'x': x_cm, 'y': y_cm, 'z': z_cm},
                'distanceCm': dist,
            })
        return jsonify({'detections': result})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/session/<session_id>/trees', methods=['GET'])
def get_session_trees(session_id):
    """Plant/tree landmarks located during a session, positioned relative
    to the Mission Pad with the same pinhole math as fruit detections."""
    if USE_MOCK_DATA:
        return jsonify({'trees': MOCK_TREES})

    GOLDEN_ANGLE = math.pi * 2 * (1 - 2 / (1 + math.sqrt(5)))

    try:
        rows = db.get_trees_for_session(session_id)
        trees = []
        for i, (tree_id, img, label, conf, bx, by, bw, bh, dist) in enumerate(rows):
            if bx is not None and bw is not None and dist:
                # bbox_x is a box center, same as the detections above.
                x_cm = project_horizontal_position(img, bx, dist)
                y_cm = 0.0
                z_cm = float(dist)
            else:
                # Deterministic golden-angle spread (wider ring than fruits)
                angle = i * GOLDEN_ANGLE
                radius = 200 + (i % 4) * 80
                x_cm = radius * math.cos(angle)
                y_cm = 0.0
                z_cm = radius * math.sin(angle) + 400

            trees.append({
                'id': str(tree_id) if tree_id is not None else f'tree-{i}',
                'image': img,
                'label': label,
                'confidence': conf if conf is not None else 0.0,
                'bbox': {
                    'x': bx if bx is not None else 0.0,
                    'y': by if by is not None else 0.0,
                    'w': bw if bw is not None else 0.0,
                    'h': bh if bh is not None else 0.0,
                },
                'position': {'x': x_cm, 'y': y_cm, 'z': z_cm},
                'distanceCm': dist,
            })
        return jsonify({'trees': trees})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/captures/<path:image_file>', methods=['GET'])
def get_capture_image(image_file):
    """Serve source drone photos referenced by detections/located trees."""
    safe_name = os.path.basename(image_file)
    if not safe_name or safe_name != image_file:
        abort(404)

    for folder in ("captures", "test"):
        directory = os.path.join(PROJECT_ROOT, "data", folder)
        candidate = os.path.join(directory, safe_name)
        if os.path.isfile(candidate):
            return send_from_directory(directory, safe_name)

    abort(404)

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy'})

if __name__ == '__main__':
    # Run on all interfaces (0.0.0.0) to allow connections from React dev server
    app.run(debug=True, host='0.0.0.0', port=5000)
