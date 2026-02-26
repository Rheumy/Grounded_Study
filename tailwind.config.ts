import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0b1020",
        fog: "#f4f5f7",
        accent: "#0f766e",
        accentSoft: "#ccfbf1",
        danger: "#b91c1c"
      },
      fontFamily: {
        display: ["Space Grotesk", "ui-sans-serif", "system-ui"],
        body: ["Source Sans 3", "ui-sans-serif", "system-ui"]
      }
    }
  },
  plugins: []
};

export default config;
