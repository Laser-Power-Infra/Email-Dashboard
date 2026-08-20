# Emails_agent Dockerfile - Gmail OCR & Email Processing Pipeline
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for Tesseract OCR and PDF poppler tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libtesseract-dev \
    poppler-utils \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy python dependencies list
COPY requirements.txt ./

# Install python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Environment variables
ENV PYTHONUNBUFFERED=1

# Command to run continuous email ingestion pipeline
CMD ["python", "claude_Oracel_db.py", "--continuous"]
