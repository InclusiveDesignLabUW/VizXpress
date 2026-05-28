import React, { useEffect, useRef, useState } from 'react';
import './VisualFeedback.css';
import { AudioCue } from '../../audioCue';
import globalState from '../global';
import socket from '../socket';
import _ from "lodash";

const IP = globalState.IP;
const logEvent = _.throttle((log) => {
    socket.emit("user_activity", log);
}, 3000);

function VisualFeedback({ url, imageCaption, initialFeedback, chatHistory, onAnnounce }) {
    const [curImgUrl, setCurImgUrl] = useState('');
    const [curCaption, setCurCaption] = useState('');
    const [curFeedback, setCurFeedback] = useState({});
    const [inputText, setInputText] = useState('');
    const [curQnA, setCurQnA] = useState([]);
    const [curHistory, setCurHistory] = useState([]);
    
    // UI State for expanding/collapsing feedback sections
    const [openAesthetics, setOpenAesthetics] = useState(false);
    const [openObj, setOpenObj] = useState(false);
    const [openSuggestion, setOpenSuggestion] = useState(false);
    
    const latestEntryRef = useRef(null);
    const feedbackContainerRef = useRef(null);
    const audioCue = new AudioCue();

    // Sync state with props when a new edit completes
    useEffect(() => {
        setCurImgUrl(url);
        setCurCaption(imageCaption);
        setCurFeedback(initialFeedback);
        setCurHistory(chatHistory);
        setCurQnA([]);
    }, [imageCaption, url, initialFeedback, chatHistory]);

    const addQnAEntry = (entry) => {
        setCurQnA(prev => [...prev, entry]);
    };

    const handleInputChange = (event) => {
        setInputText(event.target.value);
        logEvent("Type Questions");
    };

    // Handle user questions to the vision model
    const handleSubmit = () => {
        logEvent("Submit Questions");
        addQnAEntry("Question: " + inputText);
        onAnnounce("Question received. Analyzing.");
        audioCue.startTickingSound();

        const formData = new FormData();
        formData.append('imageUrl', dataURLtoBlob(curImgUrl));
        formData.append('question', inputText);
        formData.append('chatHistory', curHistory);

        fetch(`http://${IP}:8000/question`, {
            method: 'POST',
            body: formData,
            credentials: 'include'
        })
        .then(response => response.json())
        .then(data => {
            audioCue.stopTickingSound();
            addQnAEntry("Answer: " + data.answer);
            setCurHistory(prev => [...prev, data.history_entry]);
            setInputText('');
            onAnnounce(`Answer ready: ${data.answer}`);
        })
        .catch((error) => {
            audioCue.stopTickingSound();
            logEvent(`error: ${error}`);
            onAnnounce("Sorry. I'm not able to answer your question. " + error);
            addQnAEntry(error.message || "An error occurred.");
        });
    };

    const handleDownload = () => {
        logEvent("Select Download Image");
        if (!curImgUrl) return;
        
        const link = document.createElement('a');
        link.href = curImgUrl;
        const timestamp = new Date().getTime();
        link.download = `edited_image_${timestamp}.png`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

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

    // Collapse sections when focus completely leaves the feedback container
    const handleBlur = (event) => {
        if (!feedbackContainerRef.current.contains(event.relatedTarget)) {
            logEvent("Leave Visual Feedback");
            setOpenAesthetics(false);
            setOpenObj(false);
            setOpenSuggestion(false);
        }
    };

    const toggleSection = (section) => {
        setOpenObj(section === "object_information");
        setOpenAesthetics(section === "aesthetics_feedback");
        setOpenSuggestion(section === "suggestion");
        logEvent(`Expand ${section}`);
    };
    
    return (
        <div className="feedback-container">
            <section aria-labelledby='feedback-header' className="feedback-entry">
                <h2 id="feedback-header">Visual Feedback</h2>

                <h3>Image</h3>
                <div className='image-container'>
                    <img src={curImgUrl} alt={curCaption} className="uploaded-image"/>
                    {curImgUrl && (
                        <button
                            type="button"
                            onClick={handleDownload}
                            aria-label="Download the current image as PNG"
                            className="download-button"
                        >
                            Download Current Image
                        </button>
                    )}
                </div>

                <h3>Feedback</h3>
                
                {/* HCI Feature: Hierarchical accordion layout prevents screen reader overload */}
                <div ref={feedbackContainerRef} tabIndex="-1" onBlur={handleBlur}>
                    <div>
                        <button aria-expanded={openObj} onClick={() => toggleSection("object_information")}>Object Information</button>
                        <div hidden={!openObj}>
                            <h4>Object Information:</h4>
                            <ul>
                            {curFeedback.composition && Object.entries(curFeedback.composition).map(([key, value]) => (
                                <li key={key}> <p>{key}: {value} </p> </li>
                            ))}
                            </ul>
                        </div>
                    </div>

                    <div>
                        <button aria-expanded={openAesthetics} onClick={() => toggleSection("aesthetics_feedback")}>Aesthetics Evaluation</button>
                        <div hidden={!openAesthetics}>
                            <h4>Aesthetics Evaluation:</h4>
                            <ul>
                            {curFeedback.aesthetics && Object.entries(curFeedback.aesthetics).map(([key, value]) => (
                                <li key={key}> <p>{key}: {value}</p> </li>
                            ))}
                            </ul>
                        </div>
                    </div>

                    <div>
                        <button aria-expanded={openSuggestion} onClick={() => toggleSection("suggestion")}>Suggestions</button>
                        <div hidden={!openSuggestion}>
                            <h4>Suggestions:</h4>
                            {curFeedback.suggestions?.length > 0 ? (
                                <ul>
                                    {curFeedback.suggestions.map((obj, index) => (
                                        <li key={index}><p>{obj}</p></li>
                                    ))}
                                </ul>
                            ) : <p>No specific suggestion for improvement</p>}
                        </div>
                    </div>
                </div>

                {/* Interactive Q&A Section */}
                <h3>Question and Answer</h3>
                {curQnA.map((entry, index) => (
                    <div key={index} className="feedback-entry" tabIndex="-1" ref={index === curQnA.length - 1 ? latestEntryRef : null}>
                        <p>{entry}</p>
                    </div>
                ))}

                <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                    <label htmlFor="question-input"> Ask any questions about the image </label>
                    <input
                        id="question-input"
                        type="text"
                        value={inputText}
                        onChange={handleInputChange}
                        className="text-entry"
                        aria-describedby="Enter at least one word to enable the request answer button."/>
                    <button type="submit" disabled={!inputText.trim()} >Request Answer</button>
                </form>
            </section>
        </div>
    );
}

export default VisualFeedback;
