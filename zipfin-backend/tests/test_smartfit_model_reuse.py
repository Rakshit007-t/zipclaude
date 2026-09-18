from __future__ import annotations

import math
import threading
import time
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from services import measurement_service as ms


@pytest.fixture(autouse=True)
def reset_smartfit_models():
    """Ensure all models are cleaned up before and after each test."""
    ms.cleanup_models()
    yield
    ms.cleanup_models()


# ============================================================================
# A. Lazy Initialization Tests
# ============================================================================

def test_models_are_none_initially():
    """Verify that importing the module does not instantiate models and holders start as None."""
    assert ms._SOLUTIONS_POSE is None
    assert ms._SOLUTIONS_SEGMENTER is None
    assert ms._POSE_TASK is None
    assert ms._SEGMENTER_TASK is None


def test_first_getter_creates_model():
    """Verify that the first call to the getter creates the model lazily."""
    mock_pose_instance = MagicMock()
    mock_pose_cls = MagicMock(return_value=mock_pose_instance)
    mock_pose_module = MagicMock()
    mock_pose_module.Pose = mock_pose_cls

    with patch.object(ms, "POSE", mock_pose_module):
        assert ms._SOLUTIONS_POSE is None
        inst = ms._get_solutions_pose()
        assert inst is mock_pose_instance
        assert mock_pose_cls.call_count == 1
        assert ms._SOLUTIONS_POSE is mock_pose_instance


# ============================================================================
# B. Instance Reuse Tests
# ============================================================================

def test_solutions_pose_getter_reuses_exact_same_instance():
    """Verify repeated getter calls return the exact same instance."""
    mock_pose_instance = MagicMock()
    mock_pose_cls = MagicMock(return_value=mock_pose_instance)
    mock_pose_module = MagicMock()
    mock_pose_module.Pose = mock_pose_cls

    with patch.object(ms, "POSE", mock_pose_module):
        inst1 = ms._get_solutions_pose()
        inst2 = ms._get_solutions_pose()
        assert inst1 is inst2
        assert inst1 is mock_pose_instance
        assert mock_pose_cls.call_count == 1


def test_sequential_inference_does_not_recreate_model():
    """Verify sequential inference calls reuse the initialized model without recreating it."""
    mock_pose_instance = MagicMock()
    res = MagicMock()
    res.pose_landmarks = MagicMock()
    res.pose_landmarks.landmark = [MagicMock() for _ in range(33)]
    mock_pose_instance.process.return_value = res

    mock_pose_cls = MagicMock(return_value=mock_pose_instance)
    mock_pose_module = MagicMock()
    mock_pose_module.Pose = mock_pose_cls

    with patch.object(ms, "POSE", mock_pose_module):
        dummy_img = np.zeros((100, 100, 3), dtype=np.uint8)

        # Call 1
        ms._detect_pose(dummy_img)
        assert mock_pose_cls.call_count == 1
        assert mock_pose_instance.process.call_count == 1
        # Crucial: .close() must NOT be called on reusable instance
        assert mock_pose_instance.close.call_count == 0

        # Call 2
        ms._detect_pose(dummy_img)
        assert mock_pose_cls.call_count == 1
        assert mock_pose_instance.process.call_count == 2
        assert mock_pose_instance.close.call_count == 0


def test_solutions_segmenter_getter_and_inference_reuse():
    """Verify solutions segmenter getter and inference reuse instance across calls."""
    mock_seg_instance = MagicMock()
    mask = np.zeros((100, 100), dtype=np.float32)
    mask[20:80, 20:80] = 1.0
    res = MagicMock()
    res.segmentation_mask = mask
    mock_seg_instance.process.return_value = res

    mock_seg_cls = MagicMock(return_value=mock_seg_instance)
    mock_seg_module = MagicMock()
    mock_seg_module.SelfieSegmentation = mock_seg_cls

    with patch.object(ms, "SELFIE_SEGMENTATION", mock_seg_module):
        dummy_img = np.zeros((100, 100, 3), dtype=np.uint8)

        # Call 1
        ms._extract_silhouette(dummy_img)
        assert mock_seg_cls.call_count == 1
        assert mock_seg_instance.process.call_count == 1
        assert mock_seg_instance.close.call_count == 0

        # Call 2
        ms._extract_silhouette(dummy_img)
        assert mock_seg_cls.call_count == 1
        assert mock_seg_instance.process.call_count == 2
        assert mock_seg_instance.close.call_count == 0


# ============================================================================
# C. Failure Isolation Tests
# ============================================================================

def test_initialization_failure_leaves_holder_as_none_and_falls_back():
    """Verify that initialization failure returns None, leaves holder None, and allows fallback."""
    mock_pose_cls = MagicMock(side_effect=RuntimeError("CUDA out of memory"))
    mock_pose_module = MagicMock()
    mock_pose_module.Pose = mock_pose_cls

    fallback_landmarks = [MagicMock() for _ in range(33)]

    with patch.object(ms, "POSE", mock_pose_module), \
         patch.object(ms, "_detect_pose_with_tasks", return_value=fallback_landmarks) as mock_tasks:
        dummy_img = np.zeros((100, 100, 3), dtype=np.uint8)
        result = ms._detect_pose(dummy_img)

        # Holder remains None
        assert ms._SOLUTIONS_POSE is None
        # Tasks fallback was called
        mock_tasks.assert_called_once()
        assert result == fallback_landmarks


def test_later_successful_initialization_can_recover():
    """Verify that after a transient initialization failure, a later call can recover."""
    mock_pose_instance = MagicMock()
    mock_pose_cls = MagicMock(side_effect=[RuntimeError("Temporary init error"), mock_pose_instance])
    mock_pose_module = MagicMock()
    mock_pose_module.Pose = mock_pose_cls

    with patch.object(ms, "POSE", mock_pose_module):
        # First call fails and returns None
        inst1 = ms._get_solutions_pose()
        assert inst1 is None
        assert ms._SOLUTIONS_POSE is None

        # Second call succeeds and caches the new instance
        inst2 = ms._get_solutions_pose()
        assert inst2 is mock_pose_instance
        assert ms._SOLUTIONS_POSE is mock_pose_instance
        assert mock_pose_cls.call_count == 2


def test_inference_failure_resets_instance_and_falls_back():
    """Verify that if an inference call raises an unexpected error, the corrupted instance is closed and reset."""
    mock_pose_instance = MagicMock()
    mock_pose_instance.process.side_effect = RuntimeError("Internal graph corruption")
    mock_pose_module = MagicMock()
    mock_pose_module.Pose.return_value = mock_pose_instance

    fallback_landmarks = [MagicMock() for _ in range(33)]

    with patch.object(ms, "POSE", mock_pose_module), \
         patch.object(ms, "_detect_pose_with_tasks", return_value=fallback_landmarks) as mock_tasks:
        dummy_img = np.zeros((100, 100, 3), dtype=np.uint8)
        result = ms._detect_pose(dummy_img)

        # Result came from tasks fallback
        assert result == fallback_landmarks
        mock_tasks.assert_called_once()
        # Corrupted instance was closed and reset
        mock_pose_instance.close.assert_called_once()
        assert ms._SOLUTIONS_POSE is None


# ============================================================================
# D. Concurrency Safety Tests
# ============================================================================

def test_concurrent_pose_inference_serialized_by_lock():
    """Verify that concurrent threads calling _detect_pose do not overlap .process() execution."""
    active_inferences = 0
    max_concurrent_inferences = 0
    lock = threading.Lock()

    def thread_safe_process(rgb_image):
        nonlocal active_inferences, max_concurrent_inferences
        with lock:
            active_inferences += 1
            if active_inferences > max_concurrent_inferences:
                max_concurrent_inferences = active_inferences
        time.sleep(0.02)
        with lock:
            active_inferences -= 1
        res = MagicMock()
        res.pose_landmarks = MagicMock()
        res.pose_landmarks.landmark = [MagicMock() for _ in range(33)]
        return res

    mock_pose_instance = MagicMock()
    mock_pose_instance.process.side_effect = thread_safe_process
    mock_pose_module = MagicMock()
    mock_pose_module.Pose.return_value = mock_pose_instance

    with patch.object(ms, "POSE", mock_pose_module):
        dummy_img = np.zeros((100, 100, 3), dtype=np.uint8)
        errors = []

        def worker():
            try:
                ms._detect_pose(dummy_img)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        assert max_concurrent_inferences == 1
        assert mock_pose_instance.process.call_count == 8


def test_concurrent_segmenter_inference_serialized_by_lock():
    """Verify that concurrent threads calling _extract_silhouette do not overlap .process() execution."""
    active_inferences = 0
    max_concurrent_inferences = 0
    lock = threading.Lock()

    def thread_safe_process(rgb_image):
        nonlocal active_inferences, max_concurrent_inferences
        with lock:
            active_inferences += 1
            if active_inferences > max_concurrent_inferences:
                max_concurrent_inferences = active_inferences
        time.sleep(0.02)
        with lock:
            active_inferences -= 1
        res = MagicMock()
        mask = np.zeros((100, 100), dtype=np.float32)
        mask[20:80, 20:80] = 1.0
        res.segmentation_mask = mask
        return res

    mock_seg_instance = MagicMock()
    mock_seg_instance.process.side_effect = thread_safe_process
    mock_seg_module = MagicMock()
    mock_seg_module.SelfieSegmentation.return_value = mock_seg_instance

    with patch.object(ms, "SELFIE_SEGMENTATION", mock_seg_module):
        dummy_img = np.zeros((100, 100, 3), dtype=np.uint8)
        errors = []

        def worker():
            try:
                ms._extract_silhouette(dummy_img)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        assert max_concurrent_inferences == 1
        assert mock_seg_instance.process.call_count == 8


# ============================================================================
# E. Cleanup / Reset Tests
# ============================================================================

def test_cleanup_models_closes_all_and_resets():
    """Verify cleanup_models closes all models and sets holders to None."""
    mock_sol_pose = MagicMock()
    mock_sol_seg = MagicMock()
    mock_pose_task = MagicMock()
    mock_seg_task = MagicMock()

    ms._SOLUTIONS_POSE = mock_sol_pose
    ms._SOLUTIONS_SEGMENTER = mock_sol_seg
    ms._POSE_TASK = mock_pose_task
    ms._SEGMENTER_TASK = mock_seg_task

    ms.cleanup_models()

    mock_sol_pose.close.assert_called_once()
    mock_sol_seg.close.assert_called_once()
    mock_pose_task.close.assert_called_once()
    mock_seg_task.close.assert_called_once()

    assert ms._SOLUTIONS_POSE is None
    assert ms._SOLUTIONS_SEGMENTER is None
    assert ms._POSE_TASK is None
    assert ms._SEGMENTER_TASK is None


def test_cleanup_models_is_safe_to_call_repeatedly():
    """Verify cleanup_models can be called repeatedly without crashing or raising errors."""
    ms.cleanup_models()
    ms.cleanup_models()
    ms.reset_models()
    assert ms._SOLUTIONS_POSE is None
    assert ms._SOLUTIONS_SEGMENTER is None


# ============================================================================
# F. Measurement Compatibility Tests
# ============================================================================

def test_measurement_output_and_confidence_compatibility_across_runs():
    """Verify measurement outputs and confidence remain numerically consistent before and after model reuse."""
    # Deterministic dummy landmarks matching a person in canonical A-pose
    def create_deterministic_landmarks():
        landmarks = []
        for i in range(33):
            lm = MagicMock()
            lm.x = 0.5
            lm.y = 0.1 + (i * 0.02)
            lm.z = 0.0
            lm.visibility = 0.95
            landmarks.append(lm)

        # Set specific joints for key landmarks
        # Left/Right Shoulders (11, 12)
        landmarks[11].x, landmarks[11].y = 0.38, 0.22
        landmarks[12].x, landmarks[12].y = 0.62, 0.22
        # Elbows (13, 14)
        landmarks[13].x, landmarks[13].y = 0.32, 0.38
        landmarks[14].x, landmarks[14].y = 0.68, 0.38
        # Wrists (15, 16)
        landmarks[15].x, landmarks[15].y = 0.30, 0.52
        landmarks[16].x, landmarks[16].y = 0.70, 0.52
        # Hips (23, 24)
        landmarks[23].x, landmarks[23].y = 0.42, 0.50
        landmarks[24].x, landmarks[24].y = 0.58, 0.50
        # Knees (25, 26)
        landmarks[25].x, landmarks[25].y = 0.43, 0.70
        landmarks[26].x, landmarks[26].y = 0.57, 0.70
        # Ankles (27, 28)
        landmarks[27].x, landmarks[27].y = 0.44, 0.90
        landmarks[28].x, landmarks[28].y = 0.56, 0.90
        return landmarks

    # Run 1: with newly created instance
    mock_pose_inst1 = MagicMock()
    res1 = MagicMock()
    res1.pose_landmarks = MagicMock()
    res1.pose_landmarks.landmark = create_deterministic_landmarks()
    mock_pose_inst1.process.return_value = res1

    mock_pose_module = MagicMock()
    mock_pose_module.Pose.return_value = mock_pose_inst1

    with patch.object(ms, "POSE", mock_pose_module):
        dummy_img = np.zeros((400, 300, 3), dtype=np.uint8)
        landmarks_run1 = ms._detect_pose(dummy_img)

        # Run 2: with reused instance
        landmarks_run2 = ms._detect_pose(dummy_img)

        # Both runs return identical landmarks
        assert len(landmarks_run1) == len(landmarks_run2)
        for lm1, lm2 in zip(landmarks_run1, landmarks_run2):
            assert math.isclose(lm1.x, lm2.x, abs_tol=1e-5)
            assert math.isclose(lm1.y, lm2.y, abs_tol=1e-5)
            assert math.isclose(lm1.visibility, lm2.visibility, abs_tol=1e-5)

        # Landmark visibility and confidence match
        conf1 = ms._estimate_view_confidence(landmarks_run1)
        conf2 = ms._estimate_view_confidence(landmarks_run2)
        assert math.isclose(conf1, conf2, abs_tol=1e-5)
