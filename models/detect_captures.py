import os
import json
from dotenv import load_dotenv
from pathlib import Path
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database.db_setup import FruitDatabase
from models.locateanything_client import LocateAnythingClient

def calculate_distance_cm(bbox_w, bbox_h, fruit_type='apple', ripeness='ripe'):
    focal_length_px = 1850  # Tello camera approximate focal length
    real_diameters = {
        'apple':  {'ripe': 7.5, 'unripe': 5.5, 'overripe': 7.0},
        'banana': {'ripe': 3.5, 'unripe': 3.0, 'overripe': 4.0},
        'mango':  {'ripe': 8.0, 'unripe': 6.0, 'overripe': 8.5},
    }
    real_cm = real_diameters.get(fruit_type, {}).get(ripeness, 6.5)
    pixel_diameter = max(bbox_w or 0, bbox_h or 0)
    if pixel_diameter <= 0:
        return None
    return round((focal_length_px * real_cm) / pixel_diameter, 1)

def simplify_apple_detection(result):
    """
    Extract only the highest confidence prediction for each unique class.
    This helps address the issue of multiple detections of the same object.

    Args:
        result: The JSON result from the Roboflow API

    Returns:
        List of simplified dictionaries, one per unique class,
        or a single "no detection" entry if nothing was found
    """
    try:
        all_predictions = result[0]['predictions']['predictions']

        if not all_predictions:
            return [{
                "detection_id": None,
                "class_id": None,
                "class": "No detection",
                "confidence": 0.0,
                "multiple_predictions": False,
                "other_detection_id": None,
                "bbox_x": None,
                "bbox_y": None,
                "bbox_w": None,
                "bbox_h": None,
            }]

        class_to_best_prediction = {}

        for pred in all_predictions:
            class_name = pred['class']

            if class_name not in class_to_best_prediction or \
               pred['confidence'] > class_to_best_prediction[class_name]['confidence']:
                class_to_best_prediction[class_name] = pred

        best_predictions = list(class_to_best_prediction.values())

        best_predictions.sort(key=lambda x: x['confidence'], reverse=True)

        has_multiple = len(best_predictions) > 1

        simplified_predictions = []

        for i, pred in enumerate(best_predictions):
            other_detection_id = None
            if has_multiple and i < len(best_predictions) - 1:
                other_detection_id = best_predictions[i + 1]['detection_id']

            simplified_detection = {
                'detection_id': pred['detection_id'],
                'class_id': pred['class_id'],
                'class': pred['class'],
                'confidence': pred['confidence'],
                'multiple_predictions': has_multiple,
                'other_detection_id': other_detection_id,
                'bbox_x': pred.get('x'),
                'bbox_y': pred.get('y'),
                'bbox_w': pred.get('width'),
                'bbox_h': pred.get('height'),
            }

            simplified_predictions.append(simplified_detection)

        if has_multiple and len(simplified_predictions) > 1:
            simplified_predictions[-1]['other_detection_id'] = simplified_predictions[0]['detection_id']

        return simplified_predictions

    except (IndexError, KeyError) as e:
        return [{
            "detection_id": None,
            "class_id": -1,
            "class": "No detection",
            "confidence": 0.0,
            "multiple_predictions": False,
            "other_detection_id": None,
            "bbox_x": None,
            "bbox_y": None,
            "bbox_w": None,
            "bbox_h": None,
            "error_type": str(type(e).__name__),
            "error_detail": str(e)
        }]

load_dotenv()
env_path = Path(__file__).parent.parent / 'env' / '.env'
load_dotenv(dotenv_path=env_path)

detector_backend = os.getenv("DETECTOR_BACKEND", "locateanything").strip().lower()

if detector_backend == "roboflow":
    from inference_sdk import InferenceHTTPClient

    client = InferenceHTTPClient(
        api_url="https://serverless.roboflow.com",
        api_key=os.getenv("API_KEY")
    )
elif detector_backend == "locateanything":
    client = LocateAnythingClient()
else:
    raise ValueError("DETECTOR_BACKEND must be either 'locateanything' or 'roboflow'")

db = FruitDatabase()

project_root_path = Path(__file__).resolve().parent.parent
folder_path = os.getenv("CAPTURES_FOLDER") or str(project_root_path / "data" / "captures")

image_files = [f for f in os.listdir(folder_path) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]

if not image_files:
    print("No images found in the captures folder!")
    print(f"Folder checked: {folder_path}")
    print("\nPlease run the drone capture script first:")
    print("  python models/drone_capture.py")
    exit()

print(f"Found {len(image_files)} images to process in captures folder")
print("="*50)

all_results = {}

for image_file in image_files:
    image_path = os.path.join(folder_path, image_file)
    print(f"\nProcessing: {image_file}")

    try:
        if detector_backend == "roboflow":
            result = client.run_workflow(
                workspace_name="fruittest-oorql",
                workflow_id="custom-workflow-6",
                images={
                    "image": image_path
                },
                use_cache=False
            )
            simplified_results = simplify_apple_detection(result)
        else:
            simplified_results = client.detect_image(image_path)

        all_results[image_file] = simplified_results

        for i, pred in enumerate(simplified_results):
            if pred['class'] != "No detection":
                parts = pred['class'].split('-')
                fruit_type_p = parts[0] if len(parts) > 0 else 'apple'
                ripeness_p = parts[1] if len(parts) > 1 else 'ripe'
                dist = calculate_distance_cm(pred.get('bbox_w'), pred.get('bbox_h'), fruit_type_p, ripeness_p)
                dist_str = f" (~{dist} cm away)" if dist is not None else ""
                print(f"  ✓ Detected: {pred['class']} (confidence: {pred['confidence']:.2f}){dist_str}")
            else:
                print(f"  - No fruit detected")

    except Exception as e:
        print(f"  ✗ Error processing {image_file}: {str(e)}")
        all_results[image_file] = [{"error": str(e)}]

print("\n" + "="*50)
print("SAVING RESULTS")
print("="*50)

project_root = str(project_root_path / "data")
output_path = os.path.join(project_root, "detection_results_captures.json")

with open(output_path, "w") as f:
    json.dump(all_results, f, indent=2)

print(f"✓ Results saved to: {output_path}")

print("\nSaving to database...")
session_id = db.save_detections(all_results)
print(f"✓ Saved to database (Session ID: {session_id})")

print("\n" + "="*50)
print("SESSION SUMMARY")
print("="*50)
db.print_session_summary(session_id)

print(f"\n✓ Processing complete!")
print(f"   - Processed {len(image_files)} images")
print(f"   - Session ID: {session_id}")
print(f"\nView results in the dashboard:")
print(f"  cd fruit-dashboard && npm start")
