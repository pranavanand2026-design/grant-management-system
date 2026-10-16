import { createRoot } from "react-dom/client";
import "@gf-ui"; // pulls in the design system's full stylesheet + components
import { AuthGate } from "./auth/AuthGate.jsx";
import { PRODUCT_NAME } from "./config/product.js";

document.title = `${PRODUCT_NAME} · Grant Compliance`;

createRoot(document.getElementById("root")).render(<AuthGate />);
