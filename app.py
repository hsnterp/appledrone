from flask import Flask, jsonify
from flask_cors import CORS
import sys
import os
import math

# Add parent directory to path to import database module
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from database.db_setup import FruitDatabase

app = Flask(__name__)
# Enable CORS for React frontend (allows requests from localhost:3000)
CORS(app, resources={r"/api/*": {"origins": ["http://localhost:3000", "http://127.0.0.1:3000"]}})

# Initialize database
db = FruitDatabase()

@app.route('/api/session/<session_id>/stats', methods=['GET'])
def get_session_stats(session_id):
    """Get overall session statistics"""
    try:
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
    # Tello stream resolution & focal length (from CLAUDE.md formula)
    IMG_W, IMG_H = 960, 720
    FOCAL_PX = 1850
    CX, CY = IMG_W / 2.0, IMG_H / 2.0
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
            # If we have bbox + distance, project via pinhole model.
            # Otherwise fall back to a stable golden-angle spiral so the map
            # always renders something non-overlapping.
            if bx is not None and bw is not None and dist:
                # bbox_x/bbox_y are box centers (both Roboflow and
                # LocateAnything store center coordinates).
                cx_px = bx
                cy_px = by if by is not None else CY
                x_cm = (cx_px - CX) / FOCAL_PX * dist
                y_cm = -((cy_px - CY) / FOCAL_PX * dist)
                z_cm = float(dist)
            else:
                angle = i * GOLDEN_ANGLE
                radius = 80 + (i % 6) * 30
                x_cm = radius * math.cos(angle)
                y_cm = 0.0
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
    IMG_W, IMG_H = 960, 720
    FOCAL_PX = 1850
    CX, CY = IMG_W / 2.0, IMG_H / 2.0
    GOLDEN_ANGLE = math.pi * 2 * (1 - 2 / (1 + math.sqrt(5)))

    try:
        rows = db.get_trees_for_session(session_id)
        trees = []
        for i, (tree_id, img, label, conf, bx, by, bw, bh, dist) in enumerate(rows):
            if bx is not None and bw is not None and dist:
                # bbox_x/bbox_y are box centers, same as the detections above.
                cx_px = bx
                cy_px = by if by is not None else CY
                x_cm = (cx_px - CX) / FOCAL_PX * dist
                y_cm = -((cy_px - CY) / FOCAL_PX * dist)
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

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy'})

if __name__ == '__main__':
    # Run on all interfaces (0.0.0.0) to allow connections from React dev server
    app.run(debug=True, host='0.0.0.0', port=5000)