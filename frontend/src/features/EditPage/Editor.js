import React, { useEffect, useState, useRef, useCallback } from 'react';
import './Editor.css';
import { AudioCue } from '../../audioCue';
import globalState from '../global';
import * as fabric from 'fabric';
import socket from '../socket';
import { v4 as uuidv4 } from 'uuid';
import _ from "lodash";

const IP = globalState.IP;
const logEvent = _.throttle((log) => {
    socket.emit("user_activity", log);
}, 3000);

function Editor({ onEdit, ogURL, chatHistory, onAnnounce }) {
    // UI Expand/Collapse States
    const [openRec, setOpenRec] = useState(false);
    const [openColorLighting, setOpenColorLighting] = useState(false);
    const [openFilter, setOpenFilter] = useState(false);
    const [openCrop, setOpenCrop] = useState(false);
    const [openText, setOpenText] = useState(false);
    const [openSticker, setOpenSticker] = useState(false);

    // Canvas & Memory Refs
    const hasInitialized = useRef(false);
    const mainImageRef = useRef(null);
    const textboxMapRef = useRef(new Map());
    const stickerMapRef = useRef(new Map());
    const filterMapRef = useRef(new Map());
    const fabricCanvasRef = useRef(null);

    // State Variables
    const [keyObjects, setKeyObjects] = useState({});
    const [imgShape, setImgShape] = useState([0,0]);
    const [curURL, setCurURL] = useState(ogURL);
    const [cropSelection, setCropSelection] = useState([]);
    const [cropBox, setCropBox] = useState([]);
    const [cropSpace, setCropSpace] = useState('');
    const [colorLighting, setColorLighting] = useState({brightness: 0, contrast: 0, saturation: 0});
    const [textboxes, setTextboxes] = useState([]);
    const [textForm, setTextForm] = useState(false);
    const [textUpdate, setTextUpdate] = useState(false);
    const [currentTextbox, setCurrentTextbox] = useState(null);
    const [stickers, setStickers] = useState([]);
    const [stickerForm, setStickerForm] = useState(false);
    const [stickerUpdate, setStickerUpdate] = useState(false);
    const [currentSticker, setCurrentSticker] = useState({});
    const [filter, setFilter] = useState('original');
    const [applyFilter, setApplyFilter] = useState(false);

    // Recommendation State
    const [recommendations, setRecommendations] = useState(null);
    const [recEdits, setRecEdits] = useState({});
    const [applyRec, setApplyRec] = useState(false);

    // History and Sync State
    const [version, setVersion] = useState(0);
    const [newEdit, setNewEdit] = useState(false);
    const [newFeedback, setNewFeedback] = useState(null);
    const historyRef = useRef([]); // Saves up to 10 snapshots
    const historyIndexRef = useRef(-1);
    const isRestoringRef = useRef(false);
    const [error, setError] = useState('');
    const audioCue = new AudioCue();

    // ==========================================
    // 1. CANVAS INITIALIZATION & MANAGEMENT
    // ==========================================
    useEffect(() => {
        const setupCanvas = async () => {
            if (ogURL.length === 0 || hasInitialized.current) return;

            try {
                setCurURL(ogURL);
                const offScreenCanvas = document.createElement('canvas');
                const tempCanvas = new fabric.Canvas(offScreenCanvas, { selection: false });
                fabricCanvasRef.current = tempCanvas;
                hasInitialized.current = true;

                const img = await fabric.FabricImage.fromURL(ogURL);
                setImgShape([img.width, img.height]);
                setCropBox([0, 0, img.width, img.height]);
                tempCanvas.setDimensions({width: img.width, height: img.height});

                img.set({
                    left: 0, top: 0, selectable: false, scaleX: 1, scaleY: 1, name: "img", id: "original"
                });
                
                mainImageRef.current = img;
                tempCanvas.clear();
                tempCanvas.add(img);
                filterMapRef.current.set('original', img);

                setNewEdit(true);
                tempCanvas.renderAll();
            } catch (err) {
                setError(err.message);
                logEvent(`error: ${err.message}`);
            }
        };

        setupCanvas();

        return () => {
            if (fabricCanvasRef.current) {
                fabricCanvasRef.current.dispose();
                hasInitialized.current = false;
            }
        };
    }, [ogURL]);

    // Save snapshot of canvas parameters for undo/redo
    useEffect(() => {
        if (newEdit && !isRestoringRef.current) {
            const canvasJSON = fabricCanvasRef.current.toObject(['name', 'id']);
            const snapshot = {
                canvasJSON, cropBox, cropSelection, cropSpace, colorLighting,
                textboxes, stickers, filter, recommendations, recEdits
            };
            pushSnapshot(snapshot);
        }
    }, [recEdits, colorLighting, cropBox, textboxes, stickers, newEdit, filter]);

    // Export newly edited canvas for GPT feedback
    useEffect(() => {
        if (newFeedback) {
            const dataURL = fabricCanvasRef.current.toDataURL({ format: 'png', quality: 0.8 });
            onEdit(dataURL, newFeedback);
            setNewFeedback(null);
            setCurURL(dataURL);
        }
    }, [newFeedback, onEdit]);

    // ==========================================
    // 2. WIZARD OF OZ / REAL-TIME SOCKET EVENTS
    // ==========================================
    
    // Fetch key objects isolated by the Wizard
    useEffect(() => {
        socket.on('objects_fetched', (data) => {
            logEvent("system: object fetched");
            setKeyObjects(JSON.parse(data));
        });
        return () => socket.off('objects_fetched');
    }, []);

    // Signal wizard to manually apply complex filters
    useEffect(() => {
        if (filter && applyFilter && !applyRec) {
            if (filterMapRef.current.get(filter)){
                handleFilter(filterMapRef.current.get(filter));
            } else {
                audioCue.startTickingSound();
                // Emits a request to the researcher dashboard
                socket.emit('request_edit', {'filter': filter});
            }
            setApplyFilter(false);
        }
    }, [filter, applyFilter, applyRec, audioCue]);

    // Load filter when Wizard returns the processed image
    useEffect(() => {
        socket.on('edits_complete', (data) => {
            audioCue.stopTickingSound();
            AddFilter(data);
        });
        return () => socket.off('edits_complete');
    }, [AddFilter]); // Note: AddFilter wrapped in useCallback below


    // ==========================================
    // 3. EDIT ACTIONS (Color, Crop, Text, Filters)
    // ==========================================
    const handleApplyBrightness = (value) => {
        if (!fabricCanvasRef.current) return;
        try {
            const imgObj = mainImageRef.current;
            imgObj.filters = imgObj.filters.filter(f => !(f instanceof fabric.filters.Brightness));

            if (value !== 0) {
                imgObj.filters.push(new fabric.filters.Brightness({ brightness: value / 100 }));
            }
            imgObj.applyFilters();
            fabricCanvasRef.current.renderAll();

            setColorLighting(prev => ({ ...prev, brightness: value }));
            if (!applyRec && !isRestoringRef.current) { setNewEdit(true); setNewFeedback('new'); }
            logEvent("system: brightness changed");
        } catch (err) { setError(err.message); }
    };

    const handleApplyContrast = (value) => {
        if (!fabricCanvasRef.current) return;
        try {
            const imgObj = mainImageRef.current;
            imgObj.filters = imgObj.filters.filter(f => !(f instanceof fabric.filters.Contrast));

            if (value !== 0) {
                imgObj.filters.push(new fabric.filters.Contrast({ contrast: value / 100 }));
            }
            imgObj.applyFilters();
            fabricCanvasRef.current.renderAll();

            setColorLighting(prev => ({ ...prev, contrast: value }));
            if (!applyRec && !isRestoringRef.current) { setNewEdit(true); setNewFeedback('new'); }
            logEvent("system: contrast changed");
        } catch (err) { setError(err.message); }
    };

    const handleApplySaturation = (value) => {
        if (!fabricCanvasRef.current) return;
        try {
            const imgObj = mainImageRef.current;
            imgObj.filters = imgObj.filters.filter(f => !(f instanceof fabric.filters.Saturation));

            if (value !== 0) {
                imgObj.filters.push(new fabric.filters.Saturation({ saturation: value / 100 }));
            }
            imgObj.applyFilters();
            fabricCanvasRef.current.renderAll();

            setColorLighting(prev => ({ ...prev, saturation: value }));
            if (!applyRec && !isRestoringRef.current) { setNewEdit(true); setNewFeedback('new'); }
            logEvent("system: saturation changed");
        } catch (err) { setError(err.message); }
    };

    const handleCrop = (bbox) => {
        if (!fabricCanvasRef.current) return;
        try {
            const imgObj = mainImageRef.current;
            if (bbox) {
                imgObj.set({ cropX: bbox[0], cropY: bbox[1], width: bbox[2], height: bbox[3], left: 0, top: 0 });
                fabricCanvasRef.current.setDimensions({width: imgObj.width, height: imgObj.height});

                // Adjust textboxes to fit new cropped dimensions
                for (const [key, tb] of textboxMapRef.current) {
                    const newLeft = tb.left - bbox[0];
                    const newTop = tb.top - bbox[1];
                    tb.set({ left: newLeft, top: newTop }).setCoords();
                    setTextboxes(prev => prev.map(ptb => ptb.id === key ? { ...ptb, location: [newLeft, newTop] } : ptb));
                }

                // Adjust stickers to fit new cropped dimensions
                for (const [key, st] of stickerMapRef.current) {
                    const newLeft = st.left - bbox[0];
                    const newTop = st.top - bbox[1];
                    st.set({ left: newLeft, top: newTop }).setCoords();
                    setStickers(prev => prev.map(pst => pst.id === key ? { ...pst, location: [newLeft, newTop] } : pst));
                }
                fabricCanvasRef.current.renderAll();
            }
            fabricCanvasRef.current.sendObjectToBack(imgObj);
            setCropBox(bbox);
            if (!applyRec && !isRestoringRef.current) { setNewEdit(true); setNewFeedback('new'); }
            logEvent("system: crop complete");
        } catch (err) { setError(err.message); }
    };

    const AddFilter = useCallback(async (filterUrl) => {
        if (!fabricCanvasRef.current) return null;
        try {
            if (filterUrl) {
                const newFilter = await fabric.FabricImage.fromURL(filterUrl);
                newFilter.set({ selectable: false, left: 0, top: 0, name: "img", id: filter });
                newFilter.scaleToWidth(imgShape[0]);
                filterMapRef.current.set(filter, newFilter);
                handleFilter(newFilter);
            }
        } catch (err) { setError(err.message); }
    }, [filter, imgShape]);

    const handleFilter = (newFilter) => {
        mainImageRef.current = newFilter;
        fabricCanvasRef.current.add(newFilter);
        fabricCanvasRef.current.sendObjectToBack(newFilter);

        if (cropBox.length > 0) {
            newFilter.set({ cropX: cropBox[0], cropY: cropBox[1] });
        }
        fabricCanvasRef.current.renderAll();

        if (!applyRec && !isRestoringRef.current) { setNewEdit(true); setNewFeedback('new'); }
        logEvent("system: filter added");
    }

    const removeFilter = (oldFilter) => {
        if(filterMapRef.current.get(oldFilter)){
            fabricCanvasRef.current.remove(filterMapRef.current.get(oldFilter));
        }
    }

    const handleInsertText = async (textbox) => {
        if (!fabricCanvasRef.current || !textbox) return null;
        try {
            const charWidthFactor = 0.6;
            let newTextBox = new fabric.FabricText(textbox.input, {
                left: textbox.location[0],
                top: textbox.location[1],
                fill: textbox.color,
                fontSize: textbox.size / (textbox.input.length * charWidthFactor),
                fontFamily: textbox.font,
                backgroundColor: textbox.background
            });

            const id = textbox.id ? textbox.id : uuidv4();
            if (textboxMapRef.current.get(id)){
                fabricCanvasRef.current.remove(textboxMapRef.current.get(id));
            }
            
            newTextBox.name = 'textbox';
            newTextBox.id = id;
            fabricCanvasRef.current.add(newTextBox);
            fabricCanvasRef.current.bringObjectToFront(newTextBox);
            fabricCanvasRef.current.renderAll();
            textboxMapRef.current.set(id, newTextBox);
            
            const boundingBox = newTextBox.getBoundingRect();
            const newTextInfo = { id, boundingBox, ...textbox };

            setTextboxes(prev => {
                const index = prev.findIndex(tb => tb.id === id);
                return index !== -1 ? [...prev.slice(0, index), newTextInfo, ...prev.slice(index + 1)] : [...prev, newTextInfo];
            });

            if(!applyRec && !isRestoringRef.current) { setNewEdit(true); setNewFeedback('new'); }
            logEvent("system: text added");
            return [boundingBox.left, boundingBox.top, boundingBox.width, boundingBox.height];
        } catch (err) { setError(err.message); return null; }
    };

    const removeText = (textbox, id) => {
        if (textbox) {
            fabricCanvasRef.current.remove(textbox);
            fabricCanvasRef.current.renderAll();
            textboxMapRef.current.delete(id);
            setTextboxes(prev => prev.filter(tb => tb.id !== id));
            
            if(!applyRec && !isRestoringRef.current) { setNewEdit(true); setNewFeedback('new'); }
            logEvent("system: text removed");
        }
    };

    const handleInsertSticker = async (sticker) => {
        if (!fabricCanvasRef.current || !sticker) return null;
        try {
            const newSticker = await fabric.FabricImage.fromURL(sticker.url);
            const ratio = sticker.size / newSticker.width;
            
            newSticker.set({ left: sticker.location[0], top: sticker.location[1], selectable: false, scaleX: ratio, scaleY: ratio });
            
            const id = sticker.id ? sticker.id : uuidv4();
            const oldSticker = stickerMapRef.current.get(id);
            if (oldSticker) fabricCanvasRef.current.remove(oldSticker);
            
            newSticker.name = 'sticker';
            newSticker.id = id;
            fabricCanvasRef.current.add(newSticker);
            fabricCanvasRef.current.renderAll();
            stickerMapRef.current.set(id, newSticker);

            const boundingBox = newSticker.getBoundingRect();
            const newStickerInfo = { id, boundingBox, ...sticker };

            setStickers(prev => {
                const index = prev.findIndex(st => st.id === id);
                return index !== -1 ? [...prev.slice(0, index), newStickerInfo, ...prev.slice(index + 1)] : [...prev, newStickerInfo];
            });

            if(!applyRec && !isRestoringRef.current) { setNewEdit(true); setNewFeedback('new'); }
            logEvent("system: sticker added");
            return [boundingBox.left, boundingBox.top, boundingBox.width, boundingBox.height];
        } catch (err) { setError(err.message); return null; }
    };

    const removeSticker = (id) => {
        const sticker = stickerMapRef.current.get(id);
        if (sticker) {
            fabricCanvasRef.current.remove(sticker);
            fabricCanvasRef.current.renderAll();
            stickerMapRef.current.delete(id);
            setStickers(prev => prev.filter(st => st.id !== id));
            
            if(!applyRec && !isRestoringRef.current) { setNewEdit(true); setNewFeedback('new'); }
            logEvent("system: sticker removed");
        }
    };

    // ==========================================
    // 4. GPT RECOMMENDATION APPLICATION
    // ==========================================
    useEffect(() => {
        if (applyRec) {
            onAnnounce("Applying recommended edits");
            let newMessage = 'Edits complete.';

            if (recEdits.hasOwnProperty('saturation')) handleApplySaturation(recEdits.saturation);
            if (recEdits.hasOwnProperty("brightness")) handleApplyBrightness(recEdits.brightness);
            if (recEdits.hasOwnProperty('contrast')) handleApplyContrast(recEdits.contrast);
            
            if (recEdits.hasOwnProperty('filter')) {
                const validFilters = ['Fresco', 'Bali', 'Nordic', 'Chroma', 'Aura', 'Antiq', 'Noir', 'Outrun'];
                if (validFilters.includes(recEdits.filter)) {
                    if (filterMapRef.current.get(recEdits.filter)){
                        setFilter(recEdits.filter);
                        handleFilter(filterMapRef.current.get(recEdits.filter));
                    } else {
                        newMessage += "I'm not able to add the filter automatically, but you can still manually add " + recEdits.filter;
                    }
                }
            }

            const textStickerBoxes = [];
            if (recEdits.hasOwnProperty('text')) textStickerBoxes.push(handleInsertText(recEdits.text));
            if (recEdits.hasOwnProperty('sticker')) newMessage += "I'm not able to add the sticker automatically, but you can manually add " + recEdits.sticker.description;

            if (recEdits.hasOwnProperty('crop')) {
                if (recEdits.crop.objects.every(obj => Object.keys(keyObjects).includes(obj))) {
                    const boundingBoxes = recEdits.crop.objects.map(key => keyObjects[key]);
                    const tempCropBbox = enclosingBbox([...[adjustMargin(enclosingBbox(boundingBoxes), recEdits.crop.space)], ...textStickerBoxes]);
                    handleCrop(tempCropBbox);
                    setCropSelection(Object.fromEntries(Object.entries(keyObjects).filter(([key]) => recEdits.crop.objects.includes(key))));
                    setCropSpace(recEdits.crop.space);
                } else {
                    newMessage += "I'm not able to crop the image automatically, but you can still try to crop the image as I suggested."
                }
            }

            onAnnounce(newMessage);
            setNewEdit(true);
            setNewFeedback('new');
        }
        return () => setApplyRec(false);
    }, [applyRec, recEdits, keyObjects, audioCue, onAnnounce]);


    // ==========================================
    // 5. UTILITY & MATH HELPERS
    // ==========================================
    const enclosingBbox = (bboxes) => {
        const min_x = Math.min(...bboxes.map(b => b[0]));
        const min_y = Math.min(...bboxes.map(b => b[1]));
        const max_x_w = Math.max(...bboxes.map(b => b[0] + b[2]));
        const max_y_h = Math.max(...bboxes.map(b => b[1] + b[3]));
        return [min_x, min_y, max_x_w - min_x, max_y_h - min_y];
    };

    const adjustMargin = (bbox, choice) => {
        const [x, y, w, h] = bbox;
        const marginX = Math.max(x, imgShape[0] - (x + w));
        const marginY = Math.max(y, imgShape[1] - (y + h));
        const margin = Math.max(marginX, marginY);
      
        const mediumMargin = 0.25 * margin;
        const looseMargin = 0.5 * margin;

        if (choice === 'Little') return [x, y, w, h];
        if (choice === 'Moderate') return [
            Math.max(0, Math.floor(x - mediumMargin)), Math.max(0, Math.floor(y - mediumMargin)),
            Math.min(imgShape[0] - Math.max(0, Math.floor(x - mediumMargin)), Math.floor(w + 2 * mediumMargin)),
            Math.min(imgShape[1] - Math.max(0, Math.floor(y - mediumMargin)), Math.floor(h + 2 * mediumMargin))
        ];
        if (choice === 'A lot') return [
            Math.max(0, Math.floor(x - looseMargin)), Math.max(0, Math.floor(y - looseMargin)),
            Math.min(imgShape[0] - Math.max(0, Math.floor(x - looseMargin)), Math.floor(w + 2 * looseMargin)),
            Math.min(imgShape[1] - Math.max(0, Math.floor(y - looseMargin)), Math.floor(h + 2 * looseMargin))
        ];
    };

    function pushSnapshot(snapshot) {
        if (historyIndexRef.current < historyRef.current.length - 1) {
            historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
        }
        if (historyRef.current.length === 10) historyRef.current.shift();
        historyRef.current.push(snapshot);
        historyIndexRef.current = historyRef.current.length - 1;
        setVersion(v => v + 1);
        setNewEdit(false);
    }

    function restoreSnapshot(snapshot) {
        fabricCanvasRef.current.clear();
        fabricCanvasRef.current.setDimensions({width: snapshot.cropBox[2], height: snapshot.cropBox[3]});
        fabricCanvasRef.current.loadFromJSON(snapshot.canvasJSON).then(() => {
            fabricCanvasRef.current.renderAll();
            textboxMapRef.current.clear();
            stickerMapRef.current.clear();
            filterMapRef.current.clear();

            fabricCanvasRef.current.getObjects().forEach((obj) => {
                if (!obj.id) return;
                if (obj.name === 'textbox') textboxMapRef.current.set(obj.id, obj);
                else if (obj.name === 'sticker') stickerMapRef.current.set(obj.id, obj);
                else if (obj.name === 'img') { filterMapRef.current.set(obj.id, obj); mainImageRef.current = obj; }
            });

            setColorLighting(snapshot.colorLighting);
            setFilter(snapshot.filter);
            setCropSelection(snapshot.cropSelection);
            setCropBox(snapshot.cropBox);
            setCropSpace(snapshot.cropSpace);
            setTextboxes(snapshot.textboxes);
            setStickers(snapshot.stickers);
            setRecEdits(snapshot.recEdits);
            setRecommendations(snapshot.recommendations);
        }).catch((err) => logEvent(`error: ${err.message}`));
    }

    function dataURLtoBlob(url) {
        const arr = url.split(',');
        const mimeMatch = arr[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : '';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while(n--) u8arr[n] = bstr.charCodeAt(n);
        return new Blob([u8arr], { type: mime });
    }

    function adjustBoundingBoxes(bboxes, cropX, cropY, cropWidth, cropHeight) {
        let adjustedBboxes = {};
        for (let object in bboxes) {
            let [x, y, width, height] = bboxes[object];
            let newX = x - cropX;
            let newY = y - cropY;
            let newWidth = Math.min(width, cropX + cropWidth - x);
            let newHeight = Math.min(height, cropY + cropHeight - y);
    
            if (newX + newWidth > 0 && newY + newHeight > 0 && newX < cropWidth && newY < cropHeight) {
                adjustedBboxes[object] = [ Math.max(newX, 0), Math.max(newY, 0), Math.max(newWidth, 0), Math.max(newHeight, 0) ];
            }
        }
        return adjustedBboxes;
    }

    // ==========================================
    // 6. UI COMPONENTS
    // ==========================================

    const toggleSection = (section) => {
        setOpenRec(section === "recommendation");
        setOpenColorLighting(section === "colorlighting");
        setOpenFilter(section === "filter");
        setOpenCrop(section === "crop");
        setOpenText(section === "text");
        setOpenSticker(section === "sticker");
        logEvent(`Expand ${section}`);
    };

    const Recommendation  = () => {
        const [value, setValue] = useState('');

        const handleSubmit = async() => {
            logEvent(`Request recommendations: ${value}`);
            onAnnounce("Generating recommendations for image.");
            audioCue.startTickingSound();

            const formData = new FormData();
            formData.append('imageUrl', dataURLtoBlob(curURL));
            formData.append('requirement', value || '');
            formData.append('chatHistory', chatHistory);
            formData.append('keyObjects', JSON.stringify({...keyObjects, "image": [imgShape[0], imgShape[1]]}));

            fetch(`http://${IP}:8000/recommendations`, { method: 'POST', body: formData, credentials: 'include' })
            .then(response => response.json())
            .then(data => {
                const recommendation = JSON.parse(data.answer.replace(/```json\n|```/g, ''));
                setRecommendations(recommendation["Description"]);
                setRecEdits(recommendation["Recommendations"]);
                setValue('');
                audioCue.stopTickingSound();
                onAnnounce(`Complete. Recommendations ready. ${recommendation["Description"]}`);
            }).catch((err) => {
                audioCue.stopTickingSound();
                onAnnounce("Not able to generate recommendations.");
                logEvent(`error: ${err.message}`);
            });
        };

        return (
            <section aria-labelledby='rec-header' hidden={!openRec}>
                <h4 id='rec-header'>Request Edit Recommendations</h4>
                <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                    <label htmlFor="recommendation-input"> Let me know how you would like to change the image, and I will provide recommendations </label>
                    <input id="recommendation-input" type="text" value={value} onChange={(e) => setValue(e.target.value)} aria-description="Enter requirements to enable the request button"/>
                    <button type="submit" disabled={!value.trim()}>Request</button>
                </form>

                {recommendations && (
                    <div>
                        <h4>Recommended edits:</h4>
                        <p>{recommendations}</p>
                        <form onSubmit={(e) => { e.preventDefault(); setApplyRec(true); }}>
                            <button type="submit">Apply Suggested Edits</button>
                        </form>
                    </div>
                )}
            </section>
        );
    };

    // HCI Feature: Accessible property adjustments (Discrete buttons instead of sliders)
    const ColorLightingOptions = () => {
        const [brightness, setBrightness] = useState(colorLighting['brightness'] || 0);
        const [contrast, setContrast] = useState(colorLighting['contrast'] || 0);
        const [saturation, setSaturation] = useState(colorLighting['saturation'] || 0);

        const adjustValue = (type, amount) => {
            if (type === 'brightness') {
                setBrightness((prev) => {
                    const newValue = Math.max(-100, Math.min(100, prev + amount));
                    handleApplyBrightness(newValue);
                    onAnnounce(`Brightness set to ${newValue}`);
                    return newValue;
                });
            } else if (type === 'contrast') {
                setContrast((prev) => {
                    const newValue = Math.max(-100, Math.min(100, prev + amount));
                    handleApplyContrast(newValue);
                    onAnnounce(`Contrast set to ${newValue}`);
                    return newValue;
                });
            } else if (type === 'saturation') {
                setSaturation((prev) => {
                    const newValue = Math.max(-100, Math.min(100, prev + amount));
                    handleApplySaturation(newValue);
                    onAnnounce(`Saturation set to ${newValue}`);
                    return newValue;
                });
            }
        };

        return (
            <section aria-labelledby='color-header' hidden={!openColorLighting}>
                <h4 id='color-header'>Adjust Color and Lighting</h4>
                <div>
                    <h5>Brightness (Current: {brightness})</h5>
                    <button onClick={() => adjustValue('brightness', 10)} disabled={Number(brightness) >= 100}>Increase</button>
                    <button onClick={() => adjustValue('brightness', -10)} disabled={Number(brightness) <= -100}>Decrease</button>
                    <button onClick={() => adjustValue('brightness', -Number(brightness))} disabled={Number(brightness) === 0}>Reset</button>
                </div>
                <div>
                    <h5>Contrast (Current: {contrast})</h5>
                    <button onClick={() => adjustValue('contrast', 10)} disabled={Number(contrast) >= 100}>Increase</button>
                    <button onClick={() => adjustValue('contrast', -10)} disabled={Number(contrast) <= -100}>Decrease</button>
                    <button onClick={() => adjustValue('contrast', -Number(contrast))} disabled={Number(contrast) === 0}>Reset</button>
                </div>
                <div>
                    <h5>Saturation (Current: {saturation})</h5>
                    <button onClick={() => adjustValue('saturation', 10)} disabled={Number(saturation) >= 100}>Increase</button>
                    <button onClick={() => adjustValue('saturation', -10)} disabled={Number(saturation) <= -100}>Decrease</button>
                    <button onClick={() => adjustValue('saturation', -Number(saturation))} disabled={Number(saturation) === 0}>Reset</button>
                </div>
            </section>
        );
    };

    const FilterOptions = () => {
        const handleClick = (value) => {
            removeFilter(filter);
            setFilter(value);
            onAnnounce("Applying filter: " + value);
            setApplyFilter(true);
        };

        return (
            <section aria-labelledby='filter-header' hidden={!openFilter}>
                <h4 id='filter-header'>Select a Filter:</h4>
                {(filter !== undefined) && <p>{`Current filter: ${filter}`}</p>}
                <button onClick={() => handleClick('Fresco')}>Fresco</button>
                <button onClick={() => handleClick('Bali')}>Bali</button>
                <button onClick={() => handleClick('Nordic')}>Nordic</button>
                <button onClick={() => handleClick('Chroma')}>Chroma</button>
                <button onClick={() => handleClick('Aura')}>Aura</button>
                <button onClick={() => handleClick('Antiq')}>Antiq</button>
                <button onClick={() => handleClick('Noir')}>Noir</button>
                <button onClick={() => handleClick('Outrun')}>Outrun</button>
            </section>
        )
    };

    const CropOptions = () => {
        const [selectedObjects, setSelectedObjects] = useState(cropSelection);
        const [space, setSpace] = useState(cropSpace);

        const handleObjSelect = (key, value) => {
            setSelectedObjects((prev) => {
                if (prev[key]) {
                  const { [key]: removed, ...rest } = prev;
                  return rest;
                } else {
                  return { ...prev, [key]: value };
                }
            });
        };

        const handleSubmit = () => {
            onAnnounce(`Cropping image to keep only ` + Object.keys(selectedObjects).join(', ') + ' with ' + space + ' background.');
            setCropSelection(selectedObjects);
            setCropSpace(space);

            const boundingBoxes = Object.values(selectedObjects);
            const tempCropBox = adjustMargin(enclosingBbox(boundingBoxes), space);
            handleCrop(tempCropBox);
        };

        return (
            <section aria-labelledby='crop-header' hidden={!openCrop}>
                <h4 id='crop-header'>Crop by Choosing What to Keep:</h4>
                <div>
                    {Object.keys(keyObjects).length === 0 && <p>Fetching key objects in the photo...please wait.</p>}
                    {Object.keys(keyObjects).map((key, index) => (
                        <button key={index} onClick={() => handleObjSelect(key, keyObjects[key])} aria-pressed={!!selectedObjects[key]}>
                            {key}
                        </button>
                    ))}
                </div>
                <p id="background-selection">Select the amount of background to keep in the image.</p>
                <div role="radiogroup" aria-labelledby="background-selection">
                    <button role='radio' onClick={() => setSpace('Little')} aria-checked={space === 'Little'}>Very little</button>
                    <button role='radio' onClick={() => setSpace('Moderate')} aria-checked={space === 'Moderate'}>A moderate amount</button>
                    <button role='radio' onClick={() => setSpace('A lot')} aria-checked={space === 'A lot'}>A lot</button>
                </div>
                <button onClick={handleSubmit} disabled={Object.keys(selectedObjects).length < 1 || !space}>Apply</button>
            </section>
        )
    };
    
    const TextOptions = () => {
        const formRef = useRef(null);

        const addTextbox = () => {
            setCurrentTextbox({input: '', font: '', color: '', background: '', size: null, location: null});
            setTextUpdate(false);
            setTextForm(true);
            setTimeout(() => formRef.current?.focus(), 0);
        };

        const selectTextbox = (textbox) => {
            setCurrentTextbox(textbox);
            setTextUpdate(true);
            setTextForm(true);
            setTimeout(() => formRef.current?.focus(), 0);
        }

        const deleteTextbox = (textbox) => {
            removeText(textbox, textbox.id);
            setTextboxes(prev => prev.filter(tb => tb.id !== textbox.id));
            onAnnounce('textbox deleted.');
        }

        return (
            <section aria-labelledby='text-header' hidden={!openText}>
                <h4 id='text-header'>Manage Textboxes</h4>
                <div>
                    <h5>Existing Textboxes</h5>
                    {textboxes.length === 0 ? (<p>No textboxes added yet.</p>) : (
                        <ul>
                            {textboxes.map((tb) => (
                                <li key={tb.id}>
                                    <p> {tb.input.split(' ').slice(0, 5).join(' ')} </p>
                                    <button onClick={() => selectTextbox(tb)}>Edit</button>
                                    <button onClick={() => deleteTextbox(tb)}>Delete</button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <button onClick={addTextbox}>Add a New Textbox</button>
                </div>
                {textForm && <TextConfigForm onCancel={() => setTextForm(false)} formRef={formRef}/>}
            </section>
        );
    };

    const TextConfigForm = ({onCancel, formRef}) => {
        const [placementMode, setPlacementMode] = useState("");
        const [value, setValue] = useState(currentTextbox?.input || "");
        const [font, setFont] = useState(currentTextbox?.font || "");
        const [color, setColor] = useState(currentTextbox?.color || "");
        const [background, setBackground] = useState(currentTextbox?.background || "");
        const [placementInput, setPlacementInput] = useState("");
        const [x, setX] = useState(currentTextbox.location ? currentTextbox.location[0] : '');
        const [y, setY] = useState(currentTextbox.location ? currentTextbox.location[1] : '');
        const [size, setSize] = useState(currentTextbox.size || '');
        const dimension = cropBox ? [cropBox[2], cropBox[3]] : [imgShape[0], imgShape[1]];

        useEffect(() => { if (!openText) onCancel(); }, [openText, onCancel]);

        const handleSubmit = async () => {
            let updatedTextbox = {...currentTextbox, input: value, font, color, background, location: [x, y], size};

            if (placementMode === "auto") {
                try {
                    const placement = await txtPlacementRequest();
                    updatedTextbox = {...updatedTextbox, location: [placement.coordinate[0], placement.coordinate[1]], size: placement.size };
                } catch (error) { return; }
            }
            handleInsertText(updatedTextbox);
            onAnnounce(textUpdate ? "Textbox updated." : "New textbox added.");
            onCancel();
        };

        const txtPlacementRequest = () => {
            return new Promise((resolve, reject) => {
                const formData = new FormData();
                formData.append('imageUrl', dataURLtoBlob(curURL));
                formData.append('request', placementInput);
                formData.append('chatHistory', chatHistory);
                const adjustedKeyObj = cropBox ? keyObjects : adjustBoundingBoxes(keyObjects, cropBox[0], cropBox[1], cropBox[2], cropBox[3]);
                formData.append('keyObjects', JSON.stringify({...adjustedKeyObj, "image": dimension}));
        
                audioCue.startTickingSound();
                fetch(`http://${IP}:8000/placement`, { method: 'POST', body: formData, credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    const text_placement = JSON.parse(data.placement.replace(/```json\n|```/g, ''));
                    setX(text_placement.coordinate[0]);
                    setY(text_placement.coordinate[1]);
                    setSize(text_placement.size);
                    audioCue.stopTickingSound();
                    resolve(text_placement);
                }).catch(err => { audioCue.stopTickingSound(); reject(err); });
            });
        };

        const isFormValid = value.trim() !== "" && font.trim() !== "" && color.trim() !== "" && background.trim() !== "" &&
            ((placementMode === "auto" && placementInput.trim() !== "") ||
            (placementMode === "manual" && x !== "" && y !== "" && size !== "" && !isNaN(Number(x)) && !isNaN(Number(y)) && !isNaN(Number(size))));

        return (
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                <h5>{textUpdate ? "Edit Textbox" : "Add New Textbox"}</h5>
                <input type="text" value={value} ref={formRef} onChange={(e) => setValue(e.target.value)} required />
                <select value={font} onChange={(e) => setFont(e.target.value)}>
                    <option value="">Select Font</option>
                    <option value="Helvetica">Helvetica</option>
                    <option value="Arial">Arial</option>
                </select>
                <select value={color} onChange={(e) => setColor(e.target.value)}>
                    <option value="">Select Color</option>
                    <option value="White">White</option>
                    <option value="Black">Black</option>
                </select>
                <select value={background} onChange={(e) => setBackground(e.target.value)}>
                    <option value="">Select Background</option>
                    <option value="Transparent">Transparent</option>
                    <option value="White">White</option>
                </select>
                <div>
                    <button type="button" onClick={() => setPlacementMode("auto")}>Use Auto Placement</button>
                    <button type="button" onClick={() => setPlacementMode("manual")}>Adjust Manually</button>
                    {placementMode === "auto" && <input type="text" value={placementInput} onChange={(e) => setPlacementInput(e.target.value)} required/>}
                    {placementMode === "manual" && (
                        <fieldset>
                            <input type="number" value={x} onChange={(e) => setX(Number(e.target.value))} />
                            <input type="number" value={y} onChange={(e) => setY(Number(e.target.value))} />
                            <input type="number" value={size} onChange={(e) => setSize(Number(e.target.value))} />
                        </fieldset>
                    )}
                </div>
                <button type="submit" disabled={!isFormValid}>{textUpdate ? "Apply Changes" : "Add Textbox"}</button>
                <button type="button" onClick={onCancel}>Cancel</button>
            </form>
        );
    };

    const StickerOptions = () => {
        const addSticker = () => {
            setCurrentSticker({input: '', description: '', url: '', size: null, location: null});
            setStickerUpdate(false);
            setStickerForm(true);
        };

        const deleteSticker = (sticker) => {
            removeSticker(sticker.id);
            setStickers(prev => prev.filter(st => st.id !== sticker.id));
            onAnnounce('sticker deleted.');
        };

        return (
            <section aria-labelledby='sticker-header' hidden={!openSticker}>
                <h4 id='sticker-header'>Manage Stickers</h4>
                <div>
                    {stickers.length === 0 ? (<p>No sticker added yet.</p>) : (
                        <ul>
                            {stickers.map((st) => (
                                <li key={st.id}>
                                    <p> {st.description.split(' ').slice(0, 5).join(' ')} </p>
                                    <button onClick={() => { setCurrentSticker(st); setStickerUpdate(true); setStickerForm(true); }}>Edit</button>
                                    <button onClick={() => deleteSticker(st)}>Delete</button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <button onClick={addSticker}>Add a New Sticker</button>
                </div>
                {stickerForm && <StickerConfigForm onCancel={() => setStickerForm(false)} />}
            </section>
        );
    };

    const StickerConfigForm = ({onCancel}) => {
        const [placementMode, setPlacementMode] = useState("");
        const [value, setValue] = useState(currentSticker?.input || "");
        const [placementInput, setPlacementInput] = useState("");
        const [x, setX] = useState(currentSticker.location ? currentSticker.location[0] : '');
        const [y, setY] = useState(currentSticker.location ? currentSticker.location[1] : '');
        const [size, setSize] = useState(currentSticker.size || '');

        const handleSubmit = async () => {
            let updatedSticker = {...currentSticker, input: value, location: [x, y], size};
            
            if (value.trim() !== (currentSticker?.input || "").trim()) {
                try {
                    const newStickerUrl = await generateSticker();
                    updatedSticker = {...updatedSticker, url: newStickerUrl.url, description: newStickerUrl.description };
                } catch (error) { return; }
            }

            if (placementMode === "auto") {
                try {
                    const placement = await stickerPlacementRequest();
                    updatedSticker = {...updatedSticker, location: [placement.coordinate[0], placement.coordinate[1]], size: placement.size };
                } catch (error) { return; }
            }

            handleInsertSticker(updatedSticker);
            onAnnounce(stickerUpdate ? "Sticker updated." : "New sticker added.");
            onCancel();
        };

        const generateSticker = () => {
            return new Promise((resolve, reject) => {
                audioCue.startTickingSound();
                const formData = new FormData(); formData.append('prompt', value);
                fetch(`http://${IP}:8000/generatestickers`, { method: 'POST', body: formData, credentials: 'include' })
                .then(res => res.json())
                .then(data => { audioCue.stopTickingSound(); resolve(data.stickers[0]); })
                .catch(err => { audioCue.stopTickingSound(); reject(err); });
            });
        };

        const stickerPlacementRequest = () => {
            return new Promise((resolve, reject) => {
                audioCue.startTickingSound();
                const formData = new FormData();
                formData.append('imageUrl', dataURLtoBlob(curURL));
                formData.append('request', placementInput);
                fetch(`http://${IP}:8000/placement`, { method: 'POST', body: formData, credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    const placement = JSON.parse(data.placement.replace(/```json\n|```/g, ''));
                    setX(placement.coordinate[0]); setY(placement.coordinate[1]); setSize(placement.size);
                    audioCue.stopTickingSound(); resolve(placement);
                }).catch(err => { audioCue.stopTickingSound(); reject(err); });
            });
        };

        const isFormValid = value.trim() !== "" &&
            ((placementMode === "auto" && placementInput.trim() !== "") ||
            (placementMode === "manual" && x !== "" && y !== "" && size !== ""));

        return (
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                <h5>{stickerUpdate ? `Edit Sticker` : "Add New Sticker"}</h5>
                <input type="text" value={value} onChange={(e) => setValue(e.target.value)} required/>
                <div>
                    <button type="button" onClick={() => setPlacementMode("auto")}>Use Auto Placement</button>
                    <button type="button" onClick={() => setPlacementMode("manual")}>Adjust Manually</button>
                    {placementMode === "auto" && <input type="text" value={placementInput} onChange={(e) => setPlacementInput(e.target.value)} required/>}
                    {placementMode === "manual" && (
                        <fieldset>
                            <input type="number" value={x} onChange={(e) => setX(Number(e.target.value))} />
                            <input type="number" value={y} onChange={(e) => setY(Number(e.target.value))} />
                            <input type="number" value={size} onChange={(e) => setSize(Number(e.target.value))} />
                        </fieldset>
                    )}
                </div>
                <button type="submit" disabled={!isFormValid}>{stickerUpdate ? "Apply Changes" : "Add Sticker"}</button>
                <button type="button" onClick={onCancel}>Cancel</button>
            </form>
        );
    }

    const historyOption  = () => {
        const undo = () => {
            if (historyIndexRef.current >= 0) {
                isRestoringRef.current = true;
                historyIndexRef.current -= 1;
                restoreSnapshot(historyRef.current[historyIndexRef.current]);
                setVersion(v => v + 1);
                setNewFeedback('undo');
                isRestoringRef.current = false;
            }
        };

        const redo = () => {
            if (historyIndexRef.current < historyRef.current.length - 1) {
                isRestoringRef.current = true;
                historyIndexRef.current += 1;
                restoreSnapshot(historyRef.current[historyIndexRef.current]);
                setVersion(v => v + 1);
                setNewFeedback('redo');
                isRestoringRef.current = false;
            }
        };

        const revert = () => {
            isRestoringRef.current = true;
            restoreSnapshot(historyRef.current[0]);
            historyRef.current = historyRef.current.slice(0, 1);
            historyIndexRef.current = 0;
            setVersion(v => v + 1);
            setNewFeedback('revert');
            isRestoringRef.current = false;
        };

        return  (
            <section aria-labelledby='history-header'>
                <h2 id='history-header'>Manage Edit History</h2>
                <div role="group" aria-label="Edit history controls">
                    <button onClick={undo} disabled={historyIndexRef.current <= 0}>Undo</button>
                    <button onClick={redo} disabled={historyIndexRef.current >= historyRef.current.length - 1}>Redo</button>
                    <button onClick={revert} disabled={historyRef.current.length <= 1}>Revert</button>
                </div>
            </section>
        );
    };

    return (
        <div className='editor-container'>
            <section aria-labelledby='editor-header'>
                <h2 id='editor-header'>Make Edits</h2>
                <h3>Available Edit Options:</h3>
                
                <div>
                    <button aria-expanded={openRec} onClick={() => toggleSection("recommendation")}>Make Edits from Recommendations</button>
                    <Recommendation />
                </div>
                <div>
                    <button aria-expanded={openColorLighting} onClick={() => toggleSection("colorlighting")}>Color and Lighting</button>
                    <ColorLightingOptions />
                </div>
                <div>
                    <button aria-expanded={openFilter} onClick={() => toggleSection("filter")}>Filter</button>
                    <FilterOptions />
                </div>
                <div>
                    <button aria-expanded={openCrop} onClick={() => toggleSection("crop")}>Crop</button>
                    <CropOptions />
                </div>
                <div>
                    <button aria-expanded={openText} onClick={() => toggleSection("text")}>Text</button>
                    <TextOptions />
                </div>
                <div>
                    <button aria-expanded={openSticker} onClick={() => toggleSection("sticker")}>Sticker</button>
                    <StickerOptions />
                </div>
            </section>
            
            {historyOption()}
        </div>
      );
}

export default Editor;
