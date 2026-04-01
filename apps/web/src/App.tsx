import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import ArchivePage from "./pages/ArchivePage";
import LoginPage from "./pages/LoginPage";
import NotificationsPage from "./pages/NotificationsPage";
import OaPage from "./pages/OaPage";
import TimelinePage from "./pages/TimelinePage";
import ProtectedRoute from "./routes/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="archive" replace />} />
        <Route path="archive" element={<ArchivePage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="oa" element={<OaPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>
      <Route path="/" element={<Navigate to="/app/archive" replace />} />
      <Route path="*" element={<Navigate to="/app/archive" replace />} />
    </Routes>
  );
}
