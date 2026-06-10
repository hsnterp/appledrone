import sqlite3
import json
from datetime import datetime
import uuid
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from models.fruit_catalog import calculate_distance_cm, calculate_plant_distance_cm

class FruitDatabase:
    def __init__(self, db_path="data/fruits.db"):
        if db_path is None:
            # Get absolute path to project root, then add data/fruits.db
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            db_path = os.path.join(project_root, "data", "fruits.db")
        
        self.db_path = db_path
        print(f"Database path: {self.db_path}")  # Debug line
        self.init_db()
    
    def init_db(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
            
        cursor.execute("""
                CREATE TABLE IF NOT EXISTS detections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    detection_id TEXT UNIQUE,
                    image_filename TEXT,
                    fruit_type TEXT,
                    ripeness TEXT,
                    confidence REAL,
                    has_multiple_predictions BOOLEAN,
                    linked_detection_id TEXT,
                    is_uncertain BOOLEAN DEFAULT 0,  -- NEW
                    final_classification TEXT,        -- NEW: "apple-ripe" or "possible-apple-ripe"
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    session_id TEXT
                )
            """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                start_time DATETIME,
                end_time DATETIME,
                total_detections INTEGER,
                notes TEXT
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS trees (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                image TEXT,
                label TEXT,
                confidence REAL,
                bbox_x REAL,
                bbox_y REAL,
                bbox_w REAL,
                bbox_h REAL,
                distance_cm REAL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.commit()

        # Migration: add new columns if they don't already exist
        migrations = [
            "ALTER TABLE detections ADD COLUMN bbox_x REAL",
            "ALTER TABLE detections ADD COLUMN bbox_y REAL",
            "ALTER TABLE detections ADD COLUMN bbox_w REAL",
            "ALTER TABLE detections ADD COLUMN bbox_h REAL",
            "ALTER TABLE detections ADD COLUMN distance_cm REAL",
        ]
        for migration in migrations:
            try:
                cursor.execute(migration)
            except sqlite3.OperationalError:
                pass  # Column already exists
        conn.commit()

        conn.close()

    def save_detections(self, json_data, session_id=None, confidence_threshold=0.30):
        """
        Save detections with uncertainty logic:
        - If confidence difference < 30%, mark as "possible"
        - Otherwise use higher confidence prediction
        """
        if session_id is None:
            session_id = str(uuid.uuid4())
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Track which detections we've already processed (for linked pairs)
        processed_ids = set()
        
        for image_file, detections in json_data.items():
            for detection in detections:
                # Skip if this detection is an error
                if 'error' in detection:
                    continue

                if detection['class'] == 'No detection':
                    continue

                # Plant/tree landmarks go to the trees table, not detections
                if detection.get('category') == 'plant':
                    self._insert_tree(cursor, session_id, image_file, detection)
                    continue

                detection_id = detection['detection_id']

                # Skip if already processed as part of a pair
                if detection_id in processed_ids:
                    continue

                fruit_type, sep, ripeness = detection['class'].rpartition('-')
                if not sep:
                    fruit_type, ripeness = detection['class'], 'ripe'
                confidence = detection['confidence']
                has_multiple = detection['multiple_predictions']
                
                is_uncertain = False
                final_classification = f"{fruit_type}-{ripeness}"
                
                # Handle uncertain cases
                if has_multiple and detection['other_detection_id']:
                    # Find the linked detection
                    linked_detection = None
                    for det in detections:
                        if det['detection_id'] == detection['other_detection_id']:
                            linked_detection = det
                            break
                    
                    if linked_detection:
                        linked_confidence = linked_detection['confidence']
                        confidence_diff = abs(confidence - linked_confidence)
                        
                        # If difference < 30%, mark as uncertain
                        if confidence_diff < confidence_threshold:
                            is_uncertain = True
                            final_classification = f"possible-{fruit_type}-{ripeness}"
                        
                        # Mark both as processed
                        processed_ids.add(detection_id)
                        processed_ids.add(detection['other_detection_id'])
                
                bbox_x = detection.get('bbox_x')
                bbox_y = detection.get('bbox_y')
                bbox_w = detection.get('bbox_w')
                bbox_h = detection.get('bbox_h')
                distance_cm = calculate_distance_cm(bbox_w, bbox_h, fruit_type, ripeness)

                cursor.execute("""
                    INSERT OR IGNORE INTO detections
                    (detection_id, image_filename, fruit_type, ripeness,
                    confidence, has_multiple_predictions, linked_detection_id,
                    is_uncertain, final_classification, session_id,
                    bbox_x, bbox_y, bbox_w, bbox_h, distance_cm)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    detection_id,
                    image_file,
                    fruit_type,
                    ripeness,
                    confidence,
                    has_multiple,
                    detection['other_detection_id'],
                    is_uncertain,
                    final_classification,
                    session_id,
                    bbox_x,
                    bbox_y,
                    bbox_w,
                    bbox_h,
                    distance_cm,
                ))

        # Count total detections for this session
        cursor.execute("""
            SELECT COUNT(*) FROM detections WHERE session_id = ?
        """, (session_id,))
        total_detections = cursor.fetchone()[0]

        # Insert or update session record
        cursor.execute("""
            INSERT OR REPLACE INTO sessions (session_id, start_time, total_detections)
            VALUES (?, ?, ?)
        """, (session_id, datetime.now(), total_detections))

        conn.commit()
        conn.close()
        return session_id

    @staticmethod
    def _insert_tree(cursor, session_id, image_file, detection):
        """Insert a plant/tree landmark detection into the trees table."""
        label = detection.get('label') or detection.get('class') or 'plant'
        bbox_w = detection.get('bbox_w')
        bbox_h = detection.get('bbox_h')
        distance_cm = detection.get('distance_cm')
        if distance_cm is None:
            distance_cm = calculate_plant_distance_cm(bbox_w, bbox_h, label)

        cursor.execute("""
            INSERT OR IGNORE INTO trees
            (id, session_id, image, label, confidence,
             bbox_x, bbox_y, bbox_w, bbox_h, distance_cm)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            detection.get('detection_id') or str(uuid.uuid4()),
            session_id,
            image_file,
            label,
            detection.get('confidence'),
            detection.get('bbox_x'),
            detection.get('bbox_y'),
            bbox_w,
            bbox_h,
            distance_cm,
        ))

    def save_tree(self, session_id, image_file, detection):
        """Save a single plant/tree landmark detection for a session."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        self._insert_tree(cursor, session_id, image_file, detection)
        conn.commit()
        conn.close()

    def get_trees_for_session(self, session_id):
        """Get all plant/tree landmarks located during a session."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, image, label, confidence,
                   bbox_x, bbox_y, bbox_w, bbox_h, distance_cm
            FROM trees WHERE session_id = ?
            ORDER BY created_at, id
        """, (session_id,))
        results = cursor.fetchall()
        conn.close()
        return results

    def get_session_stats(self, session_id):
        """Get stats for a specific session"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT fruit_type, ripeness, COUNT(*), AVG(confidence)
            FROM detections
            WHERE session_id = ?
            GROUP BY fruit_type, ripeness
        """, (session_id,))
        
        results = cursor.fetchall()
        conn.close()
        return results

    def get_all_detections(self, limit=100):
        """Get recent detections"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM detections 
            ORDER BY timestamp DESC 
            LIMIT ?
        """, (limit,))
        
        results = cursor.fetchall()
        conn.close()
        return results

    def get_ripe_fruits(self, fruit_type=None):
        """Get all ripe fruits, optionally filter by type"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        if fruit_type:
            cursor.execute("""
                SELECT * FROM detections 
                WHERE ripeness = 'ripe' AND fruit_type = ?
                ORDER BY confidence DESC
            """, (fruit_type,))
        else:
            cursor.execute("""
                SELECT * FROM detections 
                WHERE ripeness = 'ripe'
                ORDER BY confidence DESC
            """)
        
        results = cursor.fetchall()
        conn.close()
        return results
    
    def get_uncertain_detections(self):
        """Get detections where model was uncertain (multiple predictions)"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM detections 
            WHERE has_multiple_predictions = 1
            ORDER BY confidence DESC
        """)
        
        results = cursor.fetchall()
        conn.close()
        return results
    
    def get_fruit_breakdown(self):
        """Get counts by fruit type"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT fruit_type, COUNT(*) as count
            FROM detections
            GROUP BY fruit_type
            ORDER BY count DESC
        """)
        
        results = cursor.fetchall()
        conn.close()
        return results
    
    def get_ripeness_distribution(self, fruit_type):
        """Get ripeness breakdown for a specific fruit"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT ripeness, COUNT(*), AVG(confidence)
            FROM detections
            WHERE fruit_type = ?
            GROUP BY ripeness
        """, (fruit_type,))
        
        results = cursor.fetchall()
        conn.close()
        return results
    
    def get_all_sessions(self):
        """List all sessions"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT session_id, start_time, total_detections
            FROM sessions
            ORDER BY start_time DESC
        """)

        results = cursor.fetchall()
        conn.close()
        return results

    def get_detections_for_session(self, session_id):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT detection_id, image_filename, fruit_type, ripeness,
                   confidence, is_uncertain, final_classification,
                   bbox_x, bbox_y, bbox_w, bbox_h, distance_cm
            FROM detections WHERE session_id = ?
            ORDER BY confidence DESC
        """, (session_id,))
        results = cursor.fetchall()
        conn.close()
        return results
    def get_session_stats_with_uncertainty(self, session_id):
        """Get stats including uncertain detections"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT 
                fruit_type, 
                ripeness, 
                is_uncertain,
                COUNT(*), 
                AVG(confidence)
            FROM detections
            WHERE session_id = ?
            GROUP BY fruit_type, ripeness, is_uncertain
            ORDER BY fruit_type, ripeness
        """, (session_id,))
        
        results = cursor.fetchall()
        conn.close()
        return results

    def get_certain_vs_uncertain_counts(self, session_id):
        """Get breakdown of certain vs uncertain detections"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT 
                CASE WHEN is_uncertain = 1 THEN 'Uncertain' ELSE 'Certain' END as category,
                COUNT(*) as count
            FROM detections
            WHERE session_id = ?
            GROUP BY is_uncertain
        """, (session_id,))
        
        results = cursor.fetchall()
        conn.close()
        return results

    def get_uncertain_detections_detailed(self, session_id=None):
        """Get all uncertain detections with details"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        if session_id:
            cursor.execute("""
                SELECT 
                    image_filename,
                    final_classification,
                    confidence,
                    linked_detection_id
                FROM detections
                WHERE is_uncertain = 1 AND session_id = ?
                ORDER BY confidence DESC
            """, (session_id,))
        else:
            cursor.execute("""
                SELECT 
                    image_filename,
                    final_classification,
                    confidence,
                    linked_detection_id
                FROM detections
                WHERE is_uncertain = 1
                ORDER BY confidence DESC
            """)
        
        results = cursor.fetchall()
        conn.close()
        return results
    
    def print_session_summary(self, session_id):
        """Human-readable session summary"""
        stats = self.get_session_stats_with_uncertainty(session_id)
        
        print(f"\n📊 Session {session_id} Summary:\n")
        
        for fruit_type, ripeness, is_uncertain, count, avg_conf in stats:
            prefix = "possible" if is_uncertain else ""
            certainty = " (uncertain)" if is_uncertain else ""
            
            if prefix:
                print(f"  • {count} {prefix} {ripeness} {fruit_type}(s){certainty} - {avg_conf:.1%} avg confidence")
            else:
                print(f"  • {count} {ripeness} {fruit_type}(s) - {avg_conf:.1%} avg confidence")
        
        # Show uncertain breakdown
        uncertain_counts = self.get_certain_vs_uncertain_counts(session_id)
        print("\n🔍 Certainty Breakdown:")
        for category, count in uncertain_counts:
            print(f"  • {category}: {count}")