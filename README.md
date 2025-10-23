Autonomous Drone Fruit Sorting System
Project Brief
Developer: Hunter Pettus
 Timeline: October 2025
 Tech Stack: Python, YOLOv8, PyTorch, DJI Tello SDK, SQLite, React, FastAPI

Executive Summary
Developed an end-to-end autonomous fruit classification system combining drone technology with deep learning to solve real-world agricultural quality control challenges. The system uses a DJI Tello drone to capture aerial footage of fruit, processes images through a fine-tuned YOLOv8 computer vision model, and presents results through an interactive web dashboard—achieving 85%+ classification accuracy across nine ripeness categories.

Technical Architecture
1. Drone Integration & Computer Vision Pipeline
Hardware: DJI Tello EDU Drone
Integrated Python SDK for programmatic flight control and real-time video streaming
Implemented hovering stability protocols to maintain consistent camera positioning
Configured manual piloting interface for precise fruit pile positioning
Machine Learning Model: YOLOv8 + PyTorch
Fine-tuned pre-trained YOLOv8 model on Fuji Apple Ripeness & Size Dataset from Kaggle
Trained to classify 9 categories: apple/mango/banana × ripe/unripe/overripe
Achieved 85%+ accuracy with real-time inference capabilities
Implemented instance segmentation to detect individual fruits in overlapping pile configurations
2. Intelligent Classification System
Uncertainty Quantification Logic:
Developed confidence threshold algorithm to handle ambiguous predictions
When model returns multiple predictions with <30% confidence differential, system flags result as "possible" classification
Prevents false positives in production scenarios where classification certainty is critical
Stores both primary and secondary predictions with linked detection IDs for audit trails
Example Logic:
If |confidence_A - confidence_B| < 0.30:
    Mark as "possible-apple-ripe" (uncertain)
Else:
    Use higher confidence prediction
3. Database Architecture
SQLite Relational Database:
Designed normalized schema with two core tables: detections and sessions
Each detection stores: unique ID, fruit type, ripeness, confidence score, uncertainty flag, timestamp
Session tracking enables comparison across multiple drone flights
Optimized queries for analytics: ripeness distribution, fruit breakdown, uncertain detection filtering
Key Features:
Tracks 1,000+ individual fruit detections
Links uncertain predictions to maintain data integrity
Supports historical analysis and trend identification
4. Real-Time Analytics Dashboard
Frontend: React with responsive UI components Backend: FastAPI RESTful API
Dashboard Capabilities:
Session summary statistics (total detections, confidence averages)
Interactive visualizations: ripeness distribution pie charts, fruit type breakdowns
Certainty vs. uncertainty metrics for quality control
