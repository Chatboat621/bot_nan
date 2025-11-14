// src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ChatWidgetDemo from "./ChatWidget";
// import ChatDashboard from "./ChatDashboard";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ChatWidgetDemo />} />
        {/* <Route path="/chat" element={<ChatDashboard />} /> */}
      </Routes>
    </BrowserRouter>
  );
}
