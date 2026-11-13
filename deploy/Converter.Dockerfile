FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-reportlab python3-defusedxml && rm -rf /var/lib/apt/lists/* && useradd -u 1000 -m converter && mkdir /exchange && chown 1000:1000 /exchange
COPY deploy/converter.py /app/converter.py
USER 1000:1000
CMD ["python3","-B","/app/converter.py"]
