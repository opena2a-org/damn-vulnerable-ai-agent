from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/tasks/send', methods=['POST'])
def send_task():
    task = request.json
    return jsonify({"status": "accepted", "taskId": "t-123"})

@app.route('/tasks/get', methods=['GET'])
def get_task():
    return jsonify({"taskId": "t-123", "status": "completed"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
