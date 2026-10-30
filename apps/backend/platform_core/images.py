import os
import uuid
import warnings

from django.core.exceptions import ValidationError
from django.http import FileResponse
from PIL import Image, UnidentifiedImageError


MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_DIMENSION = 4096
MAX_IMAGE_PIXELS = 16_000_000
IMAGE_FORMATS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}
IMAGE_CONTENT_TYPES = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def validate_raster_image(upload):
    if upload.size > MAX_IMAGE_BYTES:
        raise ValidationError("Image must be no larger than 5 MiB.")
    try:
        upload.seek(0)
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(upload)
            image_format = image.format
            width, height = image.size
            if image_format not in IMAGE_FORMATS:
                raise ValidationError("Only JPEG, PNG, and WebP images are supported.")
            if width < 1 or height < 1 or width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION or width * height > MAX_IMAGE_PIXELS:
                raise ValidationError("Image dimensions exceed the 4096-pixel limit.")
            image.verify()
    except ValidationError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValidationError("Uploaded file is not a valid supported image.") from exc
    finally:
        upload.seek(0)
    upload.name = f"upload{IMAGE_FORMATS[image_format]}"
    return upload


def tenant_asset_path(instance, filename):
    extension = os.path.splitext(filename)[1].lower()
    if extension not in IMAGE_CONTENT_TYPES:
        extension = ".png"
    asset_type = "brand" if instance.__class__.__name__ == "TenantBranding" else "products"
    return f"tenants/{instance.tenant_id}/{asset_type}/{uuid.uuid4().hex}{extension}"


def image_content_type(file_field):
    extension = os.path.splitext(file_field.name)[1].lower()
    return IMAGE_CONTENT_TYPES.get(extension, "application/octet-stream")


def private_image_response(image):
    if not image:
        from rest_framework.exceptions import NotFound
        raise NotFound()
    response = FileResponse(image.open("rb"), content_type=image_content_type(image))
    response["Cache-Control"] = "private, max-age=300"
    response["Content-Disposition"] = 'inline; filename="image"'
    response["Cross-Origin-Resource-Policy"] = "same-origin"
    response["X-Content-Type-Options"] = "nosniff"
    return response
