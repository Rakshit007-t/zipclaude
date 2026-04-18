from pathlib import Path
import logging

from services.face_engine import extract_face_embedding as run_face_embedding

logger = logging.getLogger(__name__)


async def generate_tryon(tryon_input: dict[str, str]) -> dict:
    """
    Placeholder for a try-on API call using prepared model input.
    """
    logger.info(
        "MOCK: Calling Try-On API with person_image=%s product_image_url=%s",
        tryon_input["person_image_path"],
        tryon_input["product_image_url"],
    )

    # Example future payload structure:
    # replicate.run(
    #     "yisol/idm-vton:...",
    #     input={
    #         "human_image": open(tryon_input["person_image_path"], "rb"),
    #         "garment_image": tryon_input["product_image_url"],
    #         "output_path": tryon_input["output_image_path"],
    #     },
    # )

    return {
        "status": "success",
        "output_url": tryon_input["output_image_url"],
        "model_used": "idm-vton-mock",
        "provider": "replicate",
    }


async def extract_face_embedding(avatar_image_path: Path) -> list[float]:
    """
    Extract a face embedding using the shared InsightFace analyzer.
    """
    logger.info(
        "Extracting face embedding from %s using InsightFace", avatar_image_path
    )
    return run_face_embedding(avatar_image_path)


async def generate_avatar(user_id: str, face_embedding: list[float]) -> dict:
    """
    Placeholder for AI Avatar Generation based on face embeddings.
    """
    logger.info("MOCK: Generating avatar for %s", user_id)
    return {
        "status": "success",
        "avatar_url": f"https://cdn.zipright.ai/avatars/{user_id}_generated.webp",
    }
