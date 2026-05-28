import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import StartPage from './features/StartPage/StartPage';
import EditPage from './features/EditPage/EditPage';
import DashboardPage from './features/DashboardPage/DashboardPage';
import { useEffect } from 'react';
import socket from '../src/features/socket';
import _ from "lodash"; // Loadash helps with throttling

const logEvent = _.throttle((log) => {
  socket.emit("user_activity", log);
}, 3000);


function App() {

  useEffect(() => {
    const handleError = (message, source, lineno, colno, error) => {
        logEvent(`Global Error: ${message} at ${source}:${lineno}:${colno}`);
    };

    const handleRejection = (event) => {
        logEvent(`Unhandled Promise Rejection: ${event.reason}`);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
        window.removeEventListener("error", handleError);
        window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);


  useEffect(() => {
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    console.error = (...args) => {
        logEvent(`Console Error: ${args.join(" ")}`);
        originalConsoleError.apply(console, args);
    };

    console.warn = (...args) => {
        logEvent(`Console Warning: ${args.join(" ")}`);
        originalConsoleWarn.apply(console, args);
    };

    return () => {
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate replace to="/start" />} />
        <Route path="/start" element={<StartPage />} />
        <Route path="/edit" element={<EditPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
