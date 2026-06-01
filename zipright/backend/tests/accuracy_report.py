from __future__ import annotations

import csv
import math
from pathlib import Path


def load_ground_truth(path: str | Path) -> list[dict[str, str]]:
    with Path(path).open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def summarize_errors(rows: list[dict[str, str]], measurement_names: list[str]) -> dict[str, dict[str, float]]:
    report: dict[str, dict[str, float]] = {}
    for measurement in measurement_names:
        abs_errors: list[float] = []
        sq_errors: list[float] = []
        within_1 = 0
        within_2 = 0
        for row in rows:
            ground_truth_key = f"{measurement}_gt"
            predicted_key = f"{measurement}_pred"
            if not row.get(ground_truth_key) or not row.get(predicted_key):
                continue
            delta = float(row[predicted_key]) - float(row[ground_truth_key])
            abs_delta = abs(delta)
            abs_errors.append(abs_delta)
            sq_errors.append(delta * delta)
            within_1 += int(abs_delta <= 1.0)
            within_2 += int(abs_delta <= 2.0)
        if not abs_errors:
            continue
        count = len(abs_errors)
        report[measurement] = {
            "mae": sum(abs_errors) / count,
            "rmse": math.sqrt(sum(sq_errors) / count),
            "within_1cm": within_1 / count,
            "within_2cm": within_2 / count,
            "count": float(count),
        }
    return report


if __name__ == "__main__":
    ground_truth_path = Path(__file__).resolve().parents[2] / "data" / "ground_truth.csv"
    rows = load_ground_truth(ground_truth_path)
    metrics = summarize_errors(rows, ["chest", "waist", "hip", "shoulder_width", "inseam"])
    print(metrics)
