import {
    ApiError,
    calculateSize,
    createAvatar,
    createTryOnImage,
    extractProduct,
} from "./api.js";

const form = document.getElementById("size-form");
const submitButton = document.getElementById("submit-button");
const statusNode = document.getElementById("status");
const productLinkInput = document.getElementById("product-link");
const brandInput = document.getElementById("brand");
const productResultNode = document.getElementById("product-result");
const productTitleNode = document.getElementById("product-title");
const productBrandNode = document.getElementById("product-brand");
const productCategoryNode = document.getElementById("product-category");
const resultNode = document.getElementById("result");
const resultTitleNode = document.getElementById("result-title");
const resultSizeNode = document.getElementById("result-size");
const resultConfidenceNode = document.getElementById("result-confidence");
const resultRiskNode = document.getElementById("result-risk");
const tryOnForm = document.getElementById("tryon-form");
const tryOnSubmitButton = document.getElementById("tryon-submit-button");
const tryOnStatusNode = document.getElementById("tryon-status");
const avatarPreviewCardNode = document.getElementById("avatar-preview-card");
const avatarPreviewImageNode = document.getElementById("avatar-preview-image");
const tryOnResultNode = document.getElementById("tryon-result");
const tryOnResultTitleNode = document.getElementById("tryon-result-title");
const tryOnUserIdNode = document.getElementById("tryon-user-id");
const tryOnAvatarPathNode = document.getElementById("tryon-avatar-path");
const tryOnImageUrlNode = document.getElementById("tryon-image-url");
const tryOnResultImageNode = document.getElementById("tryon-result-image");
let avatarPreviewUrl;

function hideProductResult() {
    productResultNode.classList.remove("is-visible");
    productTitleNode.textContent = "pending";
    productBrandNode.textContent = "pending";
    productCategoryNode.textContent = "pending";
}

function showProductResult(product) {
    productTitleNode.textContent = product.title || "not found";
    productBrandNode.textContent = product.brand || "not found";
    productCategoryNode.textContent = product.category || "not found";
    productResultNode.classList.add("is-visible");
}

function setStatus(message, type = "idle") {
    statusNode.textContent = message;
    statusNode.className = "status";

    if (type === "loading") {
        statusNode.classList.add("is-loading");
    }

    if (type === "error") {
        statusNode.classList.add("is-error");
    }
}

function setLoading(isLoading) {
    submitButton.disabled = isLoading;
    submitButton.textContent = isLoading
        ? "Revealing..."
        : "Reveal My Size";
}

function setTryOnStatus(message, type = "idle") {
    tryOnStatusNode.textContent = message;
    tryOnStatusNode.className = "status";

    if (type === "loading") {
        tryOnStatusNode.classList.add("is-loading");
    }

    if (type === "error") {
        tryOnStatusNode.classList.add("is-error");
    }
}

function setTryOnLoading(isLoading) {
    tryOnSubmitButton.disabled = isLoading;
    tryOnSubmitButton.textContent = isLoading
        ? "Generating..."
        : "Generate Try-On";
}

function hideResult() {
    resultNode.classList.remove("is-visible");
}

function showResult(result) {
    resultTitleNode.textContent = `Recommended size: ${result.size}`;
    resultSizeNode.textContent = result.size;
    resultConfidenceNode.textContent = `${result.confidence}%`;
    resultRiskNode.textContent = result.risk;
    resultNode.classList.add("is-visible");
}

function toOptionalNumber(rawValue) {
    if (!rawValue || rawValue.trim() === "") {
        return undefined;
    }

    return Number(rawValue);
}

function buildPayload(formData) {
    return {
        chest: Number(formData.get("chest")),
        waist_cm: toOptionalNumber(formData.get("waist_cm")),
        hip_cm: toOptionalNumber(formData.get("hip_cm")),
        fit: String(formData.get("fit") || "regular"),
        brand: String(formData.get("brand") || "generic"),
        range: String(formData.get("range") || ""),
    };
}

function hideAvatarPreview() {
    avatarPreviewCardNode.classList.remove("is-visible");
    avatarPreviewImageNode.removeAttribute("src");

    if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
        avatarPreviewUrl = undefined;
    }
}

function showAvatarPreview(file) {
    hideAvatarPreview();
    avatarPreviewUrl = URL.createObjectURL(file);
    avatarPreviewImageNode.src = avatarPreviewUrl;
    avatarPreviewCardNode.classList.add("is-visible");
}

function showAvatarPreviewFromUrl(imageUrl) {
    hideAvatarPreview();
    avatarPreviewImageNode.src = imageUrl;
    avatarPreviewCardNode.classList.add("is-visible");
}

function hideTryOnResult() {
    tryOnResultNode.classList.remove("is-visible");
    tryOnResultImageNode.removeAttribute("src");
    tryOnUserIdNode.textContent = "pending";
    tryOnAvatarPathNode.textContent = "pending";
    tryOnImageUrlNode.textContent = "pending";
}

function showTryOnResult(result) {
    tryOnResultTitleNode.textContent = "Try-on image generated";
    tryOnUserIdNode.textContent = result.userId;
    tryOnAvatarPathNode.textContent = result.avatarUrl;
    tryOnImageUrlNode.textContent = result.imageUrl;
    tryOnResultImageNode.src = result.imageUrl;
    tryOnResultNode.classList.add("is-visible");
}

function getErrorMessage(error, fallbackMessage) {
    if (error instanceof ApiError) {
        return error.message;
    }

    if (error instanceof Error && error.message) {
        return error.message;
    }

    return fallbackMessage;
}

async function extractProductDetails(productUrl) {
    const response = await extractProduct({ url: productUrl });
    console.debug("[ui] /extract-product response", response);
    showProductResult(response);

    if (response.brand) {
        brandInput.value = response.brand;
    }

    return response;
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideProductResult();
    hideResult();
    setLoading(true);

    const productUrl = productLinkInput.value.trim();
    if (!productUrl) {
        setStatus("Paste a valid product link before revealing your size.", "error");
        setLoading(false);
        return;
    }

    setStatus("Analyzing product...", "loading");

    try {
        const extractedProduct = await extractProductDetails(productUrl);
        const formData = new FormData(form);
        const payload = buildPayload(formData);
        payload.brand = extractedProduct.brand || payload.brand;

        console.debug("[ui] /size-engine request payload", payload);
        const result = await calculateSize(payload);
        console.debug("[ui] /size-engine response", result);

        showResult(result);
        setStatus(
            `Recommendation ready for ${payload.brand || "the extracted item"}: ${result.size} with ${result.confidence}% confidence.`,
        );
    } catch (error) {
        console.error("[ui] Product-to-size flow failed.", error);
        const fallbackMessage = productUrl
            ? "Invalid product link or failed extraction."
            : "Unexpected error while loading recommendation.";
        const message = getErrorMessage(error, fallbackMessage);
        setStatus(message, "error");
    } finally {
        setLoading(false);
    }
});

productLinkInput.addEventListener("invalid", () => {
    setStatus("Enter a valid product link before revealing your size.", "error");
});

productLinkInput.addEventListener("input", () => {
    if (statusNode.classList.contains("is-error")) {
        setStatus("");
    }
});

tryOnForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideTryOnResult();

    const avatarInput = document.getElementById("avatar-file");
    const productImageUrlInput = document.getElementById("product-image-url");
    const avatarFile = avatarInput.files && avatarInput.files[0];
    const productImageUrl = productImageUrlInput.value.trim();

    if (!avatarFile) {
        setTryOnStatus("Choose an avatar image before starting try-on.", "error");
        return;
    }

    if (!productImageUrl) {
        setTryOnStatus("Enter a product image URL before starting try-on.", "error");
        return;
    }

    showAvatarPreview(avatarFile);
    setTryOnLoading(true);
    setTryOnStatus("Uploading avatar to /avatar-create ...", "loading");

    try {
        const avatar = await createAvatar({
            file: avatarFile,
            filename: avatarFile.name || "avatar.jpg",
        });
        showAvatarPreviewFromUrl(avatar.public_path);
        setTryOnStatus("Calling /tryon-image with uploaded avatar ...", "loading");

        const tryOnResponse = await createTryOnImage({
            user_id: avatar.user_id,
            product_image_url: productImageUrl,
        });

        showTryOnResult({
            userId: avatar.user_id,
            avatarUrl: avatar.public_path,
            imageUrl: tryOnResponse.tryon_image,
        });
        setTryOnStatus("Try-on image loaded successfully.");
    } catch (error) {
        console.error("[ui] Try-on request failed.", error);
        const message = getErrorMessage(
            error,
            "Unexpected error while generating try-on image.",
        );
        setTryOnStatus(message, "error");
    } finally {
        setTryOnLoading(false);
    }
});
