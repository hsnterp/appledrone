from inference_sdk import InferenceHTTPClient
import os
import json
from dotenv import load_dotenv
from pathlib import Path

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
        # Check if we have any predictions
        all_predictions = result[0]['predictions']['predictions']
        
        # If no predictions were found
        if not all_predictions:
            return [{
                "detection_id": None,
                "class_id": None,
                "class": "No detection",
                "confidence": 0.0,
                "multiple_predictions": False,
                "other_detection_id": None
            }]
        
        # Group predictions by class and keep only the highest confidence for each
        class_to_best_prediction = {}
        
        for pred in all_predictions:
            class_name = pred['class']
            
            # If we haven't seen this class yet, or this prediction has higher confidence
            if class_name not in class_to_best_prediction or \
               pred['confidence'] > class_to_best_prediction[class_name]['confidence']:
                class_to_best_prediction[class_name] = pred
        
        # Get the best predictions for each class
        best_predictions = list(class_to_best_prediction.values())
        
        # Sort by confidence (highest first)
        best_predictions.sort(key=lambda x: x['confidence'], reverse=True)
        
        # Check if there are multiple classes detected
        has_multiple = len(best_predictions) > 1
        
        # Create simplified predictions
        simplified_predictions = []
        
        for i, pred in enumerate(best_predictions):
            # Find other detection IDs (if any)
            other_detection_id = None
            if has_multiple and i < len(best_predictions) - 1:
                # Use the next best prediction's ID
                other_detection_id = best_predictions[i + 1]['detection_id']
            
            simplified_detection = {
                'detection_id': pred['detection_id'],
                'class_id': pred['class_id'],
                'class': pred['class'],
                'confidence': pred['confidence'],
                'multiple_predictions': has_multiple,
                'other_detection_id': other_detection_id
            }
            
            simplified_predictions.append(simplified_detection)
        
        # For the last prediction, link back to the first if there are multiple
        if has_multiple and len(simplified_predictions) > 1:
            simplified_predictions[-1]['other_detection_id'] = simplified_predictions[0]['detection_id']
        
        return simplified_predictions
    
    except (IndexError, KeyError) as e:
        # If there was an error extracting predictions
        return [{
            "detection_id": None,
            "class_id": -1,
            "class": "No detection",
            "confidence": 0.0,
            "multiple_predictions": False,
            "other_detection_id": None,
            "error_type": str(type(e).__name__),
            "error_detail": str(e)
        }]

# 2. Connect to your workflow
    
load_dotenv()
env_path = Path(__file__).parent.parent / 'env' / '.env'
load_dotenv(dotenv_path=env_path)

client = InferenceHTTPClient(
    api_url="https://serverless.roboflow.com",
    api_key=os.getenv("API_KEY")
)

folder_path = "/Users/hunter/Desktop/apple-drone/data/test"
image_files = [f for f in os.listdir(folder_path) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
all_results = {}

# 3. Run your workflow on an image
for image_file in image_files:
    image_path = os.path.join(folder_path, image_file)
    print(f"Processing: {image_path}")
    
    try:
        # Run workflow using direct path approach
        result = client.run_workflow(
            workspace_name="fruittest-oorql",
            workflow_id="custom-workflow-6",
            images={
                "image": image_path
            },
            use_cache=True
        )
        
        # Get simplified results (now a list)
        simplified_results = simplify_apple_detection(result)
        
        # Store all predictions for this image
        all_results[image_file] = simplified_results
        
        # Print progress
        for i, pred in enumerate(simplified_results):
            print(f"  Prediction {i+1}: {pred['class']} ({pred['confidence']:.2f})")
    
    except Exception as e:
        print(f"  Error processing {image_file}: {str(e)}")
        # Store the error in the results
        all_results[image_file] = [{"error": str(e)}]

# Save all results to a JSON file
project_root = os.path.dirname(folder_path)

output_path = os.path.join(project_root, "detection_results.json")
with open(output_path, "w") as f:
    json.dump(all_results, f, indent=2)

print(f"\nProcessing complete! Results saved to: {output_path}")
print(f"Processed {len(image_files)} images.")
print(f"Summary of results: {all_results}")