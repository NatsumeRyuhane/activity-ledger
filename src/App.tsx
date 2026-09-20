import { Route, Routes } from "react-router-dom";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<div className="p-4">活动账本</div>} />
    </Routes>
  );
}
