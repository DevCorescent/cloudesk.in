import type { MetadataRoute } from "next";

// Lets Cloudesk be installed on a phone's home screen or a desktop, opening
// straight into the dashboard in its own window.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cloudesk",
    short_name: "Cloudesk",
    description: "Run your business — store, POS, accounts, HR, inventory and more.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#fbfbfa",
    theme_color: "#111113",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
