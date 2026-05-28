import '../../App.css';
import React, { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import VisualFeedback from './VisualFeedback';
import Editor from './Editor';
import globalState from '../global';
import { AudioCue } from '../../audioCue';
import socket from '../socket';
import _ from "lodash"; // Lodash helps with throttling

const IP = globalState.IP;

// Throttled logging to avoid overwhelming the server during rapid interactions
const logEvent = _.throttle((log) => {
    socket.emit("user_activity", log);
}, 3000);

function EditPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const [caption, setCaption] = useState('');
    const [feedback, setFeedback] = useState({});
    const [ogUrl, setOgUrl] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [history, setHistory] = useState([]);
    const [process, setProcess] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    
    // History management for Redo/Undo functionality
    const feedbackHistoryRef = useRef([]); // Saves up to 10 states
    const feedbackIndexRef = useRef(-1);
    
    // Auditory feedback system for non-visual loading cues
    const audioCue = new AudioCue();
    const [version, setVersion] = useState(0); // Trigger re-render
    const isInit = useRef(false);

    // Initialize state on new image upload
    useEffect(() => {
        if (location.state && location.state.imageUrl && feedbackHistoryRef.current.length === 0) {
            setCaption(location.state.caption);
            setFeedback({
                composition: location.state.composition,
                aesthetics: location.state.aesthetics,
                suggestions: location.state.suggestions
            });
            setImageUrl(location.state.imageUrl);
            setOgUrl(location.state.imageUrl);
            setHistory(location.state.history);

            // Save initial state to history for redo/undo
            pushFeedback(
                location.state.caption,
                { composition: location.state.composition, aesthetics: location.state.aesthetics, suggestions: location.state.suggestions },
                location.state.history,
                location.state.imageUrl
            );
        }
    }, [location.state]);

    // Setup Socket.IO listener for global reset triggered by the Wizard
    useEffect(() => {
        if (!isInit.current) {
            logEvent("Enter EditPage");
            isInit.current = true;
        }
        
        socket.on('reset_page', () => {
            navigate('/start');
        });

        return () => {
            socket.off('reset_page');
        };
    }, [navigate]);

    // Screen Reader support via ARIA live regions
    const announceStatus = (message) => {
        setStatusMessage(message);
    };

    // Handles the restoration of previous canvas states or requesting feedback for new edits
    const handleEdit = (newURL = '', mode) => {
        setProcess(true);

        if (mode === 'redo' && feedbackIndexRef.current < feedbackHistoryRef.current.length - 1) {
            feedbackIndexRef.current += 1;
            const restore = feedbackHistoryRef.current[feedbackIndexRef.current];
            restoreState(restore, "Redo complete.");
        }

        if (mode === 'undo' && feedbackIndexRef.current >= 0) {
            feedbackIndexRef.current -= 1;
            const restore = feedbackHistoryRef.current[feedbackIndexRef.current];
            restoreState(restore, "Undo complete.");
        }

        if (mode === 'revert') {
            const restore = feedbackHistoryRef.current[0];
            restoreState(restore, "Revert complete.");
            feedbackHistoryRef.current = feedbackHistoryRef.current.slice(0, 1);
            feedbackIndexRef.current = 0;
        }

        if (mode === 'new') {
            announceStatus("Edits complete. Generating feedback for new edits. Please wait.");
            audioCue.startTickingSound();
            setImageUrl(newURL);
            
            const formData = new FormData();
            formData.append('imageUrl', dataURLtoBlob(newURL));

            fetch(`http://${IP}:8000/feedback`, {
                method: 'POST',
                body: formData,
                credentials: 'include'
            })
            .then(response => response.json())
            .then(data => {
                const jsonString = data.feedback.replace(/```json\n|```/g, '');
                const newFeedback = JSON.parse(jsonString);
                
                setCaption(newFeedback["Caption"]);
                setFeedback({
                    composition: newFeedback["Object Description"],
                    aesthetics: newFeedback["Aesthetic Evaluation"],
                    suggestions: newFeedback["Suggestions"]
                });
                setHistory(data.history);
                
                pushFeedback(
                    newFeedback["Caption"],
                    {composition: newFeedback["Object Description"], aesthetics: newFeedback["Aesthetic Evaluation"], suggestions: newFeedback["Suggestions"] },
                    data.history,
                    newURL
                );

                audioCue.stopTickingSound();
                announceStatus("Feedback ready for new edits.");
                setVersion(prev => prev + 1);
                setProcess(false);
                window.scrollTo({ top: 0, behavior: "smooth" });
            })
            .catch((error) => {
                logEvent(`error: ${error}`);
                audioCue.stopTickingSound();
            });
        }
    };

    // Helper to update state and UI when traversing history
    const restoreState = (restore, message) => {
        setCaption(restore.caption);
        setFeedback({ ...restore.feedback });
        setImageUrl(restore.url);
        setHistory([...restore.history]);
        setVersion(prev => prev + 1);
        logEvent(message);
        announceStatus(message);
        setProcess(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    // Helper function to push image feedback for redo/undo array
    function pushFeedback(newCaption, newFeedback, newHistory, newURL) {
        let updatedHistory = [...feedbackHistoryRef.current];

        if (feedbackIndexRef.current < updatedHistory.length - 1) {
            updatedHistory = updatedHistory.slice(0, feedbackIndexRef.current + 1);
        }
        if (updatedHistory.length === 10) {
            updatedHistory.shift();
        }
    
        updatedHistory.push({
            caption: newCaption,
            feedback: newFeedback,
            history: newHistory,
            url: newURL
        });
    
        feedbackIndexRef.current = updatedHistory.length - 1;
        feedbackHistoryRef.current = updatedHistory;
   }

    // Convert Base64 data URL to a Blob for Flask processing
    function dataURLtoBlob(dataURL) {
        const arr = dataURL.split(',');
        const mimeMatch = arr[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : '';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        
        while(n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    }

    return (
        <main className="App">
            <header className='App-header'>
                <h1>Visual Expression Support</h1>
            </header>

            {process && (<p>Analyzing newly edited image...</p>)}
            
            {/* Visual Feedback Component (Participant's perception of the image) */}
            {!process && (
                <VisualFeedback
                    key={version}
                    imageCaption={caption}
                    initialFeedback={feedback}
                    url={imageUrl}
                    chatHistory={history}
                    onAnnounce={announceStatus}
                />
            )}

            {/* Editor Component (Participant's control surface) */}
            <Editor
                onEdit={handleEdit}
                ogURL={ogUrl}
                chatHistory={history}
                onAnnounce={announceStatus}
            />

            {/* ARIA live region for non-visual status announcements */}
            <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>
                {statusMessage}
            </div>
        </main>
  );
}

export default EditPage;
