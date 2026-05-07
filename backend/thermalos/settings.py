import os
import sys
import warnings
from datetime import timedelta
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent

# 50-char placeholder clears HS256's 32-byte minimum. NEVER use in production.
_DEV_SECRET_KEY = "dev-only-change-me-thermalos-development-key-xxxx"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", _DEV_SECRET_KEY)
DEBUG = os.environ.get("DEBUG", "false").lower() == "true"
ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "*").split(",")

# Refuse production-shaped startup with the dev secret; tests get a
# softer warning instead of a hard exit.
_running_tests = "pytest" in sys.modules or "test" in sys.argv
if SECRET_KEY == _DEV_SECRET_KEY:
    if not DEBUG and not _running_tests:
        raise RuntimeError(
            "DJANGO_SECRET_KEY is unset and DEBUG=False — refusing to start "
            "with the development placeholder key. Set DJANGO_SECRET_KEY in "
            "the environment."
        )
    warnings.warn(
        "Using the development DJANGO_SECRET_KEY placeholder. "
        "Set DJANGO_SECRET_KEY before deploying.",
        RuntimeWarning,
        stacklevel=2,
    )

if not DEBUG and ALLOWED_HOSTS == ["*"] and not _running_tests:
    warnings.warn(
        "ALLOWED_HOSTS='*' with DEBUG=False permits Host header spoofing. "
        "Restrict ALLOWED_HOSTS to known domains for production.",
        RuntimeWarning,
        stacklevel=2,
    )

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "building",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise serves collected static files in prod. Harmless in dev when
    # DEBUG=True (Django's runserver staticfiles finder takes precedence).
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "thermalos.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "thermalos.wsgi.application"
ASGI_APPLICATION = "thermalos.asgi.application"

DATABASES = {
    "default": dj_database_url.config(
        default=os.environ.get(
            "DATABASE_URL",
            "postgresql://thermalos:thermalos@db:5432/thermalos",
        ),
        conn_max_age=600,
    )
}

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
# Touch the dir so WhiteNoise stops complaining in dev — collectstatic
# only runs in prod (Dockerfile.prod), so the dir would otherwise be
# missing under runserver. Manifest storage stays prod-only because it
# requires every referenced asset to exist post-collectstatic.
STATIC_ROOT.mkdir(parents=True, exist_ok=True)
if not DEBUG:
    STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "UNAUTHENTICATED_USER": None,
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": False,
    "BLACKLIST_AFTER_ROTATION": False,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

# CORS is dev-only — production traffic is proxied via Next.js rewrites.
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = True
