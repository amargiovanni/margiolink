import { Route, Routes } from "react-router";
import { AppShell } from "./components/layout/AppShell";
import { RequireSession } from "./components/RequireSession";
import Login from "./pages/Login";

function Placeholder() {
  return <h1 className="font-display text-3xl">MargioLink</h1>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireSession>
            <AppShell>
              <Placeholder />
            </AppShell>
          </RequireSession>
        }
      />
    </Routes>
  );
}
