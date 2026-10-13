# Local static-file server plus OTP endpoints used by the account prototype.
import base64
import json
import mimetypes
import os
import re
import sqlite3
import time
import uuid
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen


# Only these project files are exposed by the static-file route.
ROOT = Path(__file__).resolve().parent
ORDER_DATABASE = ROOT / "orders.sqlite3"
ALLOWED_FILES = {
    "account.html",
    "cainta-one-app.txt",
    "download-app.html",
    "favicon.svg",
    "food-express.html",
    "main.html",
    "online-bazaar.html",
    "script.js",
    "style.css",
}
RATE_LIMITS = {}
# These server-owned catalogs define the valid IDs, names, prices, brands, and sizes for order validation.
PAYMENT_METHODS = {"Cash on Delivery", "GCash", "Bank Transfer"}
FOOD_PRODUCTS = {
    "crispy-chicken": ("Crispy Chicken Meal", 149, "Food Express"),
    "chicken-inasal": ("Chicken Inasal Plate", 159, "Food Express"),
    "sisig-bowl": ("Sisig Rice Bowl", 159, "Food Express"),
    "beef-tapa": ("Beef Tapa Silog", 169, "Food Express"),
    "pork-adobo": ("Pork Adobo Rice Meal", 149, "Food Express"),
    "chicken-bbq-meal": ("Chicken BBQ Meal", 159, "Food Express"),
    "pancit-canton": ("Pancit Canton", 129, "Food Express"),
    "kamote-fries": ("Kamote Fries", 59, "Food Express"),
    "garlic-rice": ("Garlic Rice", 39, "Food Express"),
    "lumpia": ("Lumpia Shanghai", 79, "Food Express"),
    "kwek-kwek": ("Kwek-Kwek", 69, "Food Express"),
    "turon": ("Banana Turon", 59, "Food Express"),
    "halo-halo": ("Halo-Halo", 99, "Food Express"),
    "leche-flan": ("Leche Flan", 69, "Food Express"),
    "iced-calamansi": ("Iced Calamansi", 49, "Food Express"),
    "mango-shake": ("Mango Shake", 79, "Food Express"),
    "jollibee-chickenjoy": ("Chickenjoy 1-Pc Meal", 139, "Jollibee"),
    "jollibee-spaghetti": ("Jolly Spaghetti", 89, "Jollibee"),
    "jollibee-yumburger": ("Yumburger", 69, "Jollibee"),
    "jollibee-peach-mango-pie": ("Peach Mango Pie", 49, "Jollibee"),
    "mcdo-chicken-meal": ("1-Pc Chicken McDo Meal", 139, "McDo"),
    "mcdo-big-mac": ("Big Mac", 199, "McDo"),
    "mcdo-mcspaghetti": ("McSpaghetti", 89, "McDo"),
    "mcdo-apple-pie": ("Apple Pie", 49, "McDo"),
}
BAZAAR_PRODUCTS = {
    "nike-dri-fit-tee": ("Dri-FIT Training T-Shirt", "Nike", 1895, ("S", "M", "L", "XL")),
    "nike-air-max": ("Air Max Lifestyle Shoes", "Nike", 6995, ("36", "37", "38", "39", "40", "41", "42", "43")),
    "adidas-tee": ("3-Stripes Essentials Tee", "Adidas", 1700, ("S", "M", "L", "XL")),
    "adidas-superstar": ("Superstar Shoes", "Adidas", 5800, ("36", "37", "38", "39", "40", "41", "42", "43")),
    "puma-hoodie": ("Essentials Pullover Hoodie", "Puma", 2600, ("S", "M", "L", "XL")),
    "puma-suede": ("Suede Classic Sneakers", "Puma", 4700, ("36", "37", "38", "39", "40", "41", "42")),
    "levis-501": ("501 Original Jeans", "Levi's", 5500, ("28", "30", "32", "34", "36")),
    "levis-graphic-tee": ("Graphic Cotton Tee", "Levi's", 1400, ("S", "M", "L", "XL")),
    "uniqlo-airism": ("AIRism Cotton T-Shirt", "Uniqlo", 790, ("S", "M", "L", "XL")),
    "uniqlo-ultra-light-down": ("Ultra Light Down Jacket", "Uniqlo", 3990, ("S", "M", "L", "XL")),
    "zara-poplin-shirt": ("Oversized Poplin Shirt", "Zara", 2295, ("S", "M", "L", "XL")),
    "zara-straight-jeans": ("Straight-Fit Jeans", "Zara", 2995, ("28", "30", "32", "34", "36")),
    "converse-chuck-taylor": ("Chuck Taylor All Star", "Converse", 3590, ("36", "37", "38", "39", "40", "41", "42", "43")),
    "converse-chuck-70": ("Chuck 70 Canvas High-Top", "Converse", 4990, ("36", "37", "38", "39", "40", "41", "42", "43")),
    "new-balance-574": ("574 Core Sneakers", "New Balance", 5795, ("36", "37", "38", "39", "40", "41", "42", "43")),
    "new-balance-sweatshirt": ("Essentials Crew Sweatshirt", "New Balance", 3295, ("S", "M", "L", "XL")),
}


# Normalize a submitted cart and calculate its total without trusting browser-supplied prices.
def validate_order(payload):
    service = payload.get("service")
    if not isinstance(service, str) or service not in {"food-express", "online-bazaar"}:
        raise ValueError("Choose a valid order type.")

    # Reject malformed contact details before storing any customer data.
    customer_name = payload.get("customer_name", "")
    phone = payload.get("phone", "")
    address = payload.get("address", "")
    delivery_date = payload.get("delivery_date", "")
    payment_method = payload.get("payment_method")
    if not all(isinstance(value, str) for value in (customer_name, phone, address, delivery_date)):
        raise ValueError("Customer and delivery details must be text.")
    customer_name = customer_name.strip()
    phone = phone.strip()
    address = address.strip()
    delivery_date = delivery_date.strip()
    if not 2 <= len(customer_name) <= 100:
        raise ValueError("Enter a name between 2 and 100 characters.")
    if not re.fullmatch(r"\+?[0-9][0-9\s()\-]{6,22}", phone):
        raise ValueError("Enter a valid phone number.")
    if not 8 <= len(address) <= 300:
        raise ValueError("Enter a delivery address between 8 and 300 characters.")
    try:
        requested_date = datetime.strptime(delivery_date, "%Y-%m-%d").date()
    except ValueError as error:
        raise ValueError("Choose a valid delivery date.") from error
    if requested_date < date.today():
        raise ValueError("Delivery date cannot be in the past.")
    if not isinstance(payment_method, str) or payment_method not in PAYMENT_METHODS:
        raise ValueError("Choose a valid payment method.")

    requested_items = payload.get("items")
    if not isinstance(requested_items, list) or not 1 <= len(requested_items) <= 40:
        raise ValueError("Add between 1 and 40 items to your order.")

    # Resolve each cart line against the selected service's catalog and authoritative prices.
    catalog = FOOD_PRODUCTS if service == "food-express" else BAZAAR_PRODUCTS
    items = []
    seen_items = set()
    total = 0
    for requested_item in requested_items:
        if not isinstance(requested_item, dict):
            raise ValueError("Each order item must be an object.")
        product_id = requested_item.get("id")
        if not isinstance(product_id, str):
            raise ValueError("Each order item must have a valid product ID.")
        product = catalog.get(product_id)
        if product is None:
            raise ValueError("One of the selected products is not available.")
        quantity = requested_item.get("quantity")
        if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= 20:
            raise ValueError("Item quantity must be between 1 and 20.")

        size = str(requested_item.get("size", "")).strip()
        if service == "food-express":
            name, price, brand = product
            if size:
                raise ValueError("Food items do not have size options.")
        else:
            name, brand, price, sizes = product
            if size not in sizes:
                raise ValueError("Choose a valid size for each clothing item.")

        item_key = (product_id, size)
        if item_key in seen_items:
            raise ValueError("Combine duplicate product and size lines into one quantity.")
        seen_items.add(item_key)
        total += price * quantity
        items.append({
            "id": product_id,
            "name": name,
            "brand": brand,
            "size": size,
            "quantity": quantity,
            "unit_price": price,
        })

    return {
        "service": service,
        "customer_name": customer_name,
        "phone": phone,
        "address": address,
        "delivery_date": delivery_date,
        "payment_method": payment_method,
        "items": items,
        "total": total,
    }


# Create separate order headers and line items so each order can contain multiple products.
def initialize_order_database():
    with sqlite3.connect(ORDER_DATABASE) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                order_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                service TEXT NOT NULL,
                customer_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                address TEXT NOT NULL,
                delivery_date TEXT NOT NULL,
                payment_method TEXT NOT NULL,
                total INTEGER NOT NULL CHECK (total >= 0)
            )
        """)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS order_items (
                order_id TEXT NOT NULL,
                product_id TEXT NOT NULL,
                product_name TEXT NOT NULL,
                brand TEXT NOT NULL,
                size TEXT NOT NULL,
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
                PRIMARY KEY (order_id, product_id, size),
                FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
            )
        """)


# Save an order and all of its items in one SQLite transaction.
def save_order(order_id, order):
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with sqlite3.connect(ORDER_DATABASE) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            """INSERT INTO orders
               (order_id, created_at, service, customer_name, phone, address,
                delivery_date, payment_method, total)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                order_id,
                created_at,
                order["service"],
                order["customer_name"],
                order["phone"],
                order["address"],
                order["delivery_date"],
                order["payment_method"],
                order["total"],
            ),
        )
        connection.executemany(
            """INSERT INTO order_items
               (order_id, product_id, product_name, brand, size, quantity, unit_price)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    order_id,
                    item["id"],
                    item["name"],
                    item["brand"],
                    item["size"],
                    item["quantity"],
                    item["unit_price"],
                )
                for item in order["items"]
            ],
        )


# Read optional local settings without replacing values already in the environment.
def load_environment():
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


# Keep short-lived request timestamps to limit repeated SMS and verification attempts.
def rate_limited(key, limit, window_seconds):
    now = time.monotonic()
    recent = [stamp for stamp in RATE_LIMITS.get(key, []) if now - stamp < window_seconds]
    if len(recent) >= limit:
        RATE_LIMITS[key] = recent
        return True
    recent.append(now)
    RATE_LIMITS[key] = recent
    return False


# Send one Verify API request using credentials from environment variables.
def twilio_verify_request(action, fields):
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    service_sid = os.environ.get("TWILIO_VERIFY_SERVICE_SID", "").strip()
    if not account_sid or not auth_token or not service_sid:
        raise RuntimeError("SMS verification is not configured on the server.")

    credentials = base64.b64encode(f"{account_sid}:{auth_token}".encode()).decode()
    endpoint = (
        "https://verify.twilio.com/v2/Services/"
        f"{quote(service_sid, safe='')}/{action}"
    )
    request = Request(
        endpoint,
        data=urlencode(fields).encode(),
        headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    with urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


class CaintaOneHandler(BaseHTTPRequestHandler):
    server_version = "CaintaOneLocal/1.0"

    # JSON response helpers centralize headers and request-body validation.
    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid request body.") from error
        if content_length < 1 or content_length > 4096:
            raise ValueError("Invalid request body size.")
        try:
            payload = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Request must contain valid JSON.") from error
        if not isinstance(payload, dict):
            raise ValueError("Request must contain a JSON object.")
        return payload

    # Validate and persist a checkout request, returning only its receipt details.
    def handle_order(self):
        try:
            payload = self.read_json()
            client = self.client_address[0]
            if rate_limited(("order-ip", client), 20, 3600):
                self.send_json(429, {"error": "Too many order requests. Try again later."})
                return
            order = validate_order(payload)
            order_id = uuid.uuid4().hex[:12].upper()
            save_order(order_id, order)
            self.send_json(
                201,
                {"order_id": order_id, "service": order["service"], "total": order["total"]},
            )
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except sqlite3.Error:
            self.send_json(500, {"error": "The order could not be saved. Please try again."})

    def do_GET(self):
        # Serve only allowlisted project files; the root URL opens the home page.
        request_path = urlsplit(self.path).path
        filename = "main.html" if request_path == "/" else request_path.lstrip("/")
        if filename not in ALLOWED_FILES:
            self.send_error(404)
            return
        file_path = ROOT / filename
        try:
            content = file_path.read_bytes()
        except OSError:
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in {
            "application/javascript",
            "image/svg+xml",
        }:
            content_type += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        route = urlsplit(self.path).path
        if route == "/api/orders":
            self.handle_order()
            return

        # Handle SMS send/check requests and return structured errors to the browser.
        if route not in {"/api/otp/send", "/api/otp/check"}:
            self.send_json(404, {"error": "Endpoint not found."})
            return
        try:
            payload = self.read_json()
            phone = str(payload.get("phone", "")).strip()
            if not re.fullmatch(r"\+[1-9]\d{7,14}", phone):
                raise ValueError("Enter a valid phone number with country code, such as +639123456789.")
            client = self.client_address[0]

            if route == "/api/otp/send":
                if rate_limited(("send-ip", client), 5, 3600):
                    self.send_json(429, {"error": "Too many code requests. Try again later."})
                    return
                if rate_limited(("send-phone", phone), 3, 600):
                    self.send_json(429, {"error": "A code was sent recently. Try again in a few minutes."})
                    return
                twilio_verify_request("Verifications", {"To": phone, "Channel": "sms"})
                self.send_json(200, {"sent": True, "message": "Verification code sent by SMS."})
                return

            code = str(payload.get("code", "")).strip()
            if not re.fullmatch(r"\d{4,10}", code):
                raise ValueError("Enter the verification code from your SMS.")
            if rate_limited(("check-ip", client), 10, 900):
                self.send_json(429, {"error": "Too many verification attempts. Try again later."})
                return
            result = twilio_verify_request(
                "VerificationCheck",
                {"To": phone, "Code": code},
            )
            if result.get("status") != "approved":
                self.send_json(400, {"error": "That code is incorrect or expired."})
                return
            self.send_json(200, {"verified": True, "phone": phone})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except (HTTPError, URLError, TimeoutError, RuntimeError, json.JSONDecodeError):
            self.send_json(
                502,
                {"error": "SMS verification is unavailable. Check the server configuration and try again."},
            )


# Load optional Twilio settings, then start the local threaded HTTP server.
def main():
    load_environment()
    initialize_order_database()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), CaintaOneHandler)
    print(f"Cainta One Express is running at http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()