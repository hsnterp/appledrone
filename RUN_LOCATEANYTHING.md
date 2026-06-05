# Run LocateAnything On Thunder

Use this checklist when running detection on the real images in `data/captures/`.

## 1. Start Or Connect To Thunder

From your Mac:

```bash
tnr status --no-wait
tnr connect 1
```

If your instance ID is not `1`, use the ID shown by `tnr status --no-wait`.

## 2. Start The VM Server

Run this inside the Thunder VM:

```bash
cd ~/appledrone
git pull origin main
source .venv/bin/activate

export LOCATEANYTHING_REPO=~/Eagle/Embodied
export LOCATEANYTHING_MODEL=nvidia/LocateAnything-3B
export LOCATEANYTHING_MAX_IMAGE_SIDE=1024

python -m uvicorn scripts.locateanything_server:app --host 0.0.0.0 --port 8000
```

Leave this terminal running. Wait until it says:

```text
Uvicorn running on http://0.0.0.0:8000
```

If CUDA runs out of memory, stop the server with `CTRL+C`, then restart with:

```bash
export LOCATEANYTHING_MAX_IMAGE_SIDE=768
```

## 3. Forward Port 8000

From a separate Mac terminal:

```bash
tnr ports forward 1 --add 8000
tnr ports list
```

The service URL should look like:

```text
https://6x02hkam-8000.thundercompute.net
```

Test it:

```bash
curl -i https://6x02hkam-8000.thundercompute.net/docs
```

## 4. Run Detection From The Mac

From your Mac:

```bash
cd /Users/hunter/Desktop/apple-drone
git pull origin main

export DETECTOR_BACKEND=locateanything
export LOCATEANYTHING_ENDPOINT=https://6x02hkam-8000.thundercompute.net
export LOCATEANYTHING_TIMEOUT=600

python3.11 models/detect_captures.py
```

Results are saved to:

```text
data/detection_results_captures.json
data/fruits.db
```

## 5. View Results

From your Mac:

```bash
cd /Users/hunter/Desktop/apple-drone/fruit-dashboard
npm start
```

## 6. Push New Captures Or Results

If you changed the images in `data/captures/`:

```bash
cd /Users/hunter/Desktop/apple-drone
git add data/captures
git commit -m "Update capture images"
git push origin main
```

Do not commit `.DS_Store`, `data/fruits.db`, or generated result files unless you intentionally want them in Git.

## 7. Stop Spending On Thunder

Exiting the VM shell does not pause billing. To stop GPU runtime costs, create a snapshot, then delete the instance.

From your Mac:

```bash
tnr status --no-wait
tnr snapshot create --instance-id 1 --name apple-drone-locateanything
tnr delete 1
```

Restore from the snapshot next time you need the VM.
