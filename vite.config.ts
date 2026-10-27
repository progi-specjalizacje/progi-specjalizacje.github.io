import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // prognoza-szkic.html: robocza strona z prognozami (noindex, bez linków z reszty serwisu, poza sitemapą).
      input: {
        main: resolve(__dirname, "index.html"),
        prognozaSzkic: resolve(__dirname, "prognoza-szkic.html"),
      },
    },
  },
});
