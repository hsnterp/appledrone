from djitellopy import Tello
import cv2
import os
import time
from datetime import datetime
import threading
import logging

class DroneCapture:

    def __init__(self, captures_folder="/Users/hunter/Desktop/apple-drone/data/captures"):
        """Initialize drone capture system"""
        self.captures_folder = captures_folder
        self.tello = None
        self.session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.capture_count = 0
        self.keepalive_thread = None
        self.keepalive_running = False
        self.is_flying = False
        self.stream_active = False
        self.mission_pad_enabled = False

        # Setup logging - redirect to file to prevent terminal blocking
        self.logger = logging.getLogger('DroneCapture')
        self.logger.setLevel(logging.INFO)

        # Log to file instead of terminal (prevents I/O blocking during landing)
        log_file = os.path.join(os.path.dirname(captures_folder), "drone_log.txt")
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(logging.Formatter('[%(asctime)s] %(levelname)s - %(message)s'))
        self.logger.addHandler(file_handler)

        # Only show critical errors in terminal
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.ERROR)
        console_handler.setFormatter(logging.Formatter('[%(levelname)s] %(message)s'))
        self.logger.addHandler(console_handler)

        # Ensure captures folder exists
        os.makedirs(self.captures_folder, exist_ok=True)

        print(f"Session ID: {self.session_id}")
        print(f"Captures will be saved to: {self.captures_folder}")

    def connect_drone(self):
        """Connect to Tello drone and start continuous video stream"""
        try:
            print("Connecting to Tello drone...")

            # Initialize Tello first
            self.tello = Tello()
            self.tello.RESPONSE_TIMEOUT = 10

            # Connect using djitellopy's method
            print("Sending connection command...")
            self.tello.connect()

            print("✓ Connected to drone!")

            # Give it a moment for state packets to start
            time.sleep(1)

            # Get battery level
            battery = self.tello.get_battery()
            print(f"✓ Battery: {battery}%")

            if battery < 10:
                print("⚠️  Warning: Low battery!")
                return False

            # Stream will be started on-demand to save battery
            print("✓ Ready (stream starts automatically when capturing)")

            # Start keepalive thread to prevent command timeouts and auto-landing
            self._start_keepalive()

            return True

        except Exception as e:
            print(f"✗ Failed to connect to drone: {e}")
            import traceback
            traceback.print_exc()
            return False

    def _keepalive_worker(self):
        """Send periodic commands to keep drone responsive and prevent auto-landing"""
        while self.keepalive_running:
            try:
                # Query battery to keep connection alive
                battery = self.tello.get_battery()
                self.logger.info(f"Keepalive - Battery: {battery}% | Flying: {self.is_flying}")

                # If flying, also send speed query to prevent auto-land
                # Speed query is safer than RC commands and prevents the 15-sec timeout
                if self.is_flying:
                    try:
                        speed = self.tello.query_speed()
                        self.logger.info(f"  Speed check: {speed} cm/s (prevents auto-land)")
                    except:
                        pass

                time.sleep(4)  # Check every 4 seconds when flying
            except Exception as e:
                self.logger.error(f"Keepalive failed: {e}")
                break

    def _start_keepalive(self):
        """Start background keepalive thread (handles both connection and anti-auto-land)"""
        if not self.keepalive_running:
            self.keepalive_running = True
            self.keepalive_thread = threading.Thread(target=self._keepalive_worker, daemon=True)
            self.keepalive_thread.start()
            print("✓ Keepalive thread started (prevents timeouts & auto-landing)")

    def _stop_keepalive(self):
        """Stop background keepalive thread"""
        if self.keepalive_running:
            self.keepalive_running = False
            if self.keepalive_thread:
                self.keepalive_thread.join(timeout=1)
            print("✓ Keepalive thread stopped")

    def _start_stream(self):
        """Start video stream if not already active"""
        if not self.stream_active:
            print("Starting video stream...")
            self.tello.streamon()
            time.sleep(2) 
            self.stream_active = True
            print("✓ Stream active")

    def _stop_stream(self):
        """Stop video stream to save battery"""
        if self.stream_active:
            print("Stopping stream to save battery...")
            self.tello.streamoff()
            self.stream_active = False
            print("✓ Stream stopped")

    def enable_mission_pads(self):
        """Enable Mission Pad detection. Requires Tello EDU (not standard Tello) and djitellopy >= 1.3."""
        try:
            self.tello.enable_mission_pads()
            self.tello.set_mission_pad_detection_direction(0)  # 0 = downward camera
            self.mission_pad_enabled = True
            print("✓ Mission Pad detection enabled (downward camera)")
            return True
        except Exception as e:
            print(f"⚠️  Mission Pad unavailable: {e}")
            print("   (Requires Tello EDU hardware, not standard Tello)")
            self.mission_pad_enabled = False
            return False

    def get_position(self):
        """Get XYZ position and yaw relative to the detected Mission Pad.
        Returns dict with pad_id, x_cm, y_cm, z_cm, yaw, or None if no pad detected.
        NOTE: Cannot be live-tested without physical Tello EDU hardware and a Mission Pad marker."""
        if not self.mission_pad_enabled:
            return None
        try:
            pad_id = self.tello.get_mission_pad_id()
            if pad_id < 0:  # -1 means no pad in view
                return None
            return {
                'pad_id': pad_id,
                'x_cm': self.tello.get_mission_pad_distance_x(),
                'y_cm': self.tello.get_mission_pad_distance_y(),
                'z_cm': self.tello.get_mission_pad_distance_z(),
                'yaw': self.tello.get_yaw(),
            }
        except Exception as e:
            self.logger.error(f"Position query failed: {e}")
            return None

    def capture_image(self, keep_stream_active=False):
        """Capture a single image from the drone

        Args:
            keep_stream_active: If True, keeps stream running after capture (useful for batch)
        """
        if not self.tello:
            print("Drone not connected!")
            return (None, None)

        try:

            if not self.stream_active:
                self._start_stream()
                time.sleep(1)

            # Query position before grabbing frame so coords are as current as possible
            position = self.get_position()
            frame = self.tello.get_frame_read().frame

            if frame is not None and len(frame.shape) == 3:
                frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

            self.capture_count += 1
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3] 
            filename = f"capture_{self.session_id}_{self.capture_count:03d}_{timestamp}.jpg"
            filepath = os.path.join(self.captures_folder, filename)

            cv2.imwrite(filepath, frame)
            print(f"✓ Captured: {filename}")

            if not keep_stream_active:
                self._stop_stream()

            return filepath, position
        except Exception as e:
            print(f"✗ Failed to capture image: {e}")
            return (None, None)

    def live_preview_mode(self):
        """Live camera preview with photo capture on 'p' key

        This is the RECOMMENDED mode for taking photos because:
        1. Continuous stream keeps white balance stable
        2. You can see exactly what you're capturing
        3. No color imbalance issues from stopping/starting stream
        """
        if not self.tello:
            print("Drone not connected!")
            return

        print("\n" + "="*50)
        print("LIVE PREVIEW MODE")
        print("="*50)
        print("Controls:")
        print("  p - Take photo")
        print("  q - Exit preview mode")
        print("="*50)
        print("Starting preview...\n")

        try:
            self._start_stream()

            frame_reader = self.tello.get_frame_read()

            while True:
                frame = frame_reader.frame

                if frame is not None and len(frame.shape) == 3:
                    frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

                cv2.imshow("Tello Camera - Press 'p' to capture, 'q' to quit", frame)

                key = cv2.waitKey(1) & 0xFF

                if key == ord('q'):
                    print("\nExiting preview mode...")
                    break
                elif key == ord('p'):
                    self.capture_count += 1
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
                    filename = f"capture_{self.session_id}_{self.capture_count:03d}_{timestamp}.jpg"
                    filepath = os.path.join(self.captures_folder, filename)

                    cv2.imwrite(filepath, frame)
                    print(f"✓ Captured: {filename}")
                    pos = self.get_position()
                    if pos is not None:
                        print(f"  📍 Position: x={pos['x_cm']}cm y={pos['y_cm']}cm z={pos['z_cm']}cm yaw={pos['yaw']}°")
                    time.sleep(0.3)

        except Exception as e:
            print(f"✗ Preview error: {e}")
        finally:
            cv2.destroyAllWindows()
            
            self._stop_stream()

    def batch_capture(self, num_captures=5, interval=2):
        """Capture multiple images at intervals

        Battery-optimized: Starts stream once, captures all images, then stops stream
        """
        print(f"\n📸 Starting batch capture: {num_captures} images, {interval}s interval")

        captured_files = []
        captured_positions = []

        try:
            for i in range(num_captures):
                print(f"\nCapture {i+1}/{num_captures}:")

                is_last_capture = (i == num_captures - 1)
                filepath, position = self.capture_image(keep_stream_active=not is_last_capture)

                if filepath:
                    captured_files.append(filepath)

                captured_positions.append(position)

                if position is not None:
                    print(f"  📍 Position: x={position['x_cm']}cm y={position['y_cm']}cm z={position['z_cm']}cm yaw={position['yaw']}°")

                if i < num_captures - 1:
                    print(f"  Waiting {interval}s...")
                    time.sleep(interval)

            print(f"\n✓ Batch capture complete! {len(captured_files)} images saved.")
            return captured_files, captured_positions
        finally:
            self._stop_stream()

    def emergency_land(self):
        """Emergency landing - sends land command multiple times"""
        if not self.tello:
            print("Drone not connected!")
            return

        print("🚨 EMERGENCY LANDING 🚨")
        for attempt in range(5):
            try:
                print(f"  Attempt {attempt + 1}/5...")
                self.tello.send_command_without_return("land")
                time.sleep(0.5)
            except:
                pass

        print("✓ Emergency land commands sent")

    def disconnect(self):
        """Disconnect from drone"""
        if self.tello:
            try:
                self.is_flying = False

                self._stop_keepalive()

                try:
                    print("Safety check: Attempting to land drone...")
                    self.tello.land()
                    time.sleep(3)
                except Exception as e:
                    if "unsuccessful" in str(e) or "error" in str(e) or "unknown command" in str(e):
                        print("  (Drone already on ground)")
                    else:
                        self.logger.error(f"Land error: {e}")

                if self.stream_active:
                    self._stop_stream()

                self.tello.end()
                print("\n✓ Drone disconnected")
            except Exception as e:
                self.logger.error(f"Disconnect error: {e}")


def keyboard_control_mode(drone_capture):
    """Keyboard control mode for flying the drone"""
    print("\n" + "="*50)
    print("KEYBOARD CONTROL MODE")
    print("="*50)
    print("Controls:")
    print("  w/s - Forward/Backward (50cm)")
    print("  a/d - Left/Right (50cm)")
    print("  e/q - Up/Down (50cm)")
    print("  j/l - Rotate Left/Right (30°)")
    print("  t   - Takeoff")
    print("  g   - Land")
    print("  !   - 🚨 EMERGENCY LAND 🚨")
    print("  c   - Capture photo")
    print("  x   - Exit keyboard mode")
    print("="*50)
    print("Waiting for commands...\n")

    while True:
        try:
            cmd = input("Command: ").strip().lower()

            if cmd == 'w':
                print("Moving forward 50cm...")
                drone_capture.tello.move_forward(50)
                print("✓")

            elif cmd == 's':
                print("Moving backward 50cm...")
                drone_capture.tello.move_back(50)
                print("✓")

            elif cmd == 'a':
                print("Moving left 50cm...")
                drone_capture.tello.move_left(50)
                print("✓")

            elif cmd == 'd':
                print("Moving right 50cm...")
                drone_capture.tello.move_right(50)
                print("✓")

            elif cmd == 'e':
                print("Moving up 50cm...")
                drone_capture.tello.move_up(50)
                print("✓")

            elif cmd == 'q':
                print("Moving down 50cm...")
                drone_capture.tello.move_down(50)
                print("✓")

            elif cmd == 'j':
                print("Rotating left 30°...")
                drone_capture.tello.rotate_counter_clockwise(30)
                print("✓")

            elif cmd == 'l':
                print("Rotating right 30°...")
                drone_capture.tello.rotate_clockwise(30)
                print("✓")

            elif cmd == 't':
                print("Taking off...")
                try:
                    drone_capture.tello.takeoff()
                    drone_capture.is_flying = True
                    print("✓ Drone in flight (auto-hover enabled)")
                except Exception as e:
                    print(f"❌ Takeoff failed: {e}")

            elif cmd == 'g':
                print("Landing...")
                try:
                    drone_capture.tello.land()
                    drone_capture.is_flying = False
                    print("✓ Drone landed")
                except Exception as e:
                    if "unsuccessful" in str(e) or "error" in str(e):
                        drone_capture.is_flying = False
                        print("⚠️  Drone already on ground")
                    else:
                        print(f"❌ Landing error: {e}")

            elif cmd == '!':
                drone_capture.emergency_land()

            elif cmd == 'c':
                print("📸 Capturing photo...")
                filepath, position = drone_capture.capture_image()
                if position is not None:
                    print(f"  📍 Position: x={position['x_cm']}cm y={position['y_cm']}cm z={position['z_cm']}cm yaw={position['yaw']}°")

            elif cmd == 'x':
                print("Exiting keyboard mode...")
                break

            else:
                print("❌ Invalid command! Use w/a/s/d/e/q/j/l/t/g/!/c/x")

        except Exception as e:
            print(f"❌ Error: {e}")


def main():
    """Main function with interactive menu"""
    drone_capture = DroneCapture()

    # Connect to drone
    if not drone_capture.connect_drone():
        print("Failed to connect to drone. Exiting...")
        return

    # Offer Mission Pad activation right after connect
    enable_mp = input("\nEnable Mission Pad tracking? (Tello EDU only) [y/N]: ").strip().lower()
    if enable_mp == 'y':
        drone_capture.enable_mission_pads()

    try:
        while True:
            print("\n" + "="*50)
            print("TELLO DRONE - PHOTO CAPTURE")
            print("="*50)
            print("1. 📹 Live Preview Mode (RECOMMENDED for best photos)")
            print("2. Keyboard control mode")
            print("3. Capture single photo")
            print("4. Batch capture (5 photos, 2s interval)")
            print("5. Custom batch capture")
            print("6. Takeoff")
            print("7. Land")
            print("8. 🚨 EMERGENCY LAND")
            print("9. Exit")
            print("="*50)

            choice = input("Select option: ").strip()

            if choice == "1":
                drone_capture.live_preview_mode()

            elif choice == "2":
                keyboard_control_mode(drone_capture)

            elif choice == "3":
                print("\n📸 Single capture mode")
                filepath, position = drone_capture.capture_image()
                if position is not None:
                    print(f"  📍 Position: x={position['x_cm']}cm y={position['y_cm']}cm z={position['z_cm']}cm yaw={position['yaw']}°")

            elif choice == "4":
                print("\n📸 Batch capture mode")
                captured_files, positions = drone_capture.batch_capture(num_captures=5, interval=2)
                print(f"\n📍 Captured {len([p for p in positions if p])} positions with Mission Pad")

            elif choice == "5":
                try:
                    num = int(input("Number of captures: "))
                    interval = float(input("Interval (seconds): "))
                    captured_files, positions = drone_capture.batch_capture(num_captures=num, interval=interval)
                    print(f"\n📍 Captured {len([p for p in positions if p])} positions with Mission Pad")
                except ValueError:
                    print("Invalid input!")

            elif choice == "6":
                print("Taking off...")
                try:
                    drone_capture.tello.takeoff()
                    drone_capture.is_flying = True
                    drone_capture.logger.info("Drone is now in FLYING mode - hover thread active")
                    print("✓ Drone in flight (auto-hover enabled)")
                except Exception as e:
                    drone_capture.logger.error(f"Takeoff failed: {e}")
                    print(f"❌ Takeoff failed: {e}")

            elif choice == "7":
                print("Landing...")
                try:
                    drone_capture.tello.land()
                    drone_capture.is_flying = False
                    drone_capture.logger.info("Drone landed - hover thread disabled")
                    print("✓ Drone landed")
                except Exception as e:
                    if "unsuccessful" in str(e) or "error" in str(e):
                        drone_capture.is_flying = False
                        print("⚠️  Drone already on ground")
                    else:
                        drone_capture.logger.error(f"Land error: {e}")
                        print(f"❌ Landing error: {e}")

            elif choice == "8":
                drone_capture.emergency_land()

            elif choice == "9":
                print("Exiting...")
                break

            else:
                print("Invalid choice!")

    except KeyboardInterrupt:
        print("\n\nInterrupted by user")

    finally:
        # Cleanup
        drone_capture.disconnect()
        print(f"\nTotal captures: {drone_capture.capture_count}")
        print(f"Session ID: {drone_capture.session_id}")
        print(f"\nNext step: Run detection on captures using:")
        print(f"  python models/detect_captures.py")


if __name__ == "__main__":
    main()
