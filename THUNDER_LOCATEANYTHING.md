# Thunder LocateAnything Setup

This repo already has the client/server split needed to run LocateAnything on a GPU VM and send local capture images to it.

## What Is Already Wired

- VM/server entrypoint: `scripts/locateanything_server.py`
- Local client: `models/locateanything_client.py`
- Batch runner: `models/detect_captures.py`
- Existing test images: `data/captures/` has 40 images, and `data/test/` has 1 image

`models/detect_captures.py` defaults to the LocateAnything backend and sends each image to `LOCATEANYTHING_ENDPOINT`.

## Start LocateAnything On Thunder

On the Thunder VM, install or clone the LocateAnything project so that it provides `locateanything_worker.py` with `LocateAnythingWorker`.

Then copy or clone this `apple-drone` repo onto the VM and run:

```bash
cd /path/to/apple-drone
export LOCATEANYTHING_REPO=/path/to/LocateAnything
export LOCATEANYTHING_MODEL=nvidia/LocateAnything-3B
python -m pip install fastapi uvicorn pillow pydantic
python -m uvicorn scripts.locateanything_server:app --host 0.0.0.0 --port 8000
```

Expected result: Uvicorn listens on `0.0.0.0:8000`. The first request may be slow while the model loads.

## Connect From This Machine

If Thunder exposes port `8000` publicly, set:

```bash
export DETECTOR_BACKEND=locateanything
export LOCATEANYTHING_ENDPOINT=http://THUNDER_VM_IP:8000
python models/detect_captures.py
```

If you connect through SSH, use a local tunnel:

```bash
ssh -L 8000:127.0.0.1:8000 USER@THUNDER_VM_IP
```

Then, in another terminal from this repo:

```bash
export DETECTOR_BACKEND=locateanything
export LOCATEANYTHING_ENDPOINT=http://127.0.0.1:8000
python models/detect_captures.py
```

## Outputs

The batch runner will:

- scan `data/captures/`
- write `data/detection_results_captures.json`
- save a session into `data/fruits.db`
- print a session summary

To test another folder without changing code:

```bash
CAPTURES_FOLDER=/path/to/images python models/detect_captures.py
```

## Current Gap

This repo does not include `locateanything_worker.py` or the upstream LocateAnything model code. The Thunder VM needs that repo/code installed separately, and `LOCATEANYTHING_REPO` must point to it before starting `scripts.locateanything_server`.
