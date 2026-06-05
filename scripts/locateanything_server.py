import base64
import io
import os
import sys

from fastapi import FastAPI
from PIL import Image
from pydantic import BaseModel

try:
    import torch
except ImportError:
    torch = None


locateanything_repo = os.getenv("LOCATEANYTHING_REPO")
if locateanything_repo:
    sys.path.insert(0, locateanything_repo)

from locateanything_worker import LocateAnythingWorker  # noqa: E402


MODEL_NAME = os.getenv("LOCATEANYTHING_MODEL", "nvidia/LocateAnything-3B")
MAX_IMAGE_SIDE = int(os.getenv("LOCATEANYTHING_MAX_IMAGE_SIDE", "1280"))

app = FastAPI()
worker = LocateAnythingWorker(MODEL_NAME)


class DetectRequest(BaseModel):
    image_filename: str
    image_base64: str
    labels: list[str]


def _resize_for_inference(image):
    if MAX_IMAGE_SIDE <= 0:
        return image

    width, height = image.size
    largest_side = max(width, height)
    if largest_side <= MAX_IMAGE_SIDE:
        return image

    scale = MAX_IMAGE_SIDE / largest_side
    resized_size = (round(width * scale), round(height * scale))
    return image.resize(resized_size, Image.Resampling.LANCZOS)


@app.post("/detect")
def detect(request: DetectRequest):
    image_bytes = base64.b64decode(request.image_base64)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    inference_image = _resize_for_inference(image)

    try:
        result = worker.detect(inference_image, request.labels)
    finally:
        if torch and torch.cuda.is_available():
            torch.cuda.empty_cache()

    return {
        "image_filename": request.image_filename,
        "image_width": image.width,
        "image_height": image.height,
        "inference_width": inference_image.width,
        "inference_height": inference_image.height,
        "answer": result.get("answer", ""),
    }
