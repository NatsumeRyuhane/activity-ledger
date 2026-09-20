import { Route, Routes } from "react-router-dom";
import { ToastProvider } from "@/components/Toast";
import HomePage from "@/pages/HomePage";
import ActivityPage from "@/pages/ActivityPage";

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/a/:id" element={<ActivityPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </ToastProvider>
  );
}
