import base64
import io
import os
import sys

from fastapi import FastAPI
from PIL import Image
from pydantic import BaseModel


locateanything_repo = os.getenv("LOCATEANYTHING_REPO")
if locateanything_repo:
    sys.path.insert(0, locateanything_repo)

from locateanything_worker import LocateAnythingWorker  # noqa: E402


MODEL_NAME = os.getenv("LOCATEANYTHING_MODEL", "nvidia/LocateAnything-3B")

app = FastAPI()
worker = LocateAnythingWorker(MODEL_NAME)


class DetectRequest(BaseModel):
    image_filename: str
    image_base64: str
    labels: list[str]


@app.post("/detect")
def detect(request: DetectRequest):
    image_bytes = base64.b64decode(request.image_base64)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    result = worker.detect(image, request.labels)

    return {
        "image_filename": request.image_filename,
        "image_width": image.width,
        "image_height": image.height,
        "answer": result.get("answer", ""),
    }
