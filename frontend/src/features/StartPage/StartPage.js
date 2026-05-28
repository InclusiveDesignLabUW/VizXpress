import '../../App.css';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';
import _ from "lodash";

// Throttled logging to track participant flow without overwhelming the server
const logEvent = _.throttle((log) => {
    socket.emit("user_activity", log);
}, 3000);

function StartPage() {
    const isInit = useRef(false);
    const navigate = useNavigate();
    const [statusMessage, setStatusMessage] = useState('');

    // ==========================================
    // 1. SESSION INITIALIZATION
    // ==========================================
    useEffect(() => {
        if (!isInit.current) {
            logEvent("Enter StartPage");
            isInit.current = true;
        }

        // Screen reader announcement that the system is waiting for the Wizard
        setStatusMessage('Loading image. Please wait.');

        // Listen for the researcher completing the initial image upload and GPT processing
        socket.on('upload_complete', (data) => {
            
            // Parse the GPT feedback payload
            const jsonString = data.feedback.replace(/```json\n|```/g, '');
            const feedback = JSON.parse(jsonString);

            // Announce to the screen reader that the environment is ready
            setStatusMessage('Image ready!');

            // Route the participant to the editing interface and pass the extracted context
            setTimeout(() => {
                navigate('/edit', {
                    state: {
                        caption: feedback["Caption"],
                        objects: feedback["Object List"],
                        composition: feedback["Object Description"],
                        aesthetics: feedback["Aesthetic Evaluation"],
                        suggestions: feedback["Suggestions"],
                        imageUrl: data.imageUrl,
                        history: data.history
                    }
                });
            }, 500);
        });

        return () => {
            socket.off('upload_complete');
        };
    }, [navigate]);

    // ==========================================
    // 2. ACCESSIBLE UI LAYOUT
    // ==========================================
    return (
        <main className='App'>
            <header className='App-header'>
                <h1>Visual Expression Support</h1>
            </header>

            <div className='App-container'>
                
                {/* Visual loading state while waiting for the Wizard */}
                <h2>Loading Image...</h2>

                {/* ARIA live region for status announcements.
                  This visually hidden div ensures screen reader users are notified
                  when the Wizard completes the upload and the image is ready.
                */}
                <div
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    style={{
                        position: 'absolute',
                        left: '-9999px',
                        width: '1px',
                        height: '1px',
                        overflow: 'hidden'
                    }}>
                    {statusMessage}
                </div>
            </div>
        </main>
    );
}

export default StartPage;
