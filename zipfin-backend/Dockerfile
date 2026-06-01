FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Install Playwright browser and system dependencies
RUN playwright install --with-deps chromium

COPY . .

EXPOSE 8000

CMD ["gunicorn", "-c", "gunicorn.conf.py", "main:app"]
