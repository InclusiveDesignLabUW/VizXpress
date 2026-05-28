import os
import io
import base64
import requests

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO
from werkzeug.utils import secure_filename
from PIL import Image, ImageOps
from openai import OpenAI

# -------------------------------------------------------------------
# App Configuration & Setup
# -------------------------------------------------------------------
app = Flask(__name__)
CORS(app, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*")

app.config['UPLOAD_FOLDER'] = 'uploads/'
app.config['EDITED_FOLDER'] = 'edited/'

# IMPORTANT: Never hardcode API keys. Use environment variables.
API_KEY = os.environ.get("OPENAI_API_KEY", "your_api_key_placeholder_here")
PROMPT_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prompts')

# Global state variables
image_w = None
image_h = None

# Wizard's global edit operations state
edit_operations = {
    'filter': None
}

# -------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------
def blob_to_data_url(file_storage):
    """
    Converts a Flask FileStorage object (the uploaded blob) into a base64 data URL.
    """
    file_content = file_storage.read()
    base64_encoded = base64.b64encode(file_content).decode('utf-8')
    return f"data:{file_storage.content_type};base64,{base64_encoded}"

def image2base64(img):
    """
    Converts a PIL Image object into a base64 PNG data URL string.
    """
    buffered = io.BytesIO()
    img.save(buffered, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{img_str}"

def make_background_transparent(image, threshold=250):
    """
    Processes an image to make predominantly white/bright backgrounds transparent.
    Used during sticker generation.
    """
    image = image.convert("RGBA")
    datas = image.getdata()
    new_data = []
    for item in datas:
        if item[0] > threshold and item[1] > threshold and item[2] > threshold:
            new_data.append((255, 255, 255, 0)) # Transparent
        else:
            new_data.append(item)
    image.putdata(new_data)
    return image

# -------------------------------------------------------------------
# Core API Endpoints
# -------------------------------------------------------------------
@app.route('/upload', methods=['POST'])
def upload_file():
    """
    Handles the initial image upload. Resizes the image if it exceeds
    the maximum dimensions, converts it to base64, and requests initial feedback from GPT.
    """
    global image_w, image_h

    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    filename = secure_filename(file.filename)
    if file:
        img = Image.open(file)
        img = ImageOps.exif_transpose(img)

        # Scale down image if it exceeds the maximum dimension
        max_dimension = 1024
        w, h = img.size
        if w > max_dimension or h > max_dimension:
            scale = min(max_dimension / w, max_dimension / h)
            w = int(w * scale)
            h = int(h * scale)
            img = img.resize((w, h), Image.Resampling.LANCZOS)

        # Store global dimensions for later filtering
        image_w, image_h = w, h
        image_url = image2base64(img)
        socketio.emit('image_uploaded', image_url)

        # Retrieve visual feedback via GPT Vision
        prompt = OpenAI_API.read_prompt("feedback")
        feedback = api.get_text_response_vision(prompt=prompt, query="", image_url=image_url, prev_messages=[])

        history = [{'q': prompt, 'a': feedback}]
        upload_info = {"imageUrl": image_url, "history": history, "feedback": feedback}
        socketio.emit('upload_complete', upload_info)

        return jsonify({"message": "File uploaded successfully", "feedback": feedback, "image_url": image_url}), 200

@app.route('/feedback', methods=['POST'])
def feedback():
    """
    Requests updated feedback from GPT regarding newly applied image edits.
    """
    file = request.files['imageUrl']
    image_url = blob_to_data_url(file)

    prompt = OpenAI_API.read_prompt("feedback")
    feedback = api.get_text_response_vision(prompt=prompt, query="", image_url=image_url, prev_messages=[])

    history = [{'q': prompt, 'a': feedback}]
    socketio.emit('new_img', image_url)

    return jsonify({"message": "Feedback generated successfully", "imageUrl": image_url, "history": history, "feedback": feedback}), 200

@app.route('/question', methods=['POST'])
def ask_question():
    """
    Handles direct Q&A about the image utilizing GPT Vision and chat history.
    """
    file = request.files['imageUrl']
    image_url = blob_to_data_url(file)
    question = request.form.get('question')
    chat_history = request.form.get('chatHistory')

    prompt = OpenAI_API.read_prompt("qna")
    response = api.get_text_response_vision(prompt=prompt, query=question, image_url=image_url, prev_messages=chat_history)
    
    history_entry = {'q': question, 'a': response}

    return jsonify({"message": "Chat successful", "history_entry": history_entry, "answer": response}), 200

@app.route('/recommendations', methods=['POST'])
def get_recommendations():
    """
    Generates editing recommendations based on user requirements and key objects in the image.
    """
    file = request.files['imageUrl']
    image_url = blob_to_data_url(file)
    requirement = request.form.get('requirement')
    chat_history = request.form.get('chatHistory')
    key_objects = request.form.get('keyObjects')

    prompt = OpenAI_API.read_prompt("recommendation") + key_objects
    response = api.get_text_response_vision(prompt=prompt, query=requirement, image_url=image_url, prev_messages=chat_history)
    
    history_entry = {'q': requirement, 'a': response}

    return jsonify({"message": "Recommendations generated", "history_entry": history_entry, "answer": response}), 200

@app.route('/generatestickers', methods=['POST'])
def generate_stickers():
    """
    Generates transparent stickers using DALL-E based on a user prompt,
    and requests a description for each generated sticker.
    """
    user_prompt = request.form.get('prompt')
    prompt = OpenAI_API.read_prompt("generate_stickers")
    urls = api.generate_image(prompt + user_prompt)

    stickers = []
    describe_prompt = OpenAI_API.read_prompt("describe_stickers")
    description_history = []

    for url in urls:
        response = api.get_text_response_vision(prompt=describe_prompt, query="", image_url=url, prev_messages=description_history)
        description_history.append(response)

        image_from_url = requests.get(url)
        image_from_url.raise_for_status()
        image = Image.open(io.BytesIO(image_from_url.content))
        
        transparent_image = make_background_transparent(image)
        stickers.append({"url": image2base64(transparent_image), "description": response})

    return jsonify({'stickers': stickers})

@app.route('/placement', methods=['POST'])
def get_placement():
    """
    Asks GPT to estimate the optimal spatial placement of an element
    on the image based on requirements and detected objects.
    """
    file = request.files['imageUrl']
    image_url = blob_to_data_url(file)
    requirement = request.form.get('request')
    chat_history = request.form.get('chatHistory')
    key_objects = request.form.get('keyObjects')

    prompt = OpenAI_API.read_prompt("location") + key_objects
    placement = api.get_text_response_vision(prompt=prompt, query=requirement, image_url=image_url, prev_messages=chat_history)

    return jsonify({'placement': placement})

@app.route('/apply-edits', methods=['POST'])
def apply_edits():
    """
    Applies the wizard's filtered edits to the image and broadcasts it back.
    """
    if 'image' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['image']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
        
    if file:
        img = Image.open(file)
        img = ImageOps.exif_transpose(img)
        img = img.resize((image_w, image_h), Image.Resampling.LANCZOS)
        filter_url = image2base64(img)
        
        socketio.emit('edits_complete', filter_url)
        return jsonify({"status": "success", "file_path": filter_url}), 201

# -------------------------------------------------------------------
# Static File & Wizard Endpoints
# -------------------------------------------------------------------
@app.route('/uploads/<filename>')
def uploaded_file(filename):
    """Serves uploaded files from the UPLOAD_FOLDER."""
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/edited/<filename>')
def edited_file(filename):
    """Serves edited files from the EDITED_FOLDER."""
    return send_from_directory(app.config['EDITED_FOLDER'], filename)

@app.route('/edits', methods=['GET'])
def get_edits():
    """Returns the current state of edit operations."""
    return jsonify(edit_operations), 200

# -------------------------------------------------------------------
# WebSockets (SocketIO)
# -------------------------------------------------------------------
@socketio.on('request_edit')
def request_edit(data):
    """Updates the global edit_operations dictionary and broadcasts to the researcher."""
    global edit_operations
    edit_operations.update(data)
    socketio.emit('request_edit', edit_operations)

@socketio.on('objects_fetched')
def fetch_objects(data):
    """Broadcasts fetched object data."""
    socketio.emit('objects_fetched', data)

@socketio.on('reset')
def reset():
    """Triggers a frontend reset."""
    socketio.emit('reset_page')

# -------------------------------------------------------------------
# OpenAI API Wrapper
# -------------------------------------------------------------------
class OpenAI_API:
    """Singleton wrapper for managing OpenAI API calls."""
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(OpenAI_API, cls).__new__(cls)
        return cls._instance

    def __init__(self):
        self._client = self._setup()

    def _setup(self):
        """Initializes the OpenAI Client using the API Key."""
        client = OpenAI(api_key=API_KEY)
        return client

    def call_vision(self, prompt, query, image_url, prev_messages=[], model="gpt-4o"):
        """Calls GPT-4o specifically to process vision (image) requests."""
        messages = [{"role": "system", "content": prompt}]

        for q, a in prev_messages:
            messages.append({"role": "user", "content": q})
            messages.append({"role": "assistant", "content": a})

        messages.append({
            "role": "user",
            "content": [
                {"type": "text", "text": query},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        })

        response = self._client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0,
            max_tokens=1500,
        )
        return response

    def get_text_response_vision(self, prompt, query, image_url, prev_messages):
        """Helper to extract text content directly from a Vision API response."""
        try:
            response = self.call_vision(prompt, query, image_url, prev_messages)
            response_text = response.choices[0].message.content
            return response_text
        except Exception as e:
            print(f"An error occurred: {e}")
            return None

    def generate_image(self, prompt, n=1, size="1024x1024"):
        """Generates an image via DALL-E and returns a list of image URLs."""
        try:
            response = self._client.images.generate(
                model="dall-e-2",
                prompt=prompt,
                n=n,
                size=size
            )

            if response is not None and hasattr(response, 'data'):
                image_urls = [img.url for img in response.data]
                return image_urls
            else:
                return []
        except Exception as e:
            print(f"An error occurred: {e}")
            return None

    @staticmethod
    def read_prompt(file_name):
        """Reads and returns prompt instructions from the local prompts folder."""
        file_path = os.path.join(PROMPT_FOLDER, file_name + ".txt")
        try:
            with open(file_path, "r") as file:
                return file.read()
        except FileNotFoundError:
            print(f"File not found: {file_path}")
            return ""

# Initialize the API Wrapper
api = OpenAI_API()

# -------------------------------------------------------------------
# Server Execution
# -------------------------------------------------------------------
if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=8000)
