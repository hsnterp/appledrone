from database.db_setup import FruitDatabase
import json
import os

# Get the correct path relative to this script
script_dir = os.path.dirname(os.path.abspath(__file__))
json_path = os.path.join(script_dir, 'data', 'detection_results.json')

with open(json_path) as f:
    data = json.load(f)

db = FruitDatabase()

# Save with 30% threshold (default)
session_id = db.save_detections(data, session_id="test_session_002", confidence_threshold=0.30)

# Pretty summary
db.print_session_summary(session_id)

# Detailed uncertain detections
print("\n❓ Uncertain Detections Details:")
uncertain = db.get_uncertain_detections_detailed(session_id)
for filename, classification, confidence, linked_id in uncertain:
    print(f"  • {filename}: {classification} ({confidence:.1%})")