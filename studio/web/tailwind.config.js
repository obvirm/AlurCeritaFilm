/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#000000",
          1: "#0A0A0A",
          2: "#1A1A1A",
          3: "#27272A",
        },
        brand: {
          DEFAULT: "#B6FF3B",
          hover: "#9AE600",
          dark: "#7CCF00",
          muted: "rgba(182,255,59,0.12)",
        },
        opus: {
          bg: "#000000",
          card: "#0A0A0A",
          border: "#27272A",
          accent: "#B6FF3B",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
}

