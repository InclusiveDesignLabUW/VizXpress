import '../../App.css';
import React, { useEffect, useState } from 'react';
import globalState from '../global';
import socket from '../socket';

// Fetches the IP address configured by the researcher for local network routing
const IP = globalState.IP;

function Dashboard() {
  const [edits, setEdits] = useState({'filter': 'original'});
  const [image, setImage] = useState(null);
  const [ogImg, setOgImg] = useState(null);
  const [notifications, setNotifications] = useState(false);
  const [keyObjects, setKeyObjects] = useState('');
  const [imgUrl, setImgUrl] = useState('');

  // ==========================================
  // 1. REAL-TIME WIZARD-OF-OZ SYNCHRONIZATION
  // ==========================================
  useEffect(() => {
    // Listen for manual edit requests triggered by the participant's accessible interface
    socket.on('request_edit', (data) => {
        setEdits(data);
        setNotifications(true);
    });

    // Optional: Monitor participant activity logs in real-time
    socket.on("update_log", (data) => {
        console.log("Participant Activity:", data);
    });

    // Auto-download images modified by the participant so the Wizard
    // can open them in professional editing software to make complex refinements
    socket.on('new_img', (base64Url) => {
      try {
        const arr = base64Url.split(',');
        const mimeMatch = arr[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const byteCharacters = atob(arr[1]);
        const byteNumbers = new Uint8Array(byteCharacters.length);
        
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        
        const imageBlob = new Blob([byteNumbers], { type: mime });
        const timestamp = new Date().getTime();
        const filename = `participant_canvas_${timestamp}.${mime.split('/')[1]}`;
    
        const url = window.URL.createObjectURL(imageBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Error processing Base64 image:', error);
      }
    });

    return () => {
      socket.off('request_edit');
      socket.off('new_img');
      socket.off('update_log');
    };
  }, []);

  // ==========================================
  // 2. WIZARD CONTROLS & API CALLS
  // ==========================================
  
  // Triggers a hard reset on the participant's interface
  const handleReset = () => {
    socket.emit('reset');
  };

  // Uploads the base image to the Flask backend to generate the initial GPT description
  const handleUpload = async () => {
    if (!ogImg) return;
    const validImageTypes = ['image/jpeg', 'image/png', 'image/heic'];
    
    if (validImageTypes.includes(ogImg.type)) {
      const formData = new FormData();
      formData.append('file', ogImg);

      fetch(`http://${IP}:8000/upload`, {
            method: 'POST',
            body: formData,
            credentials: 'include'
        })
        .then(response => response.json())
        .then(data => {
            setImgUrl(data.image_url);
            console.log("Session initialized. Original image uploaded successfully.");
          })
          .catch((error) => {
            console.error('Error:', error);
        });
    }
  };

  // Uploads the manually edited image back to the server, pushing it to the participant
  const handleEditUpload = async () => {
    if (!image) return;

    const formData = new FormData();
    formData.append('image', image);

    try {
      const res = await fetch(`http://${IP}:8000/apply-edits`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const data = await res.json();
      if (data.status === 'success') {
        console.log('Edited file successfully pushed to participant.');
        setNotifications(false);
      }
    } catch (error) {
      console.error('Error uploading edited file:', error);
    }
  };

  // Transmits the JSON bounding box data to the participant's interface for spatial tracking
  const handleSubmit = () => {
    socket.emit('objects_fetched', keyObjects);
    console.log('Bounding boxes transmitted to participant.');
  };

  // ==========================================
  // 3. RESEARCHER UI LAYOUT
  // ==========================================
  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Wizard of Oz Dashboard</h1>
      
      <section style={{ marginBottom: '40px', padding: '20px', border: '1px solid #ccc' }}>
        <h2>Phase 1: Session Initialization</h2>
        
        <div style={{ marginBottom: '20px' }}>
          <h3>1. Upload Original Image</h3>
          <input type="file" onChange={(e) => setOgImg(e.target.files[0])} />
          <button onClick={handleUpload}>Process Base Image</button>
          {imgUrl && (
            <div style={{ marginTop: '10px' }}>
              <img src={imgUrl} alt="Uploaded base" style={{ maxWidth: '200px', borderRadius: '8px' }} />
            </div>
          )}
        </div>

        <div>
          <h3>2. Inject Object Bounding Boxes</h3>
          <p style={{ fontSize: '14px', color: '#666' }}>Format: {"{\"animated bird\": [669, 418, 128, 127], \"animated chick\": [53, 702, 220, 116]}"}</p>
          <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <textarea
                rows="4"
                style={{ width: '100%', marginBottom: '10px' }}
                value={keyObjects}
                onChange={(e) => setKeyObjects(e.target.value)}
                placeholder="Enter JSON bounding box array here..."
            />
            <button type="submit" disabled={!keyObjects.trim()}>Transmit Objects</button>
          </form>
        </div>
      </section>

      <section style={{ marginBottom: '40px', padding: '20px', border: '1px solid #ccc' }}>
        <h2>Phase 2: Live Intervention</h2>
        
        {notifications && (
          <div style={{ backgroundColor: '#ffcccc', padding: '10px', borderRadius: '5px', marginBottom: '20px' }}>
            <h3 style={{ color: '#cc0000', margin: 0 }}>⚠️ Action Required: Participant requested an edit!</h3>
          </div>
        )}

        <div style={{ marginBottom: '20px' }}>
          <h3>Participant Edit Requests:</h3>
          <div style={{ backgroundColor: '#f5f5f5', padding: '15px', borderRadius: '5px' }}>
            {Object.keys(edits).map((operation) => (
              <p key={operation} style={{ margin: '5px 0' }}>
                <strong>{operation}:</strong> {JSON.stringify(edits[operation])}
              </p>
            ))}
          </div>
        </div>

        <div>
          <h3>Push Manual Edits to Participant</h3>
          <p style={{ fontSize: '14px', color: '#666' }}>Upload the image modified in your local photo editor to update the participant's canvas.</p>
          <input type="file" onChange={(e) => setImage(e.target.files[0])} />
          <button onClick={handleEditUpload}>Push Edited Image</button>
        </div>
      </section>

      <section style={{ padding: '20px', border: '1px solid #ff9999', backgroundColor: '#fff5f5' }}>
        <h2 style={{ color: '#cc0000' }}>Emergency Controls</h2>
        <p style={{ fontSize: '14px' }}>Force the participant's UI back to the start page. Use with caution.</p>
        <button onClick={handleReset} style={{ backgroundColor: '#cc0000', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '5px', cursor: 'pointer' }}>
          Force Reset Participant UI
        </button>
      </section>
    </div>
  );
}

export default Dashboard;
