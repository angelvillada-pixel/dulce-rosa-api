from flask import Flask, request, jsonify
import os, json, traceback
from datetime import datetime
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

API_TOKEN = os.getenv("ADMIN_TOKEN", "supersecreto")
MAX_STEPS = 4

# ================= MEMORY =================
class Memory:
    def __init__(self):
        self.short = []

    def add(self, role, content):
        self.short.append({
            "role": role,
            "content": content,
            "time": str(datetime.now())
        })

    def get(self):
        return self.short[-10:]

memory = Memory()

# ================= TOOLS =================
BASE_DIR = os.getcwd()

def read_file(path):
    try:
        with open(os.path.join(BASE_DIR, path), "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        return str(e)

def write_file(path, content):
    try:
        with open(os.path.join(BASE_DIR, path), "w", encoding="utf-8") as f:
            f.write(content)
        return "updated"
    except Exception as e:
        return str(e)

def analyze_error(err):
    return f"Error analizado: {err[:300]}"

def execute_code(code):
    try:
        local = {}
        exec(code, {}, local)
        return str(local)
    except Exception as e:
        return str(e)

TOOLS = {
    "read_file": read_file,
    "write_file": write_file,
    "analyze_error": analyze_error,
    "execute_code": execute_code
}

# ================= AGENT =================
def think(input_text):
    if "error" in input_text.lower():
        return {"thought": "analizar error", "action": "analyze_error", "input": input_text}
    if "archivo" in input_text.lower():
        return {"thought": "leer archivo", "action": "read_file", "input": "app.py"}

    return {"thought": "respuesta directa", "action": None, "input": input_text}

def run_tool(action, data):
    if action in TOOLS:
        return TOOLS[action](data)
    return "acción inválida"

def agent_loop(user_input):
    state = {"final": None, "last": {}}

    for _ in range(MAX_STEPS):
        decision = think(user_input)

        obs = None
        if decision["action"]:
            obs = run_tool(decision["action"], decision["input"])

        state["last"] = {
            "thought": decision["thought"],
            "action": decision["action"],
            "input": decision["input"],
            "observation": obs
        }

        if not decision["action"]:
            state["final"] = decision["input"]
            break

    if not state["final"]:
        state["final"] = "ok"

    return {**state["last"], "final": state["final"]}

# ================= SECURITY =================
def auth(req):
    return req.headers.get("Authorization") == f"Bearer {API_TOKEN}"

# ================= ERROR AUTO FIX =================
@app.errorhandler(Exception)
def handle_error(e):
    trace = traceback.format_exc()
    agent = agent_loop(trace)

    return jsonify({
        "error": str(e),
        "agent": agent
    }), 500

# ================= ADMIN AGENT =================
@app.route("/admin/agent", methods=["POST"])
def agent():
    if not auth(request):
        return jsonify({"error": "unauthorized"}), 401

    msg = request.json.get("message", "")

    memory.add("user", msg)
    res = agent_loop(msg)
    memory.add("agent", json.dumps(res))

    return jsonify(res)

@app.route("/")
def home():
    return {"status": "ok"}

if __name__ == "__main__":
    app.run(debug=True)
