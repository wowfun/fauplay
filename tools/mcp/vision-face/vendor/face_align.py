import cv2
import numpy as np
from skimage import transform as trans

# Borrowed from insightface.utils.face_align for ArcFace-compatible alignment.
_ARCFACE_DST = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)


def estimate_norm(landmarks: np.ndarray, image_size: int = 112) -> np.ndarray:
    assert landmarks.shape == (5, 2)
    assert image_size % 112 == 0 or image_size % 128 == 0
    if image_size % 112 == 0:
        ratio = float(image_size) / 112.0
        diff_x = 0.0
    else:
        ratio = float(image_size) / 128.0
        diff_x = 8.0 * ratio

    dst = _ARCFACE_DST * ratio
    dst[:, 0] += diff_x
    tform = trans.SimilarityTransform()
    tform.estimate(landmarks, dst)
    return tform.params[0:2, :]


def norm_crop(image: np.ndarray, landmark: np.ndarray, image_size: int = 112) -> np.ndarray:
    matrix = estimate_norm(landmark, image_size)
    return cv2.warpAffine(image, matrix, (image_size, image_size), borderValue=0.0)
