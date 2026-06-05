import base64
import json
import os
import re
import ssl
import urllib.error
import urllib.request
import uuid

try:
    import certifi
except ImportError:
    certifi = None


DEFAULT_LABELS = [
    "ripe apple",
    "unripe apple",
    "overripe apple",
    "ripe banana",
    "unripe banana",
    "overripe banana",
    "ripe mango",
    "unripe mango",
    "overripe mango",
]


def _label_to_class(label):
    parts = label.strip().lower().replace("_", " ").split()
    ripeness_words = {"ripe", "unripe", "overripe"}
    ripeness = next((part for part in parts if part in ripeness_words), "ripe")
    fruit = next((part for part in parts if part not in ripeness_words), "apple")
    return f"{fruit}-{ripeness}"


def _parse_labels_from_env():
    raw = os.getenv("LOCATEANYTHING_LABELS")
    if not raw:
        return DEFAULT_LABELS
    return [label.strip() for label in raw.split(",") if label.strip()]


def _parse_box_answer(answer, image_width=None, image_height=None):
    detections = []
    pattern = re.compile(
        r"(?:<ref>(?P<label>.*?)</ref>)?<box><(?P<x1>\d+)><(?P<y1>\d+)><(?P<x2>\d+)><(?P<y2>\d+)></box>"
    )

    for match in pattern.finditer(answer or ""):
        label = match.group("label") or "fruit"
        x1, y1, x2, y2 = [int(match.group(name)) for name in ("x1", "y1", "x2", "y2")]

        if image_width and image_height:
            x1_px = x1 / 1000 * image_width
            y1_px = y1 / 1000 * image_height
            x2_px = x2 / 1000 * image_width
            y2_px = y2 / 1000 * image_height
        else:
            x1_px, y1_px, x2_px, y2_px = x1, y1, x2, y2

        detections.append({
            "detection_id": str(uuid.uuid4()),
            "class_id": None,
            "class": _label_to_class(label),
            "confidence": 1.0,
            "multiple_predictions": False,
            "other_detection_id": None,
            "bbox_x": round((x1_px + x2_px) / 2, 2),
            "bbox_y": round((y1_px + y2_px) / 2, 2),
            "bbox_w": round(abs(x2_px - x1_px), 2),
            "bbox_h": round(abs(y2_px - y1_px), 2),
        })

    return detections


class LocateAnythingClient:
    def __init__(self, endpoint=None, timeout=180):
        self.endpoint = (endpoint or os.getenv("LOCATEANYTHING_ENDPOINT") or "").rstrip("/")
        self.timeout = int(os.getenv("LOCATEANYTHING_TIMEOUT", timeout))
        self.ssl_context = self._build_ssl_context()
        self.labels = _parse_labels_from_env()

        if not self.endpoint:
            raise ValueError(
                "LOCATEANYTHING_ENDPOINT is required when DETECTOR_BACKEND=locateanything"
            )

    @staticmethod
    def _build_ssl_context():
        if os.getenv("LOCATEANYTHING_INSECURE_SSL", "").lower() in {"1", "true", "yes"}:
            return ssl._create_unverified_context()
        if certifi:
            return ssl.create_default_context(cafile=certifi.where())
        return ssl.create_default_context()

    def detect_image(self, image_path):
        with open(image_path, "rb") as image_file:
            image_base64 = base64.b64encode(image_file.read()).decode("ascii")

        payload = {
            "image_filename": os.path.basename(image_path),
            "image_base64": image_base64,
            "labels": self.labels,
        }
        request = urllib.request.Request(
            f"{self.endpoint}/detect",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(
                request,
                timeout=self.timeout,
                context=self.ssl_context,
            ) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"LocateAnything HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Could not reach LocateAnything endpoint: {exc}") from exc

        if "detections" in data:
            return data["detections"] or self.no_detection()

        parsed = _parse_box_answer(
            data.get("answer"),
            image_width=data.get("image_width"),
            image_height=data.get("image_height"),
        )
        return parsed or self.no_detection()

    @staticmethod
    def no_detection():
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
