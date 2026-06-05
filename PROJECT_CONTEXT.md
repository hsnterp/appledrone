# Apple Drone Project - Contextual Overview

## Project Summary
A fruit detection and analysis system that uses drone-captured imagery combined with computer vision (YOLO via Roboflow API) to identify and classify fruits by type and ripeness. The system features a full-stack implementation with a Python Flask backend, SQLite database, and React dashboard for visualization.

**Project Name**: Pomona (displayed in UI)
**Main Use Case**: Automated fruit orchard monitoring using DJI Tello drone with ML-powered fruit detection

---

## Technology Stack

### Backend
- **Language**: Python 3.12+
- **Web Framework**: Flask with CORS support
- **Database**: SQLite3 (`data/fruits.db`)
- **Computer Vision**: Roboflow Inference SDK (YOLO-based workflow)
- **Drone Control**: djitellopy (DJI Tello drone SDK)
- **Dependencies**:
  - flask, flask-cors
  - inference-sdk (Roboflow)
  - djitellopy
  - python-dotenv
  - sqlite3 (built-in)

### Frontend
- **Framework**: React 19.2.0
- **Build Tool**: Create React App (react-scripts 5.0.1)
- **Charts**: Recharts 3.3.0
- **Icons**: Lucide React
- **Testing**: Jest, React Testing Library
- **Styling**: Inline CSS with Tailwind-style utility patterns

### Hardware
- **Drone**: DJI Tello
- **Connection**: WiFi-based control
- **Camera**: Tello built-in camera for image capture

---

## System Architecture

### Components Overview
```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  DJI Tello      │─────▶│  Python Backend  │─────▶│  SQLite DB      │
│  Drone          │      │  (Flask API)     │      │  (fruits.db)    │
└─────────────────┘      └──────────────────┘      └─────────────────┘
                                  │                          │
                                  │                          │
                                  ▼                          │
                         ┌─────────────────┐                │
                         │  Roboflow API   │                │
                         │  (YOLO Model)   │                │
                         └─────────────────┘                │
                                                             │
                                                             ▼
                         ┌─────────────────┐      ┌─────────────────┐
                         │  React          │◀─────│  Flask API      │
                         │  Dashboard      │      │  Endpoints      │
                         └─────────────────┘      └─────────────────┘
```

### Data Flow
1. **Capture**: Drone captures images → saved to `data/captures/`
2. **Detection**: Detection script reads images → sends to Roboflow API → receives predictions
3. **Processing**: Results simplified (handles multiple detections) → marked as certain/uncertain
4. **Storage**: Detections saved to SQLite database with session tracking
5. **Display**: React dashboard fetches data via Flask API → visualizes results

---

## Key Concepts & Features

### Fruit Detection Classes
The YOLO model detects 9 classes of fruits with ripeness states:
- **Apple**: ripe, unripe, overripe
- **Banana**: ripe, unripe, overripe
- **Mango**: ripe, unripe, overripe

Format: `{fruit_type}-{ripeness}` (e.g., "apple-ripe", "banana-overripe")

### Uncertainty Detection System
**Problem**: Multiple predictions on same object create ambiguity
**Solution**: Dual-prediction uncertainty classification

When multiple predictions exist for the same image:
- Calculate confidence difference between top predictions
- If difference < 30% (default threshold) → mark as **uncertain**
- Uncertain detections prefixed with "possible-" (e.g., "possible-apple-ripe")
- Linked detections tracked via `other_detection_id` field

**Database Fields for Uncertainty**:
- `is_uncertain` (BOOLEAN): Whether detection is below confidence threshold
- `final_classification` (TEXT): Either "{fruit}-{ripeness}" or "possible-{fruit}-{ripeness}"
- `linked_detection_id` (TEXT): ID of the competing detection

### Session-Based Tracking
Each detection run creates a unique session:
- **Session ID**: Auto-generated UUID
- **Purpose**: Group related detections, compare across time
- **Metadata**: Start time, total detections, optional notes
- **Dashboard**: Shows latest session by default

---

## Database Schema

### `detections` Table
```sql
CREATE TABLE detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    detection_id TEXT UNIQUE,           -- Roboflow detection UUID
    image_filename TEXT,                -- Source image file
    fruit_type TEXT,                    -- apple, banana, mango
    ripeness TEXT,                      -- ripe, unripe, overripe
    confidence REAL,                    -- 0.0 to 1.0
    has_multiple_predictions BOOLEAN,   -- Multiple classes detected
    linked_detection_id TEXT,           -- ID of competing detection
    is_uncertain BOOLEAN DEFAULT 0,     -- Confidence diff < threshold
    final_classification TEXT,          -- Final label with "possible-" prefix if uncertain
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    session_id TEXT                     -- Groups related detections
)
```

### `sessions` Table
```sql
CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    start_time DATETIME,
    end_time DATETIME,
    total_detections INTEGER,
    notes TEXT
)
```

---

## API Endpoints

### Base URL
```
http://localhost:5000/api
```

### Endpoints

#### `GET /api/health`
Health check endpoint
**Response**: `{ "status": "healthy" }`

#### `GET /api/sessions`
List all detection sessions
**Response**:
```json
[
  {
    "sessionId": "uuid-string",
    "startTime": "2025-01-15 14:30:00",
    "totalDetections": 42
  }
]
```

#### `GET /api/session/<session_id>/stats`
Get comprehensive stats for a specific session
**Response**:
```json
{
  "sessionId": "uuid-string",
  "fruitCounts": [
    { "name": "Apple", "value": 15 },
    { "name": "Banana", "value": 10 }
  ],
  "ripenessDistribution": [
    { "name": "Ripe", "value": 12 },
    { "name": "Unripe", "value": 8 },
    { "name": "Overripe", "value": 5 }
  ],
  "uncertainDetections": [
    {
      "id": "0",
      "image": "capture_001.jpg",
      "primaryClass": "possible-apple-ripe",
      "confidence": 0.55
    }
  ],
  "sessionStats": {
    "totalScanned": 25,
    "totalDetected": 25,
    "uncertainCount": 3
  }
}
```

#### `GET /api/fruit/<fruit_type>/ripeness`
Get ripeness breakdown for specific fruit (apple, banana, mango)
**Response**:
```json
{
  "ripe": 8,
  "unripe": 4,
  "overripe": 3,
  "total": 15
}
```

---

## File Structure

```
apple-drone/
├── app.py                          # Flask API server (main backend)
├── DRONE_WORKFLOW.md               # User workflow documentation
├── PROJECT_CONTEXT.md              # This file (Claude context)
│
├── database/
│   └── db_setup.py                 # FruitDatabase class (ORM layer)
│
├── models/
│   ├── drone_capture.py            # Tello drone image capture script
│   ├── detect_captures.py          # Run detection on captured images
│   └── test_model.py               # Test detection on sample images
│
├── data/
│   ├── captures/                   # Drone-captured images stored here
│   ├── test/                       # Sample images for development
│   ├── fruits.db                   # SQLite database
│   ├── detection_results.json      # Latest detection output (test images)
│   └── detection_results_captures.json  # Detection output (drone captures)
│
├── fruit-dashboard/                # React frontend application
│   ├── public/
│   │   ├── index.html
│   │   ├── appleanimation.mp4      # Fruit visualization videos
│   │   ├── bananaanimation.mp4
│   │   └── mangoanimation.mp4
│   ├── src/
│   │   ├── Dashboard.js            # Main dashboard component
│   │   ├── index.js
│   │   └── index.css
│   └── package.json
│
├── env/
│   └── .env                        # Environment variables (API_KEY for Roboflow)
│
└── venv312/                        # Python virtual environment (Python 3.12)
```

---

## Workflow Guide

### Standard Operating Procedure

#### 1. Capture Photos from Drone
```bash
python models/drone_capture.py
```
- Connect to Tello WiFi network first
- Options: single capture, batch capture (5 photos/2s intervals), custom batch
- Photos saved to: `data/captures/capture_SESSIONID_###_TIMESTAMP.jpg`

#### 2. Run Detection on Captures
```bash
python models/detect_captures.py
```
- Scans `data/captures/` for images
- Sends each to Roboflow YOLO workflow
- Simplifies multiple predictions per image
- Saves to database with uncertainty classification
- Outputs session summary to console

#### 3. Start Backend API
```bash
python app.py
```
- Runs on `http://0.0.0.0:5000`
- CORS enabled for localhost:3000
- Serves detection data from SQLite

#### 4. Launch Dashboard
```bash
cd fruit-dashboard
npm start
```
- Opens at `http://localhost:3000`
- Auto-fetches latest session
- Displays fruit counts, ripeness distribution, uncertain detections
- Interactive fruit-specific statistics with video animations

---

## Key Python Classes & Functions

### `FruitDatabase` (database/db_setup.py)

**Initialization**:
```python
db = FruitDatabase(db_path="data/fruits.db")
```

**Key Methods**:
- `save_detections(json_data, session_id, confidence_threshold=0.30)` - Save detection results with uncertainty logic
- `get_session_stats_with_uncertainty(session_id)` - Get stats including uncertain detections
- `get_uncertain_detections_detailed(session_id)` - Get all uncertain detections with details
- `get_ripeness_distribution(fruit_type)` - Get ripeness breakdown for specific fruit
- `get_all_sessions()` - List all sessions
- `print_session_summary(session_id)` - Human-readable session summary

### `simplify_apple_detection()` (models/detect_captures.py)

**Purpose**: Process Roboflow API response to handle multiple detections

**Logic**:
1. Group predictions by class
2. Keep only highest confidence per class
3. If multiple classes detected, link them via `other_detection_id`
4. Mark as `multiple_predictions: true`
5. Return list of simplified predictions

**Output Format**:
```python
[
  {
    'detection_id': 'uuid-1',
    'class_id': 0,
    'class': 'apple-ripe',
    'confidence': 0.85,
    'multiple_predictions': True,
    'other_detection_id': 'uuid-2'
  },
  {
    'detection_id': 'uuid-2',
    'class_id': 1,
    'class': 'apple-unripe',
    'confidence': 0.62,
    'multiple_predictions': True,
    'other_detection_id': 'uuid-1'
  }
]
```

---

## Configuration & Environment

### Required Environment Variables
Located in `env/.env`:
```bash
API_KEY=your_roboflow_api_key
```

### Roboflow Workflow Details
- **Workspace**: fruittest-oorql
- **Workflow ID**: custom-workflow-6
- **API URL**: https://serverless.roboflow.com
- **Model Type**: YOLO-based fruit detection + ripeness classification

### Flask Server Config
```python
# app.py
app.run(
    debug=True,
    host='0.0.0.0',  # Accessible from network
    port=5000
)

# CORS Configuration
CORS(app, resources={
    r"/api/*": {
        "origins": ["http://localhost:3000", "http://127.0.0.1:3000"]
    }
})
```

---

## Current Git Status

### Active Branch
- **Current**: `my-local-branch`
- **Main Branch**: `main`

### Recent Commits
1. `da5e1019` - Fix Flask server network binding and CORS configuration
2. `0ec9bfb9` - Update .gitignore to exclude Python cache, venv, and database files
3. `ce33b450` - Connect React dashboard to Flask API backend
4. `8d5b006c` - initial add

### Modified Files (Uncommitted)
- Backend: `app.py`, `database/db_setup.py`
- Frontend: `fruit-dashboard/src/Dashboard.js`, `fruit-dashboard/public/index.html`
- Data: `data/detection_results.json`, `data/fruits.db`
- Numerous venv files (should be gitignored)

---

## Development Notes

### Known Issues & Design Decisions

1. **Uncertainty Threshold**: Hard-coded to 30% confidence difference
   - Could be made configurable via API/UI in future

2. **Session Management**: Dashboard auto-selects latest session
   - No UI for browsing historical sessions yet

3. **Image Storage**: Captured images not served via API
   - Dashboard can't display thumbnails of uncertain detections

4. **Change Calculation**: `changeFromLastSession` always shows 0%
   - Needs implementation to compare consecutive sessions

5. **Virtual Environment**: venv312 folder tracked in git
   - Should be fully excluded via .gitignore

6. **Hard-coded Paths**: Some absolute paths exist (e.g., `/Users/hunter/Desktop/apple-drone/data/captures`)
   - Should use relative paths for portability

### Future Enhancements (from DRONE_WORKFLOW.md)

1. **Automated Flight Paths**: Script drone to follow pre-programmed routes
2. **Real-time Detection**: Process images during flight
3. **GPS Tagging**: Store location data with each capture
4. **Multi-session Comparison**: Trend analysis over time
5. **Manual Review UI**: Allow user to reclassify uncertain detections

---

## Testing & Development

### Test Scripts Available
- `test_db.py` - Database functionality tests
- `test_udp.py` - Tello UDP communication test
- `test_broadcast.py` - Network broadcast test
- `test_official_method.py` - Official Tello SDK method test

### Sample Test Data
Location: `data/test/`
- Contains sample fruit images for testing detection without drone

### Running Tests
```bash
# Test model on sample images
python models/test_model.py

# Test database operations
python test_db.py
```

---

## Troubleshooting

### Common Issues

**"No images found in captures folder"**
- Run `python models/drone_capture.py` first
- Verify images exist in `data/captures/`

**"Failed to connect to drone"**
- Power on Tello drone
- Connect to Tello WiFi (usually "TELLO-XXXXXX")
- Check battery level (should be >20%)

**"Failed to fetch session data" (Dashboard)**
- Ensure Flask server running: `python app.py`
- Check server is on `http://localhost:5000`
- Verify database has data: run detection script first

**CORS errors in browser**
- Check Flask CORS configuration in `app.py`
- Verify React dev server is on port 3000

**Low detection accuracy**
- Ensure good lighting conditions
- Maintain 1-2 meters distance from fruit
- Check image focus and clarity

---

## Quick Reference Commands

```bash
# Start Flask API
python app.py

# Start React Dashboard
cd fruit-dashboard && npm start

# Capture from Drone
python models/drone_capture.py

# Run Detection
python models/detect_captures.py

# Test Model
python models/test_model.py

# Database Location
data/fruits.db

# View Database
sqlite3 data/fruits.db
sqlite> SELECT * FROM sessions;
sqlite> SELECT * FROM detections WHERE is_uncertain = 1;
```

---

## UI/UX Details

### Dashboard Features
1. **Header**: Shows "Pomona" branding and current date
2. **Harvest Overview**: 3 stat cards (Total Fruits, Ripe Fruits, Uncertain Detections)
3. **Charts**:
   - Fruit Distribution (donut chart with percentages)
   - Ripeness Distribution (donut chart with counts)
4. **Fruit Details**: Carousel with video animations + ripeness breakdown bars
5. **Color Scheme**:
   - Apple: Red (#f87171)
   - Mango: Orange (#fb923c)
   - Banana: Yellow (#fde047)
   - Ripe: Green (#4ade80)
   - Unripe: Yellow (#facc15)
   - Overripe: Red (#f87171)

### Custom Styling
- Custom font class: `.trajan-header` (not defined in provided code)
- Responsive grid layouts (1 column mobile, 2-3 columns desktop)
- Shadow and border styling for depth

---

## Additional Context

This project represents a proof-of-concept for agricultural drone monitoring. The separation of capture and detection phases allows for flexible deployment scenarios (offline processing, batch analysis, etc.). The uncertainty classification system helps identify edge cases that may need human review, making the system practical for real-world orchard management.

The current implementation uses the Tello edu drone due to its accessible Python SDK, but the architecture could be adapted for more advanced agricultural drones with better cameras and flight capabilities.
