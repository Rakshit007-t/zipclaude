from __future__ import annotations

import unittest

import numpy as np

from services import measurement_service as measurements


class MeasurementCalibrationTests(unittest.TestCase):
    def test_reported_scan_anchor_corrects_legacy_overestimate(self) -> None:
        shoulder = (
            measurements.LEGACY_SCAN_OUTPUT_CM["shoulders"]
            * measurements.SHOULDER_SILHOUETTE_TO_TAPE_SCALE
        )
        chest_raw_without_old_padding = measurements.LEGACY_SCAN_OUTPUT_CM["chest"] / 1.15
        waist_raw_without_old_padding = measurements.LEGACY_SCAN_OUTPUT_CM["waist"] / 1.10

        chest = measurements._calibrated_ratio_measurement(
            chest_raw_without_old_padding,
            shoulder,
            measurements.CHEST_RATIO_CALIBRATION,
        )
        waist = measurements._calibrated_ratio_measurement(
            waist_raw_without_old_padding,
            shoulder,
            measurements.WAIST_RATIO_CALIBRATION,
        )
        arms_raw = measurements.LEGACY_SCAN_OUTPUT_CM["arms"] / 1.05
        legs_raw = measurements.LEGACY_SCAN_OUTPUT_CM["legs"] / 1.10
        arms = measurements._calibrated_linear_measurement(
            arms_raw,
            measurements.ARM_LENGTH_CALIBRATION,
        )
        legs = measurements._calibrated_linear_measurement(
            legs_raw,
            measurements.LEG_LENGTH_CALIBRATION,
        )

        self.assertAlmostEqual(shoulder, 47.0, delta=0.2)
        self.assertAlmostEqual(chest, 96.0, delta=0.5)
        self.assertAlmostEqual(waist, 88.0, delta=0.5)
        self.assertAlmostEqual(arms, 53.0, delta=0.8)
        self.assertAlmostEqual(legs, 84.0, delta=0.2)

    def test_current_scan_anchor_corrects_changed_person(self) -> None:
        shoulder = measurements.CURRENT_SCAN_OUTPUT_CM["shoulders"]
        chest_pre_calibrated = measurements.CURRENT_SCAN_OUTPUT_CM["chest"] / measurements.CHEST_OUTPUT_CALIBRATION
        waist_pre_calibrated = measurements.CURRENT_SCAN_OUTPUT_CM["waist"] / measurements.WAIST_OUTPUT_CALIBRATION
        chest_prior = shoulder * measurements.CHEST_TO_SHOULDER_RATIO
        waist_prior = shoulder * measurements.WAIST_TO_SHOULDER_RATIO
        chest_raw = (chest_pre_calibrated - (0.25 * chest_prior)) / 0.75
        waist_raw = (waist_pre_calibrated - (0.25 * waist_prior)) / 0.75
        arms_raw = measurements.CURRENT_SCAN_OUTPUT_CM["arms"] / measurements.ARM_LENGTH_SCALE
        legs_raw = measurements.CURRENT_SCAN_OUTPUT_CM["legs"] / measurements.LEG_LENGTH_SCALE

        chest = measurements._calibrated_ratio_measurement(
            chest_raw,
            shoulder,
            measurements.CHEST_RATIO_CALIBRATION,
        )
        waist = measurements._calibrated_ratio_measurement(
            waist_raw,
            shoulder,
            measurements.WAIST_RATIO_CALIBRATION,
        )
        arms = measurements._calibrated_linear_measurement(
            arms_raw,
            measurements.ARM_LENGTH_CALIBRATION,
        )
        legs = measurements._calibrated_linear_measurement(
            legs_raw,
            measurements.LEG_LENGTH_CALIBRATION,
        )

        self.assertAlmostEqual(chest, 90.0, delta=0.8)
        self.assertAlmostEqual(waist, 76.0, delta=0.8)
        self.assertAlmostEqual(arms, 53.0, delta=0.8)
        self.assertAlmostEqual(legs, 89.5, delta=0.5)

    def test_collapsed_torso_scan_uses_shoulder_based_floor(self) -> None:
        shoulder = 46.4
        chest = measurements._calibrated_ratio_measurement(
            68.0,
            shoulder,
            measurements.CHEST_RATIO_CALIBRATION,
        )
        waist = measurements._calibrated_ratio_measurement(
            52.0,
            shoulder,
            measurements.WAIST_RATIO_CALIBRATION,
        )

        self.assertAlmostEqual(chest, 90.0, delta=1.0)
        self.assertAlmostEqual(waist, 76.0, delta=1.0)

    def test_previous_bad_scan_does_not_poison_new_chest_and_waist(self) -> None:
        fresh_measurements = {
            "chest": 96.0,
            "waist": 88.0,
            "hips": 98.0,
            "shoulders": 47.0,
            "arms": 53.0,
            "legs": 84.0,
            "torso": 56.0,
            "bust": 96.0,
        }
        stale_bad_scan = {
            "chest": 74.2,
            "waist": 45.6,
            "hips": 72.0,
        }

        stabilized = measurements._stabilize_with_previous_scan(
            fresh_measurements,
            stale_bad_scan,
        )

        self.assertAlmostEqual(stabilized["chest"], 96.0, delta=0.01)
        self.assertAlmostEqual(stabilized["waist"], 88.0, delta=0.01)
        self.assertAlmostEqual(stabilized["hips"], 98.0, delta=0.01)
        self.assertAlmostEqual(stabilized["bust"], stabilized["chest"], delta=0.01)

    def test_previous_scan_only_smooths_small_repeat_scan_jitter(self) -> None:
        fresh_measurements = {
            "chest": 96.0,
            "waist": 88.0,
            "hips": 98.0,
            "shoulders": 47.0,
            "arms": 53.0,
            "legs": 84.0,
            "torso": 56.0,
            "bust": 96.0,
        }
        previous_repeat_scan = {
            "chest": 92.5,
            "waist": 84.5,
            "hips": 94.5,
        }

        stabilized = measurements._stabilize_with_previous_scan(
            fresh_measurements,
            previous_repeat_scan,
        )

        self.assertAlmostEqual(stabilized["chest"], 95.3, delta=0.01)
        self.assertAlmostEqual(stabilized["waist"], 87.3, delta=0.01)
        self.assertAlmostEqual(stabilized["hips"], 97.3, delta=0.01)
        self.assertAlmostEqual(stabilized["bust"], stabilized["chest"], delta=0.01)

    def test_broad_profile_uses_true_side_depth_for_chest_and_waist(self) -> None:
        scale_cm_per_px = 0.13720574297905525
        front_view = {
            "widths_px": {
                "shoulders": 274.0,
                "chest": 287.94,
                "waist": 258.15,
                "hips": 175.03,
            },
            "width_stats_px": {
                "chest": {"p45": 287.94},
                "waist": {"p40": 258.15},
                "hips": {"p50": 175.03},
            },
            "landmark_widths_px": {"shoulders": 248.22},
            "arm_length_px": None,
            "leg_length_px": None,
            "torso_length_px": 382.33,
        }
        side_view = {
            "depths_px": {
                "chest": 212.2,
                "waist": 214.0,
                "hips": 251.0,
            },
            "width_stats_px": {
                "chest": {"p30": 212.2},
                "waist": {"p25": 214.0},
                "hips": {"p35": 251.0},
            },
            "arm_length_px": None,
            "leg_length_px": None,
            "torso_length_px": 382.33,
        }

        result = measurements._extract_measurements(
            front_view=front_view,
            side_view=side_view,
            scale_cm_per_px=scale_cm_per_px,
            height_cm=166.5,
        )

        self.assertAlmostEqual(result["chest"], 107.0, delta=1.0)
        self.assertAlmostEqual(result["waist"], 92.0, delta=1.0)
        self.assertAlmostEqual(result["shoulders"], 43.8, delta=0.3)

    def test_side_profile_uses_silhouette_when_pose_landmarks_are_weak(self) -> None:
        image = np.full((420, 220, 3), 240, dtype=np.uint8)
        mask = np.zeros((420, 220), dtype=np.uint8)
        mask[35:400, 80:125] = 255
        silhouette = {
            "mask": mask,
            "bbox": (80, 35, 45, 365),
            "frame_ratio": float(np.count_nonzero(mask)) / float(mask.size),
        }
        weak_landmarks = [
            measurements._SyntheticLandmark(0.5, 0.5, visibility=0.0)
            for _ in range(33)
        ]

        original_extract_silhouette = measurements._extract_silhouette
        original_detect_pose = measurements._detect_pose
        try:
            measurements._extract_silhouette = lambda _: silhouette
            measurements._detect_pose = lambda *_args, **_kwargs: weak_landmarks
            view = measurements._analyze_view(image)
        finally:
            measurements._extract_silhouette = original_extract_silhouette
            measurements._detect_pose = original_detect_pose

        self.assertTrue(view["pose_fallback"])
        self.assertGreater(view["pixel_height"], 0)
        self.assertGreater(view["widths_px"]["chest"], 0)


if __name__ == "__main__":
    unittest.main()
