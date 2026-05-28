// socket.js
import { io } from 'socket.io-client';
import globalState from './global';

// Fetches the IP address defined by the researcher in global.js
const IP = globalState.IP;

// Connects to the Flask server on port 8000
const socket = io(`http://${IP}:8000`);

export default socket;
