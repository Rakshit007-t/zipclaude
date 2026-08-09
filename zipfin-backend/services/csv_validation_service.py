import csv
import io
import re
from typing import Any
from pydantic import BaseModel, Field

VALID_CATEGORIES = {
    "t-shirts", "tshirts", "tshirt",
    "shirts", "shirt",
    "hoodies", "hoodie",
    "jackets", "jacket",
    "jeans", "jean",
    "pants", "pant", "trousers",
    "shorts", "short",
    "dresses", "dress",
    "kurtis", "kurti",
    "ethnic wear", "ethnicwear", "ethnic",
    "shoes", "shoe", "footwear",
}

VALID_GENDERS = {"men", "women", "unisex", "male", "female"}

URL_REGEX = re.compile(
    r"^https?://"  # http:// or https://
    r"(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|"  # domain...
    r"localhost|"  # localhost...
    r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"  # ...or ip
    r"(?::\d+)?"  # optional port
    r"(?:/?|[/?]\S+)$",
    re.IGNORECASE,
)


class CsvRowError(BaseModel):
    row_number: int
    field: str
    message: str


class CsvValidationReport(BaseModel):
    total_rows: int
    valid_rows_count: int
    invalid_rows_count: int
    errors: list[CsvRowError]
    valid_products: list[dict[str, Any]]


def validate_product_csv(csv_content: str, existing_skus: set[str] | None = None) -> CsvValidationReport:
    if existing_skus is None:
        existing_skus = set()

    file_stream = io.StringIO(csv_content.strip())
    reader = csv.DictReader(file_stream)

    if not reader.fieldnames:
        return CsvValidationReport(
            total_rows=0,
            valid_rows_count=0,
            invalid_rows_count=0,
            errors=[CsvRowError(row_number=0, field="file", message="CSV file is empty or missing headers.")],
            valid_products=[],
        )

    # Normalize headers
    headers = [h.strip().lower().replace(" ", "_") for h in reader.fieldnames if h]

    errors: list[CsvRowError] = []
    valid_products: list[dict[str, Any]] = []
    seen_skus_in_file: set[str] = set()

    total_rows = 0
    row_number = 1  # 1-indexed (header is row 1)

    for row in reader:
        row_number += 1
        total_rows += 1
        row_errors = 0

        # Extract fields
        title = (row.get("title") or row.get("name") or "").strip()
        sku = (row.get("sku") or row.get("product_id") or "").strip()
        category = (row.get("category") or "").strip()
        gender = (row.get("gender") or "unisex").strip()
        price = (row.get("price") or "").strip()
        description = (row.get("description") or "").strip()
        fabric = (row.get("fabric") or row.get("material") or "").strip()
        fit_type = (row.get("fit_type") or row.get("fit") or "").strip()
        images_raw = (row.get("images") or row.get("image") or "").strip()

        # 1. Required field: Title
        if not title:
            errors.append(CsvRowError(row_number=row_number, field="title", message="Product title is required."))
            row_errors += 1

        # 2. SKU Validation & Duplicate Check
        if sku:
            sku_lower = sku.lower()
            if sku_lower in seen_skus_in_file:
                errors.append(CsvRowError(row_number=row_number, field="sku", message=f"Duplicate SKU '{sku}' within CSV file."))
                row_errors += 1
            elif sku_lower in existing_skus:
                errors.append(CsvRowError(row_number=row_number, field="sku", message=f"SKU '{sku}' already exists in your catalog."))
                row_errors += 1
            else:
                seen_skus_in_file.add(sku_lower)

        # 3. Category Validation
        if not category:
            errors.append(CsvRowError(row_number=row_number, field="category", message="Category is required."))
            row_errors += 1
        elif category.lower() not in VALID_CATEGORIES:
            errors.append(
                CsvRowError(
                    row_number=row_number,
                    field="category",
                    message=f"Invalid category '{category}'. Must be one of: T-Shirts, Shirts, Hoodies, Jackets, Jeans, Pants, Shorts, Dresses, Kurtis, Ethnic Wear, Shoes.",
                )
            )
            row_errors += 1

        # 4. Gender Validation
        if gender and gender.lower() not in VALID_GENDERS:
            errors.append(CsvRowError(row_number=row_number, field="gender", message=f"Invalid gender '{gender}'. Expected Men, Women, or Unisex."))
            row_errors += 1

        # 5. Image URLs validation
        images_list = [img.strip() for img in images_raw.split(";") if img.strip()]
        for img_url in images_list:
            if img_url.startswith("http://") or img_url.startswith("https://"):
                if not URL_REGEX.match(img_url):
                    errors.append(CsvRowError(row_number=row_number, field="images", message=f"Invalid image URL format: '{img_url}'"))
                    row_errors += 1

        if row_errors == 0:
            valid_products.append(
                {
                    "sku": sku or f"SKU-{total_rows}",
                    "title": title,
                    "description": description,
                    "category": category.title(),
                    "gender": gender.capitalize(),
                    "price": price or None,
                    "fabric": fabric,
                    "fit_type": fit_type or "regular",
                    "images": images_list if images_list else [],
                    "tags": ["csv_imported"],
                    "status": "active",
                }
            )

    return CsvValidationReport(
        total_rows=total_rows,
        valid_rows_count=len(valid_products),
        invalid_rows_count=total_rows - len(valid_products),
        errors=errors,
        valid_products=valid_products,
    )
