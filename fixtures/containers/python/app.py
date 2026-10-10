from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from html import escape
from typing import Literal
from fastapi import FastAPI
from pydantic import BaseModel, Field
from revision import REVISION

app = FastAPI()
PRODUCTS = [{"id": "coffee", "name": "Coffee beans", "price": "12.50"}, {"id": "mug", "name": "Ceramic mug", "price": "8.00"}]

class Line(BaseModel):
    productId: Literal["coffee", "mug"]
    quantity: int = Field(gt=0)

class Quote(BaseModel):
    lines: list[Line] = Field(min_length=1)

class Receipt(BaseModel):
    orderId: str
    placedAt: datetime
    total: str = Field(pattern=r"^\d+\.\d{2}$")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/version")
def version():
    return {"service": "commerce-api", "revision": REVISION}

@app.get("/products")
def products():
    return {"revision": REVISION, "products": PRODUCTS}

@app.post("/quote")
def quote(request: Quote):
    prices = {p["id"]: Decimal(p["price"]) for p in PRODUCTS}
    total = sum((prices[line.productId] * line.quantity for line in request.lines), Decimal(0))
    return {"revision": REVISION, "total": str(total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)), "currency": "USD"}

@app.post("/receipt")
def receipt(request: Receipt):
    html = f"<p>Order {escape(request.orderId)}, {request.placedAt:%Y-%m-%d}: USD {escape(request.total)}</p>"
    return {"revision": REVISION, "html": html}
