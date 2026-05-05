FROM python:3.11-alpine

WORKDIR /server

COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/server.py .
COPY index.html app.js add.html styles.css manifest.json icon.svg /static/

ENV MAMONY_STATIC=/static
ENV MAMONY_DB=/data/mamony.db
ENV PORT=8000

EXPOSE 8000

CMD ["python", "server.py"]
