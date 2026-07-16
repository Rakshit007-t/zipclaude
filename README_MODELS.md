# Model Asset Placement Guide

This repository snapshot does not commit large model weights. No `.pt`, `.pth`, `.ckpt`, `.safetensors`, or `.onnx` files were found in the tracked source tree, so Git LFS was not required for this export.

Place model assets here when running the application locally:

- `zipfin-backend/storage/upscaler/RealESRGAN_x2plus.pth`
- `zipfin-backend/storage/mediapipe_models/pose_landmarker_full.task`
- `zipfin-backend/storage/mediapipe_models/selfie_segmenter.tflite`

The backend code documents additional remote model sources and lazy-download behavior in `zipfin-backend/services/upscaler.py`, `zipfin-backend/services/measurement_service.py`, and `zipfin-backend/services/local_catvton_engine.py`.

If you later add large custom weights that must be shared with the repository, store them with Git LFS and update this file with the exact path and filename.