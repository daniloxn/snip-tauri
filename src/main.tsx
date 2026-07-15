import ReactDOM from "react-dom/client";
import App from "./App";
import Overlay from "./Overlay";
import SettingsPage from "./Settings";
import ResultPage from "./Result"

function Main() {
  const path = window.location.pathname;

  if (path === "/overlay") return <Overlay />;
  if (path === "/settings") return <SettingsPage />;
  if (path === "/result") return <ResultPage />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Main />);

export default Main;