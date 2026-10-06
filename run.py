"""Start the server:  python run.py   ->  http://127.0.0.1:5000"""
import os
from app import create_app
from seed import seed

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "instance", "aics.db")
if not os.path.exists(DB):          # first run: create the database with demo data
    seed(DB)
app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=os.environ.get("FLASK_DEBUG") == "1")
