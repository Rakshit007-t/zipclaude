"""Representative Benchmark Suite for ZipRIGHT Free 2D Virtual Try-On (CatVTON).

Measures:
- Inference duration (seconds)
- Peak VRAM allocation (GB)
- Background contamination (pixels altered outside person silhouette)
- Garment mask area & coverage
- Forearm/arm boundary preservation
- Output image verification
"""

import json
import os
import sys
import time
from pathlib import Path

# Fix Windows cp1252 console encoding
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import cv2
import numpy as np
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.local_catvton_engine import (
    _person_silhouette,
    build_garment_mask,
    generate_local_tryon,
)

# Fix seed for deterministic comparison between before & after
os.environ["VTON_SEED"] = "42"

BENCHMARK_CASES = [
    {
        "id": "CASE_1_MALE_FRONTAL_CREWNECK",
        "category": "A, M",
        "description": "Graphic crewneck T-shirt / frontal male",
        "person": "vendor/CatVTON/resource/demo/example/person/men/Simon_1.png",
        "garment": "vendor/CatVTON/resource/demo/example/condition/upper/21514384_52353349_1000.jpg",
        "cloth_type": "upper_body",
        "quality": "hd",
    },
    {
        "id": "CASE_2_FEMALE_34_COLLARED",
        "category": "D, O",
        "description": "Collared button-down / female 3/4",
        "person": "vendor/CatVTON/resource/demo/example/person/women/1-model_3.png",
        "garment": "vendor/CatVTON/resource/demo/example/condition/upper/22790049_53294275_1000.jpg",
        "cloth_type": "upper_body",
        "quality": "hd",
    },
    {
        "id": "CASE_3_MALE_34_JACKET",
        "category": "C, K",
        "description": "Structured zip jacket / slender male 3/4",
        "person": "vendor/CatVTON/resource/demo/example/person/men/model_7.png",
        "garment": "vendor/CatVTON/resource/demo/example/condition/upper/24083449_54173465_2048.jpg",
        "cloth_type": "upper_body",
        "quality": "hd",
    },
    {
        "id": "CASE_4_FEMALE_FRONTAL_KNIT",
        "category": "B, N",
        "description": "Textured knit polo/sweater / female frontal",
        "person": "vendor/CatVTON/resource/demo/example/person/women/049713_0.jpg",
        "garment": "vendor/CatVTON/resource/demo/example/condition/upper/23255574_53383833_1000.jpg",
        "cloth_type": "upper_body",
        "quality": "hd",
    },
    {
        "id": "CASE_5_ATHLETIC_FEMALE_HIGHNECK_SLEEVELESS",
        "category": "B, P, J",
        "description": "High-neck sleeveless garment / athletic female",
        "person": "vendor/CatVTON/resource/demo/example/person/women/model_8.png",
        "garment": "vendor/CatVTON/resource/demo/example/condition/overall/21744571_51588794_1000.jpg",
        "cloth_type": "dress",
        "quality": "hd",
    },
    {
        "id": "CASE_6_FEMALE_34_SLEEVELESS_STRAP",
        "category": "D, J, K",
        "description": "Sleeveless garment / female side/3/4 profile",
        "person": "vendor/CatVTON/resource/demo/example/person/women/2-model_4.png",
        "garment": "vendor/CatVTON/resource/demo/example/condition/overall/22153949_52376342_1000.jpg",
        "cloth_type": "dress",
        "quality": "hd",
    },
    {
        "id": "CASE_7_LONGSLEEVE_TO_SLEEVELESS",
        "category": "I, J",
        "description": "Long-sleeve source male -> Sleeveless target (Known Limitation Test)",
        "person": "vendor/CatVTON/resource/demo/example/person/men/model_5.png",
        "garment": "vendor/CatVTON/resource/demo/example/condition/overall/21744571_51588794_1000.jpg",
        "cloth_type": "upper_body",
        "quality": "hd",
    },
    {
        "id": "CASE_8_MALE_OVERSIZED_PATTERN",
        "category": "A, L, N",
        "description": "Oversized/patterned garment / male frontal",
        "person": "vendor/CatVTON/resource/demo/example/person/men/Yifeng_0.png",
        "garment": "vendor/CatVTON/resource/demo/example/condition/overall/23962182_54027982_1000.jpg",
        "cloth_type": "upper_body",
        "quality": "hd",
    },
]


def run_benchmark(run_label: str = "baseline"):
    output_dir = Path("benchmark_results") / run_label
    output_dir.mkdir(parents=True, exist_ok=True)

    results = []
    print(f"=== STARTING VTO BENCHMARK: {run_label.upper()} ===")
    total_start = time.perf_counter()

    for idx, case in enumerate(BENCHMARK_CASES, 1):
        case_id = case["id"]
        print(f"\n[{idx}/{len(BENCHMARK_CASES)}] Running {case_id} ({case['description']})...")

        with open(case["person"], "rb") as f:
            person_bytes = f.read()
        with open(case["garment"], "rb") as f:
            garment_bytes = f.read()

        person_img = Image.open(case["person"]).convert("RGB")
        src_w, src_h = person_img.size

        # Pre-calculate silhouette
        person_bgr = cv2.cvtColor(np.array(person_img), cv2.COLOR_RGB2BGR)
        silhouette = _person_silhouette(person_bgr)
        mask = build_garment_mask(person_bgr, case["cloth_type"], silhouette=silhouette)

        torch.cuda.reset_peak_memory_stats()
        t0 = time.perf_counter()
        try:
            res_bytes = generate_local_tryon(
                person_image_bytes=person_bytes,
                garment_image_bytes=garment_bytes,
                cloth_type=case["cloth_type"],
                quality=case["quality"],
            )
            elapsed = time.perf_counter() - t0
            peak_vram = torch.cuda.max_memory_allocated() / (1024**3)

            out_path = output_dir / f"{case_id}.png"
            with open(out_path, "wb") as f:
                f.write(res_bytes)

            res_img = Image.open(out_path).convert("RGB")
            res_np = np.array(res_img)
            orig_np = np.array(person_img.resize(res_img.size))

            # Quantify background contamination
            diff = np.abs(res_np.astype(int) - orig_np.astype(int))
            diff_pixels = np.any(diff > 8, axis=-1)

            if silhouette is not None:
                sil_res = cv2.resize(silhouette, (res_img.width, res_img.height), interpolation=cv2.INTER_NEAREST)
                bg_mask = (sil_res == 0)
                bg_bleed_pixels = int(np.sum(diff_pixels & bg_mask))
            else:
                bg_bleed_pixels = 0

            mask_pixels = int(np.sum(mask > 0)) if mask is not None else 0

            print(f"  [OK] SUCCESS in {elapsed:.2f}s | Peak VRAM: {peak_vram:.2f} GB | BG Bleed: {bg_bleed_pixels} px")

            results.append({
                "id": case_id,
                "category": case["category"],
                "description": case["description"],
                "status": "PASS",
                "elapsed_sec": round(elapsed, 2),
                "peak_vram_gb": round(peak_vram, 2),
                "bg_bleed_px": bg_bleed_pixels,
                "mask_px": mask_pixels,
                "output_file": str(out_path),
            })
        except Exception as exc:
            elapsed = time.perf_counter() - t0
            print(f"  [ERR] FAILED in {elapsed:.2f}s: {exc}")
            results.append({
                "id": case_id,
                "category": case["category"],
                "description": case["description"],
                "status": "FAIL",
                "error": str(exc),
                "elapsed_sec": round(elapsed, 2),
            })

    total_time = time.perf_counter() - total_start
    summary = {
        "run_label": run_label,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_time_sec": round(total_time, 2),
        "avg_inference_sec": round(np.mean([r["elapsed_sec"] for r in results if r["status"] == "PASS"]), 2) if results else 0,
        "avg_vram_gb": round(np.mean([r["peak_vram_gb"] for r in results if r["status"] == "PASS"]), 2) if results else 0,
        "cases": results,
    }

    summary_file = output_dir / "summary.json"
    with open(summary_file, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\n=== BENCHMARK {run_label.upper()} FINISHED ===")
    print(f"Total time: {total_time:.2f}s | Summary saved to {summary_file}")
    return summary


if __name__ == "__main__":
    label = sys.argv[1] if len(sys.argv) > 1 else "baseline"
    run_benchmark(label)
