# Drone Capture and Detection Workflow

This document explains how to capture photos from the Tello drone and run fruit detection on them.

## Overview

The workflow is split into two separate steps:

1. **Capture Phase**: Connect to drone and take photos → saved to `data/captures/`
2. **Detection Phase**: Run YOLO model on captured photos → results saved to database

This separation allows you to:
- Capture photos first, analyze later
- Easily implement automated flight paths in the future
- Review captured images before running detection
- Re-run detection on the same images with different settings

## Step 1: Capture Photos from Drone

### Prerequisites
- Tello drone powered on
- Connect your computer to the Tello WiFi network
- djitellopy package installed (`pip install djitellopy`)

### Run the capture script

```bash
python models/drone_capture.py
```

### Menu Options
1. **Capture single photo** - Take one photo
2. **Batch capture** - Take 5 photos with 2s intervals (default)
3. **Custom batch capture** - Specify number of photos and interval
4. **Takeoff** - Drone takes off (for testing flight)
5. **Land** - Drone lands
6. **Exit** - Disconnect and exit

### Output
- Photos saved to: `data/captures/`
- Filename format: `capture_SESSIONID_###_TIMESTAMP.jpg`
- Session ID format: `YYYYMMDD_HHMMSS`

## Step 2: Run Detection on Captured Photos

After capturing photos, run the detection model:

```bash
python models/detect_captures.py
```

### What it does
1. Scans `data/captures/` folder for all images
2. Runs YOLO fruit detection on each image
3. Saves results to:
   - JSON file: `data/detection_results_captures.json`
   - Database: `data/fruits.db`
4. Prints summary of detections

### Output
- Detection results with confidence scores
- Session summary showing:
  - Fruit types detected
  - Ripeness classification
  - Confidence levels
  - Uncertain detections

## Step 3: View Results in Dashboard

```bash
cd fruit-dashboard
npm start
```

Then open http://localhost:3000 in your browser.

## File Structure

```
apple-drone/
├── models/
│   ├── drone_capture.py      # Step 1: Capture photos from drone
│   ├── detect_captures.py    # Step 2: Run detection on captures
│   └── test_model.py          # Original: Run detection on test images
├── data/
│   ├── captures/              # Drone photos saved here
│   ├── test/                  # Test images for development
│   ├── fruits.db              # Detection database
│   └── detection_results_captures.json  # Latest detection results
└── database/
    └── db_setup.py            # Database schema and functions
```

## Future: Automated Flight Paths

The current implementation is designed to easily support automated flight paths:

```python
from models.drone_capture import DroneCapture

# Initialize drone
drone = DroneCapture()
drone.connect_drone()

# Take off
drone.tello.takeoff()

# Follow a path and capture at intervals
drone.tello.move_forward(50)
drone.capture_image()

drone.tello.rotate_clockwise(90)
drone.capture_image()

drone.tello.move_forward(50)
drone.capture_image()

# Land
drone.tello.land()
drone.disconnect()

# Then run detection on all captured images
# python models/detect_captures.py
```

## Tips

1. **Battery Check**: Always check battery level before flight (should be >20%)
2. **Test Connection**: Do a single capture first to verify everything works
3. **Lighting**: Ensure good lighting for better detection accuracy
4. **Distance**: Keep drone 1-2 meters from fruit for optimal detection
5. **Clear Folder**: Clear old captures if you want fresh results: `rm data/captures/*.jpg`

## Troubleshooting

### "No images found in captures folder"
- Run `drone_capture.py` first to capture photos
- Check that images are in `data/captures/`

### "Failed to connect to drone"
- Make sure Tello is powered on
- Connect to Tello WiFi network
- Tello network usually named "TELLO-XXXXXX"

### "Low battery warning"
- Charge the drone before continuing
- Don't fly with battery <20%

### Detection not finding fruit
- Check image quality (lighting, distance, focus)
- Verify captured images look good
- Try re-capturing with better positioning
