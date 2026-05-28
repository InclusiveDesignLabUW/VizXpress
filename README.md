# VizXpress Prototype

This repository contains the research prototype developed for the ASSETS 2025 paper:

**VizXpress: Towards Expressive Visual Content by Blind Creators Through AI Support**  
ASSETS 2025: The 27th International ACM SIGACCESS Conference on Computers and Accessibility  
DOI: https://doi.org/10.1145/3663547.3746345

## About This Repository

VizXpress is a research prototype that explores how AI-assisted tools can support blind and low-vision creators in making expressive visual content.

The prototype was developed as part of a research study, rather than as a production-ready visual editing system. It supports interactions such as image upload, basic visual editing, AI-generated visual feedback, clarification questions about an image, editing recommendations, sticker generation, and researcher-assisted editing through a wizard-of-oz workflow.

This repository is intended primarily as a scientific and research reference. It documents the implementation used in the study and may be useful for researchers, designers, and developers interested in accessible visual authoring, AI-assisted creative support, and wizard-of-oz prototyping.

This repository is **not intended to be a maintained, fully deployable, or general-purpose editing application**. Some functionality depends on local configuration, external API access, study-specific workflows, and researcher intervention.

## System Overview

The prototype is a distributed system with a React frontend and a Python Flask backend.

### Frontend

The frontend is implemented in React and includes both the participant-facing interface and the researcher-facing dashboard.

The participant interface allows users to:

- Upload and edit visual content
- Request AI-generated feedback about an image
- Ask clarification questions about the image
- Request editing recommendations
- Generate and place visual elements such as stickers

The researcher dashboard supports the wizard-of-oz workflow used in the study. It allows a researcher to monitor participant actions, maintain shared system state, and manually support more complex editing operations.

The frontend also uses **Fabric.js Canvas** to provide a programmatic canvas surface for image manipulation. This supports visual editing operations while allowing relevant controls and state to be exposed through accessible interface components.

### Backend

The backend is implemented in Python using Flask. The current version of the repository uses `server.py` as the backend entry point.

The backend handles:

- OpenAI API integration
- GPT-based visual feedback
- GPT-based image question answering
- Editing recommendations
- DALL-E-based sticker generation
- Prompt loading from local prompt files
- Image upload, resizing, and processing
- File handling for uploaded and edited images
- Socket.IO communication between the participant interface and researcher dashboard

The backend is configured to run on port `8000`.

## Repository Structure

```text
VES-main/
├── frontend/                # React participant and researcher interface
│   ├── public/              # Static assets, such as favicons and manifest files
│   ├── src/
│   │   ├── features/
│   │   │   ├── DashboardPage/
│   │   │   │   └── DashboardPage.js
│   │   │   ├── EditPage/
│   │   │   │   ├── EditPage.js
│   │   │   │   ├── Editor.js
│   │   │   │   ├── Editor.css
│   │   │   │   ├── VisualFeedback.js
│   │   │   │   └── VisualFeedback.css
│   │   │   ├── StartPage/
│   │   │   │   └── StartPage.js
│   │   │   ├── global.js    # Central configuration for server IP/address
│   │   │   └── socket.js    # Shared Socket.IO client instance
│   │   ├── App.js           # Main application routing
│   │   ├── App.css
│   │   ├── index.js
│   │   ├── index.css
│   │   └── audioCue.js
│   ├── package.json         # Frontend dependencies
├── prompts/                 # Prompt engineering files for GPT/DALL-E functionality
│   ├── feedback.txt
│   ├── qna.txt
│   ├── recommendation.txt
│   ├── location.txt
│   ├── generate_stickers.txt
│   └── describe_stickers.txt
├── server.py                # Backend Flask API and system logic
└── README.md                # Project documentation and setup
```

## Setup and Installation

This prototype was developed using Node.js, React, Python, Flask, Socket.IO, Fabric.js, and OpenAI API-related dependencies.

Tested development versions include:

- Node.js: `v22.2.0`
- npm: `v10.7.0`
- Python: `3.9.7`

Other nearby versions may work, but they have not been systematically tested.

### 1. Install Node.js and Python

Before setting up the repository, make sure you have Node.js, npm, and Python 3 installed.

You can check your installed versions with:

```bash
node -v
npm -v
python3 --version
```

### 2. Install frontend dependencies

From the repository root:

```bash
cd frontend
npm install
```

This installs the React frontend dependencies listed in `frontend/package.json`.

### 3. Set up the Python backend environment

Return to the repository root:

```bash
cd ..
python3 -m venv venv
source venv/bin/activate
```

Install the backend dependencies:

```bash
pip install Flask flask-cors flask-socketio python-socketio openai requests Pillow
```

Depending on your local environment and Socket.IO configuration, you may also need an async server package such as:

```bash
pip install eventlet
```

If the repository includes a `requirements.txt` file in the future, you can instead install backend dependencies with:

```bash
pip install -r requirements.txt
```

### 4. Configure the OpenAI API key

The AI feedback, image question answering, recommendation, and sticker generation features require access to the OpenAI API.

Set your OpenAI API key as an environment variable:

```bash
export OPENAI_API_KEY="your_api_key_here"
```

Alternatively, you may configure the key using your preferred local environment management approach.

### 5. Configure the frontend server address

The frontend uses the following file as the central place for configuring the backend server address:

```text
frontend/src/features/global.js
```

If the frontend and backend are running on the same machine, the frontend should point to:

```text
http://localhost:8000
```

If the participant interface, researcher dashboard, or backend are running across different devices, update `global.js` to point to the backend machine’s local network address, for example:

```text
http://192.168.x.x:8000
```

## Running the Prototype

The backend and frontend should be run in separate terminal windows.

### 1. Start the Flask backend

From the repository root:

```bash
source venv/bin/activate
python server.py
```

The backend is configured to run at:

```text
http://localhost:8000
```

Because the server is configured with `host='0.0.0.0'`, it can also be accessed from another device on the same network using the server machine’s local IP address:

```text
http://<server-machine-ip>:8000
```

The backend must be running for OpenAI integration, image processing, file handling, and Socket.IO synchronization to work.

### 2. Start the React frontend

In a separate terminal, from the repository root:

```bash
cd frontend
npm start
```

## Prompt Files

The `prompts/` directory contains text files used to guide GPT and DALL-E interactions.

```text
prompts/
├── feedback.txt
├── qna.txt
├── recommendation.txt
├── location.txt
├── generate_stickers.txt
└── describe_stickers.txt
```

These prompts are loaded by the backend at runtime. Changes to these files may affect the behavior of visual feedback, question answering, editing recommendations, sticker generation, and sticker descriptions.

## Research Prototype Notes

This repository reflects a research prototype used in a controlled study setting. It should be interpreted as an implementation reference rather than a general-purpose visual editing tool.

In particular:

- The system was designed for research use, not public deployment.
- Some editing features may rely on researcher intervention through the dashboard.
- Some prompts, routes, and workflows are specific to the study design.
- Accessibility-related interface decisions reflect the goals and constraints of the original study.
- Additional setup may be required for a new machine, network, or study environment.

Researchers who wish to build on this work should adapt the prototype to their own study context, participant needs, accessibility requirements, and deployment environment.

## Citation

If you use or refer to this prototype in academic work, please cite the associated paper:

```bibtex
@inproceedings{zhang2025vizxpress,
  title = {VizXpress: Towards Expressive Visual Content by Blind Creators Through AI Support},
  author = {Zhang, Lotus and Zhang, Zhuohao and Clepper, Gina and Li, Franklin Mingzhe and Carrington, Patrick and Wobbrock, Jacob O. and Findlater, Leah},
  booktitle = {Proceedings of the 27th International ACM SIGACCESS Conference on Computers and Accessibility},
  year = {2025},
  doi = {10.1145/3663547.3746345}
}
```
