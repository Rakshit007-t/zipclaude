from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from zipright.backend.pipeline.pose import detect_pose
from zipright.backend.pipeline.preprocess import PreprocessError, preprocess_base64_image

app = FastAPI(title="ZipRight API", version="0.1.0")


class ValidatePoseRequest(BaseModel):
    image: str = Field(..., min_length=1)


class ValidatePoseResponse(BaseModel):
    valid: bool
    issues: list[str]
    instructions: str


class MeasureRequest(BaseModel):
    front_image: str = Field(..., min_length=1)
    side_image: str = Field(..., min_length=1)
    height_cm: float = Field(..., gt=0)
    gender: str = Field(..., min_length=1)


class RecommendRequest(BaseModel):
    measurements: dict[str, float]
    brand: str
    garment_type: str
    fit_preference: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/validate-pose", response_model=ValidatePoseResponse)
def validate_pose_endpoint(payload: ValidatePoseRequest) -> ValidatePoseResponse:
    try:
        preprocessed = preprocess_base64_image(payload.image)
    except PreprocessError as exc:
        return ValidatePoseResponse(
            valid=False,
            issues=[str(exc)],
            instructions="Retake the photo with your full body visible against a clean background in good lighting.",
        )

    pose_result = detect_pose(preprocessed)
    return ValidatePoseResponse(
        valid=pose_result.valid,
        issues=list(pose_result.issues),
        instructions=pose_result.instructions,
    )


@app.post("/api/measure")
def measure_endpoint(_: MeasureRequest) -> dict[str, str]:
    raise HTTPException(
        status_code=501,
        detail="Measurement extraction is not implemented yet. Modules 3-6 are scaffolded next.",
    )


@app.post("/api/recommend")
def recommend_endpoint(_: RecommendRequest) -> dict[str, str]:
    raise HTTPException(
        status_code=501,
        detail="Size recommendation is not implemented yet. Module 7 is scaffolded next.",
    )


@app.get("/api/brands")
def list_brands() -> dict[str, list[str]]:
    return {"brands": []}


@app.get("/api/size-charts/{brand}/{garment_type}")
def get_size_chart(brand: str, garment_type: str) -> dict[str, str]:
    raise HTTPException(
        status_code=501,
        detail=(
            "Brand-specific size chart retrieval is not implemented yet. "
            f"Requested brand='{brand}', garment_type='{garment_type}'."
        ),
    )
