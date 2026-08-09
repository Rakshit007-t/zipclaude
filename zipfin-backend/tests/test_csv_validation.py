import pytest
from services.csv_validation_service import validate_product_csv


def test_csv_validation_valid():
    csv_text = (
        "title,sku,category,gender,price,description,fabric,fit_type,images\n"
        "Cotton Tee,SKU-100,T-Shirts,Men,24.99,Nice tee,Cotton,regular,https://example.com/tee.jpg\n"
        "Denim Pants,SKU-101,Jeans,Women,49.99,Blue jeans,Denim,slim,https://example.com/jeans.jpg\n"
    )

    report = validate_product_csv(csv_text)
    assert report.total_rows == 2
    assert report.valid_rows_count == 2
    assert report.invalid_rows_count == 0
    assert len(report.errors) == 0
    assert report.valid_products[0]["title"] == "Cotton Tee"


def test_csv_validation_errors():
    # Missing title, duplicate SKU, invalid category
    csv_text = (
        "title,sku,category,gender,price,description,fabric,fit_type,images\n"
        ",SKU-200,T-Shirts,Men,10.00,No title,,,\n"
        "Shirt 1,SKU-300,InvalidCat,Men,15.00,Bad cat,,,\n"
        "Shirt 2,SKU-300,Shirts,Men,15.00,Duplicate SKU,,,\n"
    )

    report = validate_product_csv(csv_text)
    assert report.total_rows == 3
    assert report.invalid_rows_count > 0
    assert len(report.errors) > 0

    field_errors = [e.field for e in report.errors]
    assert "title" in field_errors
    assert "category" in field_errors
    assert "sku" in field_errors
