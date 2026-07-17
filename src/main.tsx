import ReactDOM from "react-dom/client";
import Overlay from "./Overlay";
import SettingsPage from "./Settings";
import ResultPage from "./Result"

function Main() {
  const path = window.location.pathname;
  if (path === "/overlay") return <Overlay />;
  if (path === "/result") return <ResultPage />;
  return <SettingsPage />; // ← padrão: mostra Settings direto
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Main />);

export default Main;